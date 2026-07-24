import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createHash } from "crypto";
import { eq, and, desc, asc, gte, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { createRouter, adminQuery } from "./middleware";
import {
  awardRulePoints, notify, evaluateDormancy, introEligibility,
} from "./queries/circle";
import {
  POINT_RULE_KEYS, POINT_RULE_LABEL, POINT_RULE_FACTOR, POINT_RULE_DEFAULTS,
  ZENITH_CAP, INVESTOR_COOLDOWN_DAYS,
} from "@contracts/constants";

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

  decideZenith: adminQuery
    .input(z.object({ id: z.number(), approve: z.boolean(), note: z.string().max(1000).optional() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const app = (await db.select().from(schema.zenithApps).where(eq(schema.zenithApps.id, input.id)).limit(1)).at(0);
      if (!app) throw new TRPCError({ code: "NOT_FOUND" });
      if (["approved", "rejected"].includes(app.status)) throw new TRPCError({ code: "CONFLICT", message: "Already decided" });
      if (!input.approve) {
        await db.update(schema.zenithApps).set({ status: "rejected", note: input.note, decidedAt: new Date() })
          .where(eq(schema.zenithApps.id, app.id));
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
    const out: Array<(typeof rows)[number] & { memberCount: number }> = [];
    for (const c of rows) {
      const n = (await db.select({ n: sql<number>`count(*)` }).from(schema.members)
        .where(eq(schema.members.homeChapterId, c.id))).at(0)?.n ?? 0;
      out.push({ ...c, memberCount: n });
    }
    return out;
  }),

  saveChapter: adminQuery
    .input(z.object({
      id: z.number().optional(), name: z.string().min(2).max(255),
      city: z.string().max(128).optional(), country: z.string().max(128).optional(),
      status: z.enum(["seed", "provisional", "chartered", "mature", "at_risk"]).default("seed"),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...vals } = input;
      if (id) {
        await db.update(schema.chapters).set({
          ...vals, charterDate: vals.status === "chartered" || vals.status === "mature" ? new Date() : undefined,
        }).where(eq(schema.chapters.id, id));
      } else {
        await db.insert(schema.chapters).values(vals);
      }
      return { ok: true };
    }),

  setHomeChapter: adminQuery
    .input(z.object({ memberId: z.number(), chapterId: z.number().nullable() }))
    .mutation(async ({ input }) => {
      await getDb().update(schema.members).set({ homeChapterId: input.chapterId })
        .where(eq(schema.members.id, input.memberId));
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
      return {
        chapter,
        roster: roster.map(r => ({ id: r.member.id, name: r.user.name ?? r.user.email ?? "Member", tier: r.member.tier })),
        elections: els, motions: mos, budgets,
      };
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
        return { ok: true, turnout, memberCount, quorumMet, resultHash: hash };
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

  completeDataRequest: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const req = (await db.select().from(schema.dataRequests).where(eq(schema.dataRequests.id, input.id)).limit(1)).at(0);
      if (!req) throw new TRPCError({ code: "NOT_FOUND" });
      await db.update(schema.dataRequests).set({ status: "done" }).where(eq(schema.dataRequests.id, req.id));
      await notify(req.memberId, `Your data ${req.kind} request has been completed.`);
      return { ok: true };
    }),
});
