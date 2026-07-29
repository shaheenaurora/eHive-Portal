import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createHash } from "crypto";
import { eq, and, desc, asc, gte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { createRouter, adminQuery, scopedAdmin } from "./middleware";
import { audit } from "./lib/audit";
import {
  awardRulePoints, notify, evaluateDormancy, introEligibility,
} from "./queries/circle";
import { computeChapterHealth } from "./queries/health";
import { ensureCadenceTemplates, listCadences, recordCadence } from "./queries/cadence";
import { CADENCE_STATUSES } from "@contracts/cadence";
import {
  POINT_RULE_KEYS, POINT_RULE_LABEL, POINT_RULE_FACTOR, POINT_RULE_DEFAULTS,
  ZENITH_CAP, INVESTOR_COOLDOWN_DAYS,
  EVENT_CHECKIN_OPENS_BEFORE_MS, EVENT_CHECKIN_CLOSES_AFTER_MS,
  SPEND_APPROVAL_THRESHOLD_AED, MEETING_AGENDA_TEMPLATES,
} from "@contracts/constants";

function isFullAdmin(user: { adminScopes?: string | null }): boolean {
  const s = (user.adminScopes ?? "").trim();
  return s === "" || s === "*";
}

export const adminEngageRouter = createRouter({
  /* ---- point rules (BRD 7.2 admin-configurable) ---- */
  pointRules: adminQuery.query(async () => {
    const rows = await getDb().select().from(schema.pointRules);
    return POINT_RULE_KEYS.map(k => ({
      key: k, label: POINT_RULE_LABEL[k], factor: POINT_RULE_FACTOR[k],
      points: rows.find(r => r.key === k)?.points ?? POINT_RULE_DEFAULTS[k],
      updatedAt: rows.find(r => r.key === k)?.updatedAt ?? null,
    }));
  }),

  setPointRule: adminQuery
    .input(z.object({ key: z.enum(POINT_RULE_KEYS), points: z.number().min(-100).max(100) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const existing = await db.select().from(schema.pointRules).where(eq(schema.pointRules.key, input.key)).limit(1);
      if (existing.length) {
        await db.update(schema.pointRules).set({ points: input.points }).where(eq(schema.pointRules.key, input.key));
      } else {
        await db.insert(schema.pointRules).values({
          key: input.key, points: input.points,
          factor: POINT_RULE_FACTOR[input.key], label: POINT_RULE_LABEL[input.key],
        });
      }
      return { ok: true };
    }),

  /* ---- engagement standard per tier (BRD 6.3) ---- */
  engagementConfig: adminQuery.query(async () => {
    return getDb().select().from(schema.engagementConfig);
  }),

  setEngagementConfig: adminQuery
    .input(z.object({
      tier: z.enum(["horizon", "ascent", "vanguard", "zenith"]),
      sessionsRequired: z.number().min(0).max(52).nullable().optional(),
      sessionsOffered: z.number().min(0).max(52).nullable().optional(),
      oneToOnesPerQuarter: z.number().min(0).max(24).nullable().optional(),
      giveBackPerYear: z.number().min(0).max(24).nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { tier, ...vals } = input;
      const existing = await db.select().from(schema.engagementConfig).where(eq(schema.engagementConfig.tier, tier)).limit(1);
      if (existing.length) {
        await db.update(schema.engagementConfig).set(vals).where(eq(schema.engagementConfig.tier, tier));
      } else {
        await db.insert(schema.engagementConfig).values({ tier, ...vals });
      }
      return { ok: true };
    }),

  /* ---- dormancy ladder (BRD 6.3) ---- */
  dormancyBoard: adminQuery.query(async () => {
    const db = getDb();
    const rows = await db.select({ member: schema.members, user: schema.users })
      .from(schema.members).innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
      .orderBy(asc(schema.members.dormancyStage), asc(schema.users.name)).limit(300);
    const log = await db.select().from(schema.dormancyLog)
      .orderBy(desc(schema.dormancyLog.createdAt)).limit(40);
    return { rows, log };
  }),

  runDormancyEvaluation: adminQuery.mutation(async () => {
    return evaluateDormancy();
  }),

  setDormancyOverride: adminQuery
    .input(z.object({
      memberId: z.number(),
      stage: z.enum(["active", "at_risk", "dormant", "non_renewal"]),
      note: z.string().min(3).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const m = (await db.select().from(schema.members).where(eq(schema.members.id, input.memberId)).limit(1)).at(0);
      if (!m) throw new TRPCError({ code: "NOT_FOUND" });
      const from = m.dormancyStage ?? "active";
      await db.update(schema.members).set({ dormancyStage: input.stage, dormancyNote: input.note })
        .where(eq(schema.members.id, m.id));
      await db.insert(schema.dormancyLog).values({
        memberId: m.id, fromStage: from, toStage: input.stage,
        reason: input.note, actor: ctx.user.name ?? ctx.user.email ?? "admin",
      });
      await notify(m.id, `Your engagement status was set to ${input.stage} by the eHive team. ${input.note}`, "dormancy");
      return { ok: true };
    }),

  setExceptionPause: adminQuery
    .input(z.object({ memberId: z.number(), quarters: z.number().min(0).max(4), note: z.string().max(500).optional() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.update(schema.members)
        .set({ exceptionPause: input.quarters, dormancyNote: input.note ?? null })
        .where(eq(schema.members.id, input.memberId));
      if (input.note) await notify(input.memberId, `An exception pause was applied to your engagement review. ${input.note}`, "dormancy");
      return { ok: true };
    }),

  sendNotification: adminQuery
    .input(z.object({ memberId: z.number(), text: z.string().min(3).max(500) }))
    .mutation(async ({ input }) => {
      await notify(input.memberId, input.text);
      return { ok: true };
    }),

  /* ---- buddy pairing admin (BRD 6.3: paired within 5 days) ---- */
  buddyBoard: adminQuery.query(async () => {
    const db = getDb();
    const pairs = await db.select().from(schema.buddies).orderBy(desc(schema.buddies.pairedAt)).limit(60);
    const ids = [...new Set(pairs.flatMap(p => [p.newMemberId, p.buddyMemberId]))];
    const people = ids.length
      ? await db.select({ member: schema.members, user: schema.users })
          .from(schema.members).innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
          .where(sql`${schema.members.id} in (${sql.join(ids.map(i => sql`${i}`), sql`, `)})`)
      : [];
    const nameOf = new Map(people.map(p => [p.member.id, p.user.name ?? p.user.email ?? "Member"]));
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const pairedNew = new Set(pairs.map(p => p.newMemberId));
    const recentMembers = await db.select({ member: schema.members, user: schema.users })
      .from(schema.members).innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
      .where(and(eq(schema.members.status, "active"), gte(schema.members.createdAt, fiveDaysAgo)))
      .limit(50);
    const unpaired = recentMembers.filter(r => !pairedNew.has(r.member.id))
      .map(r => ({ id: r.member.id, name: r.user.name ?? r.user.email ?? "Member", since: r.member.createdAt }));
    const candidates = await db.select({ member: schema.members, user: schema.users })
      .from(schema.members).innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
      .where(and(eq(schema.members.status, "active"), sql`${schema.members.dormancyStage} = 'active'`))
      .orderBy(asc(schema.users.name)).limit(200);
    return {
      pairs: pairs.map(p => ({
        ...p,
        newName: nameOf.get(p.newMemberId) ?? "Member",
        buddyName: nameOf.get(p.buddyMemberId) ?? "Member",
      })),
      unpaired,
      candidates: candidates.map(c => ({ id: c.member.id, name: c.user.name ?? c.user.email ?? "Member" })),
    };
  }),

  pairBuddy: adminQuery
    .input(z.object({ newMemberId: z.number(), buddyMemberId: z.number(), note: z.string().max(500).optional() }))
    .mutation(async ({ input }) => {
      if (input.newMemberId === input.buddyMemberId) throw new TRPCError({ code: "BAD_REQUEST" });
      const db = getDb();
      await db.insert(schema.buddies).values(input);
      await notify(input.newMemberId, "You've been paired with an eHive buddy — say hello!", "connect");
      await notify(input.buddyMemberId, "You've been assigned as a buddy to a new member. Check-in due in 30 days.", "connect");
      return { ok: true };
    }),

  /* ---- referrals admin ---- */
  referralsAdmin: adminQuery.query(async () => {
    const db = getDb();
    const rows = await db.select({ referral: schema.referrals, user: schema.users })
      .from(schema.referrals)
      .innerJoin(schema.members, eq(schema.referrals.memberId, schema.members.id))
      .innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
      .orderBy(desc(schema.referrals.createdAt)).limit(100);
    return rows.map(r => ({ ...r.referral, memberName: r.user.name ?? r.user.email ?? "Member" }));
  }),

  setReferralStatus: adminQuery
    .input(z.object({ id: z.number(), status: z.enum(["submitted", "converted", "rejected"]) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const r = (await db.select().from(schema.referrals).where(eq(schema.referrals.id, input.id)).limit(1)).at(0);
      if (!r) throw new TRPCError({ code: "NOT_FOUND" });
      await db.update(schema.referrals).set({ status: input.status }).where(eq(schema.referrals.id, r.id));
      if (input.status === "converted" && r.status !== "converted") {
        await awardRulePoints(r.memberId, "referral_converted", "Referral converted: " + r.prospectName);
        await notify(r.memberId, `Your referral ${r.prospectName} converted — bonus points awarded.`, "connect");
      }
      return { ok: true };
    }),

  /* ---- deals admin (staff posts + moderation) ---- */
  dealsAdmin: adminQuery.query(async () => {
    return getDb().select().from(schema.deals).orderBy(desc(schema.deals.createdAt)).limit(100);
  }),

  saveDeal: adminQuery
    .input(z.object({
      id: z.number().optional(),
      title: z.string().min(4).max(255),
      description: z.string().max(4000).optional(),
      tierGate: z.enum(["horizon", "ascent", "vanguard", "zenith"]).default("ascent"),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...vals } = input;
      if (id) await db.update(schema.deals).set(vals).where(eq(schema.deals.id, id));
      else await db.insert(schema.deals).values({ ...vals, postedBy: null });
      return { ok: true };
    }),

  deleteDeal: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await getDb().delete(schema.deals).where(eq(schema.deals.id, input.id));
      return { ok: true };
    }),

  /* ---- 1-2-1 oversight ---- */
  oneToOnesAdmin: adminQuery.query(async () => {
    const db = getDb();
    const rows = await db.select().from(schema.oneToOnes).orderBy(desc(schema.oneToOnes.createdAt)).limit(100);
    const ids = [...new Set(rows.flatMap(r => [r.aMemberId, r.bMemberId]))];
    const people = ids.length
      ? await db.select({ member: schema.members, user: schema.users })
          .from(schema.members).innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
          .where(sql`${schema.members.id} in (${sql.join(ids.map(i => sql`${i}`), sql`, `)})`)
      : [];
    const nameOf = new Map(people.map(p => [p.member.id, p.user.name ?? p.user.email ?? "Member"]));
    return rows.map(r => ({ ...r, aName: nameOf.get(r.aMemberId) ?? "—", bName: nameOf.get(r.bMemberId) ?? "—" }));
  }),

  /* ---- event door: check-in by code, no-show penalties, feedback ---- */
  eventCheckinByCode: adminQuery
    .input(z.object({ code: z.string().min(4).max(12) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const reg = (await db.select().from(schema.eventRegs)
        .where(eq(schema.eventRegs.checkinCode, input.code.trim().toUpperCase())).limit(1)).at(0);
      if (!reg) throw new TRPCError({ code: "NOT_FOUND", message: "Code not found" });
      if (reg.status === "attended") return { ok: true, already: true, memberId: reg.memberId };
      if (reg.status !== "registered") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Registration is " + reg.status });
      // Door check-in only records attendance around the event itself.
      const ev = (await db.select().from(schema.events).where(eq(schema.events.id, reg.eventId)).limit(1)).at(0);
      if (ev) {
        const start = new Date(ev.startsAt).getTime();
        const now = Date.now();
        if (now < start - EVENT_CHECKIN_OPENS_BEFORE_MS)
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This event hasn't started — check-in opens 2 hours before it begins." });
        if (now > start + EVENT_CHECKIN_CLOSES_AFTER_MS)
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Check-in for this event has closed." });
      }
      await db.update(schema.eventRegs).set({ status: "attended" }).where(eq(schema.eventRegs.id, reg.id));
      await awardRulePoints(reg.memberId, "event_attend", "Event check-in");
      return { ok: true, memberId: reg.memberId };
    }),

  markNoShow: adminQuery
    .input(z.object({ regId: z.number(), excused: z.boolean().default(false) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const reg = (await db.select().from(schema.eventRegs).where(eq(schema.eventRegs.id, input.regId)).limit(1)).at(0);
      if (!reg) throw new TRPCError({ code: "NOT_FOUND" });
      if (reg.status === "attended") throw new TRPCError({ code: "CONFLICT", message: "Member attended" });
      const tag = `no-show reg#${reg.id}`;
      const dup = await db.select({ n: sql<number>`count(*)` }).from(schema.scoreEvents)
        .where(and(eq(schema.scoreEvents.memberId, reg.memberId), sql`${schema.scoreEvents.note} like ${"%" + tag + "%"}`));
      if ((dup.at(0)?.n ?? 0) > 0) throw new TRPCError({ code: "CONFLICT", message: "No-show already recorded" });
      await awardRulePoints(reg.memberId, input.excused ? "no_show_excused" : "no_show", `Event ${tag}${input.excused ? " (excused)" : ""}`);
      await notify(reg.memberId, input.excused
        ? "Your absence was recorded as excused."
        : "You were marked as a no-show. Points were deducted per the engagement rules.", "event");
      return { ok: true };
    }),

  eventFeedbackAdmin: adminQuery
    .input(z.object({ eventId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db.select({ fb: schema.eventFeedback, user: schema.users })
        .from(schema.eventFeedback)
        .innerJoin(schema.members, eq(schema.eventFeedback.memberId, schema.members.id))
        .innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
        .where(eq(schema.eventFeedback.eventId, input.eventId))
        .orderBy(desc(schema.eventFeedback.createdAt));
      const avg = rows.length ? rows.reduce((a, r) => a + r.fb.rating, 0) / rows.length : null;
      return { rows: rows.map(r => ({ ...r.fb, memberName: r.user.name ?? r.user.email ?? "Member" })), avg };
    }),

  /* ---- Zenith admissions admin (BRD 6.6) ---- */
  zenithAdmin: adminQuery.query(async () => {
    const db = getDb();
    const apps = await db.select().from(schema.zenithApps).orderBy(desc(schema.zenithApps.createdAt)).limit(60);
    const out: Array<
      (typeof apps)[number] & {
        endorsements: { role: (typeof schema.endorsements.$inferSelect)["role"]; name: string }[];
        weight: number;
      }
    > = [];
    for (const a of apps) {
      const end = await db.select({ e: schema.endorsements, user: schema.users })
        .from(schema.endorsements)
        .innerJoin(schema.members, eq(schema.endorsements.memberId, schema.members.id))
        .innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
        .where(eq(schema.endorsements.appId, a.id));
      out.push({
        ...a,
        endorsements: end.map(x => ({ role: x.e.role, name: x.user.name ?? x.user.email ?? "Member" })),
        weight: end.reduce((w, x) => w + (x.e.role === "board" ? 2 : 1), 0),
      });
    }
    const zen = await db.select({ n: sql<number>`count(*)` }).from(schema.members).where(eq(schema.members.tier, "zenith"));
    return { apps: out, zenithCount: zen.at(0)?.n ?? 0, cap: ZENITH_CAP };
  }),

  decideZenith: scopedAdmin("member_success")
    .input(z.object({ id: z.number(), approve: z.boolean(), note: z.string().max(1000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const app = (await db.select().from(schema.zenithApps).where(eq(schema.zenithApps.id, input.id)).limit(1)).at(0);
      if (!app) throw new TRPCError({ code: "NOT_FOUND" });
      if (["approved", "rejected"].includes(app.status)) throw new TRPCError({ code: "CONFLICT", message: "Already decided" });
      if (!input.approve) {
        await db.update(schema.zenithApps).set({ status: "rejected", note: input.note, decidedAt: new Date() })
          .where(eq(schema.zenithApps.id, app.id));
        await audit(ctx.user, "zenith.reject", { type: "zenithApp", id: app.id });
        return { ok: true };
      }
      // cap of 50 + induction number
      const zen = await db.select({ n: sql<number>`count(*)` }).from(schema.members).where(eq(schema.members.tier, "zenith"));
      if ((zen.at(0)?.n ?? 0) >= ZENITH_CAP)
        throw new TRPCError({ code: "CONFLICT", message: `Zenith is capped at ${ZENITH_CAP} members` });
      const maxInd = await db.select({ m: sql<number>`coalesce(max(${schema.members.inductionNo}),0)` }).from(schema.members);
      const inductionNo = (maxInd.at(0)?.m ?? 0) + 1;
      const user = (await db.select().from(schema.users).where(eq(schema.users.email, app.email)).limit(1)).at(0);
      if (user) {
        const existing = (await db.select().from(schema.members).where(eq(schema.members.userId, user.id)).limit(1)).at(0);
        if (existing) {
          await db.update(schema.members).set({ tier: "zenith", inductionNo }).where(eq(schema.members.id, existing.id));
          await db.insert(schema.membershipEvents).values({
            memberId: existing.id, type: "upgrade", fromTier: existing.tier, toTier: "zenith",
            note: `Zenith induction №${inductionNo}`,
          });
        } else {
          const renew = new Date(); renew.setFullYear(renew.getFullYear() + 1);
          await db.insert(schema.members).values({
            userId: user.id, tier: "zenith", status: "active", renewalAt: renew, inductionNo,
          });
        }
      }
      await db.update(schema.zenithApps).set({ status: "approved", note: input.note, decidedAt: new Date() })
        .where(eq(schema.zenithApps.id, app.id));
      await audit(ctx.user, "zenith.approve", { type: "zenithApp", id: app.id, detail: `induction №${inductionNo}` });
      return { ok: true, inductionNo };
    }),

  /* ---- investor relationship tracker (BRD 6.6) ---- */
  investorIntros: adminQuery.query(async () => {
    const db = getDb();
    const rows = await db.select({ intro: schema.investorIntros, user: schema.users })
      .from(schema.investorIntros)
      .innerJoin(schema.members, eq(schema.investorIntros.memberId, schema.members.id))
      .innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
      .orderBy(desc(schema.investorIntros.createdAt)).limit(100);
    return rows.map(r => ({ ...r.intro, memberName: r.user.name ?? r.user.email ?? "Member" }));
  }),

  addInvestorIntro: adminQuery
    .input(z.object({
      investorName: z.string().min(2).max(255), firm: z.string().max(255).optional(),
      memberId: z.number(), note: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const elig = await introEligibility(input.memberId);
      if (!elig.eligible)
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Not intro-eligible: " + elig.reasons.join("; ") });
      const since = new Date(Date.now() - INVESTOR_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
      const dupe = await db.select({ n: sql<number>`count(*)` }).from(schema.investorIntros)
        .where(and(eq(schema.investorIntros.memberId, input.memberId),
                   sql`lower(${schema.investorIntros.investorName}) = lower(${input.investorName})`,
                   gte(schema.investorIntros.createdAt, since)));
      if ((dupe.at(0)?.n ?? 0) > 0)
        throw new TRPCError({ code: "CONFLICT", message: `Cool-down: this investor was introduced to this member within ${INVESTOR_COOLDOWN_DAYS} days` });
      await db.insert(schema.investorIntros).values({
        ...input, introducedBy: ctx.user.name ?? ctx.user.email ?? "staff",
      });
      await notify(input.memberId, `An introduction to ${input.investorName}${input.firm ? " (" + input.firm + ")" : ""} was arranged for you.`);
      return { ok: true };
    }),

  checkIntroEligibility: adminQuery
    .input(z.object({ memberId: z.number() }))
    .query(async ({ input }) => introEligibility(input.memberId)),

  /* ---- chapters admin (BRD 6.7) ---- */
  chaptersAdmin: adminQuery.query(async () => {
    const db = getDb();
    const rows = await db.select().from(schema.chapters).orderBy(asc(schema.chapters.name));
    // Batch member counts (was N+1) and the latest saved health snapshot per chapter.
    const ids = rows.map((r) => r.id);
    const counts = ids.length
      ? await db.select({ chapterId: schema.members.homeChapterId, n: sql<number>`count(*)` })
          .from(schema.members)
          .where(sql`${schema.members.homeChapterId} in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`)
          .groupBy(schema.members.homeChapterId)
      : [];
    const countMap = new Map(counts.map((c) => [c.chapterId, Number(c.n)]));
    const snaps = ids.length
      ? await db.select().from(schema.healthSnapshots)
          .where(sql`${schema.healthSnapshots.chapterId} in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`)
          .orderBy(desc(schema.healthSnapshots.createdAt))
      : [];
    const latestHealth = new Map<number, number>();
    for (const s of snaps) if (!latestHealth.has(s.chapterId)) latestHealth.set(s.chapterId, s.total);
    return rows.map((c) => ({ ...c, memberCount: countMap.get(c.id) ?? 0, lastHealth: latestHealth.get(c.id) ?? null }));
  }),

  /* Chapter Health Index — live compute + last snapshot for trend (CH-06). */
  chapterHealth: adminQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const health = await computeChapterHealth(input.id);
    const last = (await getDb().select().from(schema.healthSnapshots)
      .where(eq(schema.healthSnapshots.chapterId, input.id))
      .orderBy(desc(schema.healthSnapshots.createdAt)).limit(1)).at(0) ?? null;
    return { ...health, lastSnapshot: last };
  }),

  /* Save the quarterly snapshot (CH-06) — for trend and Zone comparison. */
  saveHealthSnapshot: scopedAdmin("chapters").input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const h = await computeChapterHealth(input.id);
    await getDb().insert(schema.healthSnapshots).values({
      chapterId: input.id, total: h.total, memberCount: h.memberCount, ...h.components,
    });
    await audit(ctx.user, "chapter.health.snapshot", { type: "chapter", id: input.id, detail: `index ${h.total} (${h.band})` });
    return { ok: true, total: h.total };
  }),

  saveChapter: scopedAdmin("chapters")
    .input(z.object({
      id: z.number().optional(), name: z.string().min(2).max(255),
      code: z.string().max(24).optional(),
      country: z.string().max(128).optional(), region: z.string().max(128).optional(),
      state: z.string().max(128).optional(), city: z.string().max(128).optional(),
      zone: z.string().max(128).optional(), meetingCadence: z.string().max(64).optional(),
      status: z.enum(["seed", "provisional", "chartered", "mature", "at_risk"]).default("seed"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const { id, ...vals } = input;
      if (id) {
        await db.update(schema.chapters).set({
          ...vals, charterDate: vals.status === "chartered" || vals.status === "mature" ? new Date() : undefined,
        }).where(eq(schema.chapters.id, id));
        await audit(ctx.user, "chapter.update", { type: "chapter", id, detail: vals.name });
      } else {
        const res = await db.insert(schema.chapters).values(vals);
        await audit(ctx.user, "chapter.create", { type: "chapter", id: Number(res[0].insertId), detail: vals.name });
      }
      return { ok: true };
    }),

  /* Assign (or clear) a member's home chapter directly — the admin path used
     from Chapter management and the member 360°. */
  setHomeChapter: scopedAdmin("chapters")
    .input(z.object({ memberId: z.number(), chapterId: z.number().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await db.update(schema.members).set({ homeChapterId: input.chapterId })
        .where(eq(schema.members.id, input.memberId));
      await audit(ctx.user, "member.chapter", { type: "member", id: input.memberId,
        detail: input.chapterId ? `→ chapter #${input.chapterId}` : "unassigned" });
      return { ok: true };
    }),

  /* Members available to add to a chapter — searchable, with their current
     chapter so admins don't move someone by accident. */
  assignableMembers: scopedAdmin("chapters")
    .input(z.object({ q: z.string().max(120).optional(), excludeChapterId: z.number().optional() }))
    .query(async ({ input }) => {
      const db = getDb();
      const conds = [eq(schema.members.status, "active")];
      if (input.q) {
        const like = `%${input.q}%`;
        conds.push(sql`(${schema.users.name} like ${like} or ${schema.users.email} like ${like} or ${schema.members.company} like ${like})`);
      }
      if (input.excludeChapterId != null)
        conds.push(sql`(${schema.members.homeChapterId} is null or ${schema.members.homeChapterId} <> ${input.excludeChapterId})`);
      const rows = await db.select({
        id: schema.members.id, name: schema.users.name, email: schema.users.email,
        company: schema.members.company, homeChapterId: schema.members.homeChapterId,
        chapterName: schema.chapters.name,
      })
        .from(schema.members)
        .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
        .leftJoin(schema.chapters, eq(schema.chapters.id, schema.members.homeChapterId))
        .where(and(...conds))
        .orderBy(asc(schema.users.name)).limit(50);
      return rows;
    }),

  /* Member-requested chapter transfers awaiting management approval. */
  pendingChapterTransfers: scopedAdmin("chapters").query(async () => {
    const db = getDb();
    const from = alias(schema.chapters, "fromCh");
    const to = alias(schema.chapters, "toCh");
    return db.select({
      req: schema.chapterTransfers,
      memberName: schema.users.name, memberEmail: schema.users.email,
      fromName: from.name, toName: to.name,
    })
      .from(schema.chapterTransfers)
      .innerJoin(schema.members, eq(schema.members.id, schema.chapterTransfers.memberId))
      .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
      .leftJoin(from, eq(from.id, schema.chapterTransfers.fromChapterId))
      .leftJoin(to, eq(to.id, schema.chapterTransfers.toChapterId))
      .where(eq(schema.chapterTransfers.status, "pending"))
      .orderBy(desc(schema.chapterTransfers.createdAt)).limit(100);
  }),

  /* Approve or reject a transfer. The home chapter moves only on approval. */
  decideChapterTransfer: scopedAdmin("chapters")
    .input(z.object({ id: z.number(), decision: z.enum(["approve", "reject"]), note: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const req = (await db.select().from(schema.chapterTransfers)
        .where(eq(schema.chapterTransfers.id, input.id)).limit(1)).at(0);
      if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
      if (req.status !== "pending") throw new TRPCError({ code: "CONFLICT", message: "Already decided." });
      if (input.decision === "approve") {
        await db.update(schema.members).set({ homeChapterId: req.toChapterId })
          .where(eq(schema.members.id, req.memberId));
      }
      await db.update(schema.chapterTransfers).set({
        status: input.decision === "approve" ? "approved" : "rejected",
        actorEmail: ctx.user.email, decidedAt: new Date(), note: input.note ?? req.note,
      }).where(eq(schema.chapterTransfers.id, req.id));
      await audit(ctx.user, `chapter.transfer.${input.decision}`,
        { type: "member", id: req.memberId, detail: `→ chapter #${req.toChapterId}` });
      return { ok: true };
    }),

  chapterDetail: adminQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const chapter = (await db.select().from(schema.chapters).where(eq(schema.chapters.id, input.id)).limit(1)).at(0);
      if (!chapter) throw new TRPCError({ code: "NOT_FOUND" });
      const roster = await db.select({ member: schema.members, user: schema.users })
        .from(schema.members).innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
        .where(eq(schema.members.homeChapterId, chapter.id)).orderBy(asc(schema.users.name)).limit(200);
      const els = await db.select().from(schema.elections)
        .where(eq(schema.elections.chapterId, chapter.id)).orderBy(desc(schema.elections.createdAt)).limit(20);
      const mos = await db.select().from(schema.motions)
        .where(eq(schema.motions.chapterId, chapter.id)).orderBy(desc(schema.motions.createdAt)).limit(20);
      const budgets = await db.select().from(schema.chapterBudgets)
        .where(eq(schema.chapterBudgets.chapterId, chapter.id)).orderBy(desc(schema.chapterBudgets.createdAt)).limit(40);
      const roles = await db.select({ role: schema.chapterRoles, name: schema.users.name, email: schema.users.email })
        .from(schema.chapterRoles)
        .leftJoin(schema.members, eq(schema.members.id, schema.chapterRoles.memberId))
        .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
        .where(and(eq(schema.chapterRoles.chapterId, chapter.id), eq(schema.chapterRoles.status, "active")))
        .orderBy(asc(schema.chapterRoles.createdAt));
      const cadence = await listCadences(chapter.id);
      const meetings = await db.select().from(schema.meetings)
        .where(eq(schema.meetings.chapterId, chapter.id)).orderBy(desc(schema.meetings.createdAt)).limit(30);
      return {
        chapter,
        roster,
        board: roles.map(r => ({ ...r.role, memberName: r.name ?? r.email ?? "Member" })),
        cadence,
        elections: els, motions: mos, budgets, meetings,
      };
    }),

  /* M3 — create a chapter/board meeting with the default agenda pre-loaded. */
  createMeeting: scopedAdmin("chapters")
    .input(z.object({
      chapterId: z.number(),
      kind: z.enum(["chapter_meeting", "board_meeting", "huddle", "other"]),
      title: z.string().min(3).max(255),
      scheduledAt: z.string().datetime().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const res = await getDb().insert(schema.meetings).values({
        chapterId: input.chapterId, kind: input.kind, title: input.title,
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
        agenda: MEETING_AGENDA_TEMPLATES[input.kind] ?? "",
      });
      await audit(ctx.user, "meeting.create", { type: "chapter", id: input.chapterId, detail: input.kind });
      return { ok: true, id: Number(res[0].insertId) };
    }),

  /* Edit agenda / minutes / status of a meeting. */
  saveMeeting: scopedAdmin("chapters")
    .input(z.object({
      id: z.number(),
      title: z.string().min(3).max(255).optional(),
      agenda: z.string().max(10000).optional(),
      minutes: z.string().max(20000).optional(),
      status: z.enum(["scheduled", "held", "cancelled"]).optional(),
      scheduledAt: z.string().datetime().nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, scheduledAt, ...rest } = input;
      const patch: Partial<typeof schema.meetings.$inferInsert> = { ...rest };
      if (scheduledAt !== undefined) patch.scheduledAt = scheduledAt ? new Date(scheduledAt) : null;
      await getDb().update(schema.meetings).set(patch).where(eq(schema.meetings.id, id));
      return { ok: true };
    }),

  meetingAttendance: scopedAdmin("chapters")
    .input(z.object({ meetingId: z.number() }))
    .query(async ({ input }) => {
      return getDb().select().from(schema.meetingAttendance)
        .where(eq(schema.meetingAttendance.meetingId, input.meetingId));
    }),

  /* Replace a meeting's attendance with the supplied entries. */
  setMeetingAttendance: scopedAdmin("chapters")
    .input(z.object({
      meetingId: z.number(),
      entries: z.array(z.object({ memberId: z.number(), status: z.enum(["present", "absent", "excused"]) })),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(schema.meetingAttendance).where(eq(schema.meetingAttendance.meetingId, input.meetingId));
      if (input.entries.length) {
        await db.insert(schema.meetingAttendance).values(
          input.entries.map((e) => ({ meetingId: input.meetingId, memberId: e.memberId, status: e.status })),
        );
      }
      return { ok: true, count: input.entries.filter((e) => e.status === "present").length };
    }),

  /* Set the chapter's operating rhythm up to standard (the recurring cadences). */
  setupChapterCadences: scopedAdmin("chapters").input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const added = await ensureCadenceTemplates(input.id);
    await audit(ctx.user, "chapter.cadences.setup", { type: "chapter", id: input.id, detail: `+${added} cadences` });
    return { ok: true, added };
  }),

  markChapterCadence: scopedAdmin("chapters")
    .input(z.object({ cadenceId: z.number(), status: z.enum(CADENCE_STATUSES), note: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const { chapterId } = await recordCadence(input.cadenceId, input.status, input.note, null);
      await audit(ctx.user, "chapter.cadence.mark", { type: "chapter", id: chapterId, detail: `${input.cadenceId} → ${input.status}` });
      return { ok: true };
    }),

  /* Assign a member of the chapter to a leadership role (directly or from an
     election result). One active holder per role — the previous holder is
     retired. Only members of the chapter are eligible. */
  assignChapterRole: scopedAdmin("chapters")
    .input(z.object({
      chapterId: z.number(), memberId: z.number(), role: z.string().min(2).max(64),
      title: z.string().max(128).optional(), responsibilities: z.string().max(2000).optional(),
      electionId: z.number().optional(),
      termStart: z.coerce.date().optional(), termEnd: z.coerce.date().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const m = (await db.select().from(schema.members).where(eq(schema.members.id, input.memberId)).limit(1)).at(0);
      if (!m) throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
      if (m.homeChapterId !== input.chapterId)
        throw new TRPCError({ code: "BAD_REQUEST", message: "A role can only go to a member of this chapter." });
      // Retire the current holder of this role in this chapter.
      await db.update(schema.chapterRoles)
        .set({ status: "ended", termEnd: new Date() })
        .where(and(eq(schema.chapterRoles.chapterId, input.chapterId),
                   eq(schema.chapterRoles.role, input.role), eq(schema.chapterRoles.status, "active")));
      await db.insert(schema.chapterRoles).values({
        chapterId: input.chapterId, memberId: input.memberId, role: input.role,
        title: input.role === "other" ? (input.title ?? "Officer") : null,
        responsibilities: input.responsibilities, electionId: input.electionId,
        termStart: input.termStart ?? new Date(), termEnd: input.termEnd, status: "active",
        appointedBy: ctx.user.email,
      });
      await audit(ctx.user, "chapter.role.assign",
        { type: "member", id: input.memberId, detail: `${input.role} @ chapter #${input.chapterId}` });
      return { ok: true };
    }),

  endChapterRole: scopedAdmin("chapters")
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const row = (await db.select().from(schema.chapterRoles).where(eq(schema.chapterRoles.id, input.id)).limit(1)).at(0);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      await db.update(schema.chapterRoles).set({ status: "ended", termEnd: new Date() })
        .where(eq(schema.chapterRoles.id, input.id));
      await audit(ctx.user, "chapter.role.end", { type: "member", id: row.memberId, detail: `${row.role} ended` });
      return { ok: true };
    }),

  saveElection: adminQuery
    .input(z.object({
      id: z.number().optional(), chapterId: z.number(),
      title: z.string().min(3).max(255), seat: z.string().min(2).max(128),
      quorumPct: z.number().min(1).max(100).default(50),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...vals } = input;
      if (id) await db.update(schema.elections).set(vals).where(eq(schema.elections.id, id));
      else await db.insert(schema.elections).values(vals);
      return { ok: true };
    }),

  setElectionStatus: adminQuery
    .input(z.object({ id: z.number(), status: z.enum(["open", "voting", "closed"]) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const e = (await db.select().from(schema.elections).where(eq(schema.elections.id, input.id)).limit(1)).at(0);
      if (!e) throw new TRPCError({ code: "NOT_FOUND" });
      if (input.status === "voting") {
        await db.update(schema.elections).set({ status: "voting", opensAt: new Date() }).where(eq(schema.elections.id, e.id));
        return { ok: true };
      }
      if (input.status === "closed") {
        // tally + quorum + tamper-evident result hash
        const memberCount = (await db.select({ n: sql<number>`count(*)` }).from(schema.members)
          .where(eq(schema.members.homeChapterId, e.chapterId))).at(0)?.n ?? 0;
        const turnout = (await db.select({ n: sql<number>`count(*)` }).from(schema.ballotRoll)
          .where(eq(schema.ballotRoll.electionId, e.id))).at(0)?.n ?? 0;
        const tally = await db.select({ candidateId: schema.ballots.candidateId, n: sql<number>`count(*)` })
          .from(schema.ballots).where(eq(schema.ballots.electionId, e.id)).groupBy(schema.ballots.candidateId);
        const quorumMet = memberCount > 0 && (turnout / memberCount) * 100 >= e.quorumPct;
        const hash = createHash("sha256")
          .update(JSON.stringify({ electionId: e.id, tally, turnout, quorumMet, closedAt: Date.now() }))
          .digest("hex");
        await db.update(schema.elections)
          .set({ status: "closed", closesAt: new Date(), resultHash: hash })
          .where(eq(schema.elections.id, e.id));
        // Winner = candidate with the most votes (only meaningful when quorum met
        // and there's a single top scorer). Surfaced so the seat can be filled.
        let winner: { memberId: number; name: string; votes: number } | null = null;
        const sorted = [...tally].sort((a, b) => Number(b.n) - Number(a.n));
        const top = sorted[0];
        const tied = sorted.length > 1 && Number(sorted[1].n) === Number(top?.n ?? 0);
        if (quorumMet && top && Number(top.n) > 0 && !tied) {
          const cand = (await db.select({ memberId: schema.candidates.memberId, name: schema.users.name })
            .from(schema.candidates)
            .leftJoin(schema.members, eq(schema.members.id, schema.candidates.memberId))
            .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
            .where(eq(schema.candidates.id, top.candidateId)).limit(1)).at(0);
          if (cand) winner = { memberId: cand.memberId, name: cand.name ?? "Member", votes: Number(top.n) };
        }
        return { ok: true, turnout, memberCount, quorumMet, resultHash: hash, seat: e.seat, winner };
      }
      await db.update(schema.elections).set({ status: "open" }).where(eq(schema.elections.id, e.id));
      return { ok: true };
    }),

  saveMotion: adminQuery
    .input(z.object({
      id: z.number().optional(), chapterId: z.number(),
      title: z.string().min(3).max(255), body: z.string().max(4000).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...vals } = input;
      if (id) await db.update(schema.motions).set(vals).where(eq(schema.motions.id, id));
      else await db.insert(schema.motions).values(vals);
      return { ok: true };
    }),

  closeMotion: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const mo = (await db.select().from(schema.motions).where(eq(schema.motions.id, input.id)).limit(1)).at(0);
      if (!mo || mo.status !== "open") throw new TRPCError({ code: "CONFLICT", message: "Motion is not open" });
      const votes = await db.select({ choice: schema.motionVotes.choice, n: sql<number>`count(*)` })
        .from(schema.motionVotes).where(eq(schema.motionVotes.motionId, mo.id)).groupBy(schema.motionVotes.choice);
      const yes = votes.find(v => v.choice === "yes")?.n ?? 0;
      const no = votes.find(v => v.choice === "no")?.n ?? 0;
      const status = yes > no ? "passed" : "rejected";
      await db.update(schema.motions).set({ status, closesAt: new Date() }).where(eq(schema.motions.id, mo.id));
      return { ok: true, status, yes, no };
    }),

  saveBudget: adminQuery
    .input(z.object({
      id: z.number().optional(), chapterId: z.number(),
      label: z.string().min(3).max(255),
      kind: z.enum(["allocation", "sponsorship", "spend"]).default("allocation"),
      amount: z.number().min(0),
      status: z.enum(["proposed", "approved", "spent", "rejected"]).default("proposed"),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...vals } = input;
      if (id) await db.update(schema.chapterBudgets).set(vals).where(eq(schema.chapterBudgets.id, id));
      else await db.insert(schema.chapterBudgets).values(vals);
      return { ok: true };
    }),

  /* ---- ML-01 prospect funnel (membership scope) ---- */
  prospects: scopedAdmin("membership")
    .input(z.object({ stage: z.enum(["prospect", "guest", "invited", "converted", "declined"]).optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      return input?.stage
        ? db.select().from(schema.prospects).where(eq(schema.prospects.stage, input.stage)).orderBy(desc(schema.prospects.updatedAt))
        : db.select().from(schema.prospects).orderBy(desc(schema.prospects.updatedAt));
    }),

  addProspect: scopedAdmin("membership")
    .input(z.object({
      name: z.string().min(2).max(255),
      email: z.string().email().max(320).optional().or(z.literal("")),
      phone: z.string().max(40).optional(),
      company: z.string().max(255).optional(),
      chapterId: z.number().optional(),
      source: z.string().max(120).optional(),
      notes: z.string().max(5000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const res = await getDb().insert(schema.prospects).values({
        name: input.name, email: input.email || null, phone: input.phone ?? null,
        company: input.company ?? null, chapterId: input.chapterId ?? null,
        source: input.source ?? null, notes: input.notes ?? null, ownerUserId: ctx.user.id,
      });
      await audit(ctx.user, "prospect.add", { type: "prospect", id: Number(res[0].insertId), detail: input.name });
      return { ok: true, id: Number(res[0].insertId) };
    }),

  updateProspect: scopedAdmin("membership")
    .input(z.object({
      id: z.number(),
      stage: z.enum(["prospect", "guest", "invited", "converted", "declined"]).optional(),
      notes: z.string().max(5000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const patch: Partial<typeof schema.prospects.$inferInsert> = {};
      if (input.stage) patch.stage = input.stage;
      if (input.notes !== undefined) patch.notes = input.notes;
      await getDb().update(schema.prospects).set(patch).where(eq(schema.prospects.id, input.id));
      await audit(ctx.user, "prospect.update", { type: "prospect", id: input.id, detail: input.stage });
      return { ok: true };
    }),

  /* ---- Governance hierarchy (Zone → Region → Country) + roll-ups ---- */
  orgTree: scopedAdmin("chapters").query(async () => {
    const db = getDb();
    const units = await db.select().from(schema.orgUnits);
    const chapters = await db.select({
      id: schema.chapters.id, name: schema.chapters.name,
      zoneId: schema.chapters.zoneId, status: schema.chapters.status,
    }).from(schema.chapters);
    const counts = await db.select({ chapterId: schema.members.homeChapterId, n: sql<number>`count(*)` })
      .from(schema.members).where(eq(schema.members.status, "active")).groupBy(schema.members.homeChapterId);
    const memberBy = new Map(counts.map((c) => [c.chapterId, Number(c.n)]));
    const chs = chapters.map((c) => ({ ...c, members: memberBy.get(c.id) ?? 0 }));
    const kids = (level: "zone" | "region" | "country", pid: number | null) =>
      units.filter((u) => u.level === level && (u.parentId ?? null) === pid);
    const zoneNode = (z: schema.OrgUnit) => {
      const zc = chs.filter((c) => c.zoneId === z.id);
      return { id: z.id, name: z.name, code: z.code, chapters: zc, chapterCount: zc.length, members: zc.reduce((a, c) => a + c.members, 0) };
    };
    const regionNode = (r: schema.OrgUnit) => {
      const zones = kids("zone", r.id).map(zoneNode);
      return { id: r.id, name: r.name, code: r.code, zones, chapterCount: zones.reduce((a, z) => a + z.chapterCount, 0), members: zones.reduce((a, z) => a + z.members, 0) };
    };
    const countryNode = (c: schema.OrgUnit) => {
      const regions = kids("region", c.id).map(regionNode);
      return { id: c.id, name: c.name, code: c.code, regions, chapterCount: regions.reduce((a, r) => a + r.chapterCount, 0), members: regions.reduce((a, r) => a + r.members, 0) };
    };
    return {
      countries: kids("country", null).map(countryNode),
      unassigned: chs.filter((c) => !c.zoneId),
      zones: units.filter((u) => u.level === "zone").map((z) => ({ id: z.id, name: z.name })),
    };
  }),

  createOrgUnit: scopedAdmin("chapters")
    .input(z.object({
      level: z.enum(["zone", "region", "country"]),
      name: z.string().min(2).max(255),
      code: z.string().max(24).optional(),
      parentId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const res = await getDb().insert(schema.orgUnits).values({
        level: input.level, name: input.name, code: input.code ?? null, parentId: input.parentId ?? null,
      });
      await audit(ctx.user, "org.create", { type: "org_unit", id: Number(res[0].insertId), detail: `${input.level}: ${input.name}` });
      return { ok: true, id: Number(res[0].insertId) };
    }),

  setChapterZone: scopedAdmin("chapters")
    .input(z.object({ chapterId: z.number(), zoneId: z.number().nullable() }))
    .mutation(async ({ ctx, input }) => {
      await getDb().update(schema.chapters).set({ zoneId: input.zoneId }).where(eq(schema.chapters.id, input.chapterId));
      await audit(ctx.user, "org.assignChapter", { type: "chapter", id: input.chapterId, detail: `zone #${input.zoneId ?? "none"}` });
      return { ok: true };
    }),

  /* AF-02 — decide a proposed spend, gated by the approval threshold. A spend
     over SPEND_APPROVAL_THRESHOLD_AED needs a full administrator to approve. */
  decideBudgetLine: adminQuery
    .input(z.object({
      id: z.number(),
      decision: z.enum(["approve", "reject"]),
      note: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const line = (await db.select().from(schema.chapterBudgets).where(eq(schema.chapterBudgets.id, input.id)).limit(1)).at(0);
      if (!line) throw new TRPCError({ code: "NOT_FOUND", message: "Budget line not found" });
      if (line.status !== "proposed") throw new TRPCError({ code: "CONFLICT", message: "This line has already been decided." });
      if (input.decision === "approve" && line.kind === "spend"
          && line.amount > SPEND_APPROVAL_THRESHOLD_AED && !isFullAdmin(ctx.user as never)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Spends over AED ${SPEND_APPROVAL_THRESHOLD_AED.toLocaleString()} need a full administrator (President / Director) to approve.`,
        });
      }
      await db.update(schema.chapterBudgets)
        .set({
          status: input.decision === "approve" ? "approved" : "rejected",
          approvedByUserId: ctx.user.id, note: input.note ?? null, decidedAt: new Date(),
        })
        .where(eq(schema.chapterBudgets.id, input.id));
      await audit(ctx.user, `budget.${input.decision}`, { type: "chapter_budget", id: input.id, detail: `${line.kind} AED ${line.amount}` });
      return { ok: true };
    }),

  /* ---- insights CMS + newsletter archive (BRD 6.1/6.5) ---- */
  insightsAdmin: adminQuery.query(async () => {
    return getDb().select().from(schema.insights).orderBy(desc(schema.insights.createdAt)).limit(100);
  }),

  saveInsight: adminQuery
    .input(z.object({
      id: z.number().optional(),
      title: z.string().min(3).max(255),
      slug: z.string().min(3).max(255).regex(/^[a-z0-9-]+$/, "lowercase letters, numbers, dashes"),
      excerpt: z.string().max(500).optional(),
      body: z.string().max(50000).optional(),
      tag: z.string().max(64).default("Note"),
      publish: z.boolean().default(false),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, publish, ...vals } = input;
      const clash = await db.select().from(schema.insights)
        .where(and(eq(schema.insights.slug, vals.slug), id ? sql`${schema.insights.id} != ${id}` : sql`1=1`)).limit(1);
      if (clash.length) throw new TRPCError({ code: "CONFLICT", message: "Slug already in use" });
      if (id) {
        await db.update(schema.insights)
          .set({ ...vals, ...(publish ? { publishedAt: new Date() } : {}) })
          .where(eq(schema.insights.id, id));
      } else {
        await db.insert(schema.insights).values({ ...vals, publishedAt: publish ? new Date() : null });
      }
      return { ok: true };
    }),

  setInsightPublished: adminQuery
    .input(z.object({ id: z.number(), publish: z.boolean() }))
    .mutation(async ({ input }) => {
      await getDb().update(schema.insights)
        .set({ publishedAt: input.publish ? new Date() : null })
        .where(eq(schema.insights.id, input.id));
      return { ok: true };
    }),

  deleteInsight: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await getDb().delete(schema.insights).where(eq(schema.insights.id, input.id));
      return { ok: true };
    }),

  newslettersAdmin: adminQuery.query(async () => {
    return getDb().select().from(schema.newsletters).orderBy(desc(schema.newsletters.publishedAt)).limit(100);
  }),

  saveNewsletter: adminQuery
    .input(z.object({
      id: z.number().optional(), title: z.string().min(3).max(255),
      issue: z.string().max(64).optional(), url: z.string().max(512).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...vals } = input;
      if (id) await db.update(schema.newsletters).set(vals).where(eq(schema.newsletters.id, id));
      else await db.insert(schema.newsletters).values(vals);
      return { ok: true };
    }),

  deleteNewsletter: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await getDb().delete(schema.newsletters).where(eq(schema.newsletters.id, input.id));
      return { ok: true };
    }),

  /* ---- PDPL data-subject requests (BRD 8.4) ---- */
  dataRequestsAdmin: adminQuery.query(async () => {
    const db = getDb();
    const rows = await db.select({ req: schema.dataRequests, user: schema.users })
      .from(schema.dataRequests)
      .innerJoin(schema.members, eq(schema.dataRequests.memberId, schema.members.id))
      .innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
      .orderBy(desc(schema.dataRequests.createdAt)).limit(100);
    return rows.map(r => ({ ...r.req, memberName: r.user.name ?? r.user.email ?? "Member" }));
  }),

  completeDataRequest: scopedAdmin("finance")
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const req = (await db.select().from(schema.dataRequests).where(eq(schema.dataRequests.id, input.id)).limit(1)).at(0);
      if (!req) throw new TRPCError({ code: "NOT_FOUND" });
      await db.update(schema.dataRequests).set({ status: "done" }).where(eq(schema.dataRequests.id, req.id));
      await notify(req.memberId, `Your data ${req.kind} request has been completed.`);
      await audit(ctx.user, "data.complete", { type: "dataRequest", id: req.id, detail: req.kind });
      return { ok: true };
    }),
});
