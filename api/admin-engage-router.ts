import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createHash } from "crypto";
import { eq, and, desc, asc, gte, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { createRouter, scopedAdmin } from "./middleware";
import { audit } from "./lib/audit";
import { safeUrl } from "./lib/url";
import {
  awardRulePoints,
  notify,
  evaluateDormancy,
  introEligibility,
} from "./queries/circle";
import {
  listSaveCases,
  updateSaveCase,
  closeSaveCase,
  openSaveCase,
  reopenSaveCase,
  saveCaseSummary,
} from "./queries/saves";
import {
  listCouncil,
  createCouncilMeeting,
  updateCouncilMeeting,
  logDecision,
  updateDecision,
} from "./queries/councils";
import { chaptersOverview, chapterActivity } from "./queries/chapter-admin";
import {
  listCycles,
  createCycle,
  awardUnits,
  updateCycleStatus,
  listNominations,
  nominate,
  setNominationStatus,
} from "./queries/awards";
import {
  setCycleRubric,
  assignJudge,
  removeJudge,
  listJudges,
  submitScore,
  judgingBoard,
  ratifyWinner,
} from "./queries/award-judging";
import { autoScoreCycle } from "./queries/award-autoscore";
import { recordAutoWinner, memberAwards } from "./queries/award-records";
import { voteTally, recordVoteWinner } from "./queries/award-voting";
import {
  hallOfFameBoard,
  inductHallOfFame,
  hallOfFameInductees,
} from "./queries/award-halloffame";
import {
  scanCycleIntegrity,
  listFlags,
  raiseFlag,
  resolveFlag,
} from "./queries/award-integrity";
import { computeChapterHealth } from "./queries/health";
import {
  ensureCadenceTemplates,
  listCadences,
  recordCadence,
} from "./queries/cadence";
import { CADENCE_STATUSES } from "@contracts/cadence";
import {
  POINT_RULE_KEYS,
  POINT_RULE_LABEL,
  POINT_RULE_FACTOR,
  POINT_RULE_DEFAULTS,
  ZENITH_CAP,
  INVESTOR_COOLDOWN_DAYS,
  EVENT_CHECKIN_OPENS_BEFORE_MS,
  EVENT_CHECKIN_CLOSES_AFTER_MS,
  SPEND_APPROVAL_THRESHOLD_AED,
  MEETING_AGENDA_TEMPLATES,
  AWARD_LEVEL_KEYS,
  AWARD_CATEGORY_LABEL,
  seatToChapterRole,
} from "@contracts/constants";

function isFullAdmin(user: { adminScopes?: string | null }): boolean {
  const s = (user.adminScopes ?? "").trim();
  return s === "" || s === "*";
}

export const adminEngageRouter = createRouter({
  /* ---- point rules (BRD 7.2 admin-configurable) ---- */
  pointRules: scopedAdmin("community").query(async () => {
    const rows = await getDb().select().from(schema.pointRules);
    return POINT_RULE_KEYS.map(k => ({
      key: k,
      label: POINT_RULE_LABEL[k],
      factor: POINT_RULE_FACTOR[k],
      points: rows.find(r => r.key === k)?.points ?? POINT_RULE_DEFAULTS[k],
      updatedAt: rows.find(r => r.key === k)?.updatedAt ?? null,
    }));
  }),

  setPointRule: scopedAdmin("community")
    .input(
      z.object({
        key: z.enum(POINT_RULE_KEYS),
        points: z.number().min(-100).max(100),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const existing = await db
        .select()
        .from(schema.pointRules)
        .where(eq(schema.pointRules.key, input.key))
        .limit(1);
      if (existing.length) {
        await db
          .update(schema.pointRules)
          .set({ points: input.points })
          .where(eq(schema.pointRules.key, input.key));
      } else {
        await db.insert(schema.pointRules).values({
          key: input.key,
          points: input.points,
          factor: POINT_RULE_FACTOR[input.key],
          label: POINT_RULE_LABEL[input.key],
        });
      }
      return { ok: true };
    }),

  /* ---- engagement standard per tier (BRD 6.3) ---- */
  engagementConfig: scopedAdmin("community").query(async () => {
    return getDb().select().from(schema.engagementConfig);
  }),

  setEngagementConfig: scopedAdmin("community")
    .input(
      z.object({
        tier: z.enum(["horizon", "ascent", "vanguard", "zenith"]),
        sessionsRequired: z.number().min(0).max(52).nullable().optional(),
        sessionsOffered: z.number().min(0).max(52).nullable().optional(),
        oneToOnesPerQuarter: z.number().min(0).max(24).nullable().optional(),
        giveBackPerYear: z.number().min(0).max(24).nullable().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const { tier, ...vals } = input;
      const existing = await db
        .select()
        .from(schema.engagementConfig)
        .where(eq(schema.engagementConfig.tier, tier))
        .limit(1);
      if (existing.length) {
        await db
          .update(schema.engagementConfig)
          .set(vals)
          .where(eq(schema.engagementConfig.tier, tier));
      } else {
        await db.insert(schema.engagementConfig).values({ tier, ...vals });
      }
      return { ok: true };
    }),

  /* ---- dormancy ladder (BRD 6.3) ---- */
  dormancyBoard: scopedAdmin("member_success").query(async () => {
    const db = getDb();
    const rows = await db
      .select({ member: schema.members, user: schema.users })
      .from(schema.members)
      .innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
      .orderBy(asc(schema.members.dormancyStage), asc(schema.users.name))
      .limit(300);
    const log = await db
      .select()
      .from(schema.dormancyLog)
      .orderBy(desc(schema.dormancyLog.createdAt))
      .limit(40);
    return { rows, log };
  }),

  runDormancyEvaluation: scopedAdmin("member_success").mutation(async () => {
    return evaluateDormancy();
  }),

  setDormancyOverride: scopedAdmin("member_success")
    .input(
      z.object({
        memberId: z.number(),
        stage: z.enum(["active", "at_risk", "dormant", "non_renewal"]),
        note: z.string().min(3).max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const m = (
        await db
          .select()
          .from(schema.members)
          .where(eq(schema.members.id, input.memberId))
          .limit(1)
      ).at(0);
      if (!m) throw new TRPCError({ code: "NOT_FOUND" });
      const from = m.dormancyStage ?? "active";
      await db
        .update(schema.members)
        .set({ dormancyStage: input.stage, dormancyNote: input.note })
        .where(eq(schema.members.id, m.id));
      await db.insert(schema.dormancyLog).values({
        memberId: m.id,
        fromStage: from,
        toStage: input.stage,
        reason: input.note,
        actor: ctx.user.name ?? ctx.user.email ?? "admin",
      });
      await notify(
        m.id,
        `Your engagement status was set to ${input.stage} by the eHive team. ${input.note}`,
        "dormancy"
      );
      return { ok: true };
    }),

  setExceptionPause: scopedAdmin("member_success")
    .input(
      z.object({
        memberId: z.number(),
        quarters: z.number().min(0).max(4),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      await db
        .update(schema.members)
        .set({
          exceptionPause: input.quarters,
          dormancyNote: input.note ?? null,
        })
        .where(eq(schema.members.id, input.memberId));
      if (input.note)
        await notify(
          input.memberId,
          `An exception pause was applied to your engagement review. ${input.note}`,
          "dormancy"
        );
      return { ok: true };
    }),

  sendNotification: scopedAdmin("community")
    .input(z.object({ memberId: z.number(), text: z.string().min(3).max(500) }))
    .mutation(async ({ input }) => {
      await notify(input.memberId, input.text);
      return { ok: true };
    }),

  /* ---- buddy pairing admin (BRD 6.3: paired within 5 days) ---- */
  buddyBoard: scopedAdmin("community").query(async () => {
    const db = getDb();
    const pairs = await db
      .select()
      .from(schema.buddies)
      .orderBy(desc(schema.buddies.pairedAt))
      .limit(60);
    const ids = [
      ...new Set(pairs.flatMap(p => [p.newMemberId, p.buddyMemberId])),
    ];
    const people = ids.length
      ? await db
          .select({ member: schema.members, user: schema.users })
          .from(schema.members)
          .innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
          .where(
            sql`${schema.members.id} in (${sql.join(
              ids.map(i => sql`${i}`),
              sql`, `
            )})`
          )
      : [];
    const nameOf = new Map(
      people.map(p => [p.member.id, p.user.name ?? p.user.email ?? "Member"])
    );
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const pairedNew = new Set(pairs.map(p => p.newMemberId));
    const recentMembers = await db
      .select({ member: schema.members, user: schema.users })
      .from(schema.members)
      .innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
      .where(
        and(
          eq(schema.members.status, "active"),
          gte(schema.members.createdAt, fiveDaysAgo)
        )
      )
      .limit(50);
    const unpaired = recentMembers
      .filter(r => !pairedNew.has(r.member.id))
      .map(r => ({
        id: r.member.id,
        name: r.user.name ?? r.user.email ?? "Member",
        since: r.member.createdAt,
      }));
    const candidates = await db
      .select({ member: schema.members, user: schema.users })
      .from(schema.members)
      .innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
      .where(
        and(
          eq(schema.members.status, "active"),
          sql`${schema.members.dormancyStage} = 'active'`
        )
      )
      .orderBy(asc(schema.users.name))
      .limit(200);
    return {
      pairs: pairs.map(p => ({
        ...p,
        newName: nameOf.get(p.newMemberId) ?? "Member",
        buddyName: nameOf.get(p.buddyMemberId) ?? "Member",
      })),
      unpaired,
      candidates: candidates.map(c => ({
        id: c.member.id,
        name: c.user.name ?? c.user.email ?? "Member",
      })),
    };
  }),

  pairBuddy: scopedAdmin("community")
    .input(
      z.object({
        newMemberId: z.number(),
        buddyMemberId: z.number(),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input }) => {
      if (input.newMemberId === input.buddyMemberId)
        throw new TRPCError({ code: "BAD_REQUEST" });
      const db = getDb();
      await db.insert(schema.buddies).values(input);
      await notify(
        input.newMemberId,
        "You've been paired with an eHive buddy — say hello!",
        "connect"
      );
      await notify(
        input.buddyMemberId,
        "You've been assigned as a buddy to a new member. Check-in due in 30 days.",
        "connect"
      );
      return { ok: true };
    }),

  /* ---- referrals admin ---- */
  referralsAdmin: scopedAdmin("community").query(async () => {
    const db = getDb();
    const rows = await db
      .select({ referral: schema.referrals, user: schema.users })
      .from(schema.referrals)
      .innerJoin(
        schema.members,
        eq(schema.referrals.memberId, schema.members.id)
      )
      .innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
      .orderBy(desc(schema.referrals.createdAt))
      .limit(100);
    return rows.map(r => ({
      ...r.referral,
      memberName: r.user.name ?? r.user.email ?? "Member",
    }));
  }),

  setReferralStatus: scopedAdmin("community")
    .input(
      z.object({
        id: z.number(),
        status: z.enum(["submitted", "converted", "rejected"]),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const r = (
        await db
          .select()
          .from(schema.referrals)
          .where(eq(schema.referrals.id, input.id))
          .limit(1)
      ).at(0);
      if (!r) throw new TRPCError({ code: "NOT_FOUND" });
      await db
        .update(schema.referrals)
        .set({ status: input.status })
        .where(eq(schema.referrals.id, r.id));
      if (input.status === "converted" && r.status !== "converted") {
        await awardRulePoints(
          r.memberId,
          "referral_converted",
          "Referral converted: " + r.prospectName
        );
        await notify(
          r.memberId,
          `Your referral ${r.prospectName} converted — bonus points awarded.`,
          "connect"
        );
      }
      return { ok: true };
    }),

  /* ---- deals admin (staff posts + moderation) ---- */
  dealsAdmin: scopedAdmin("partnerships").query(async () => {
    return getDb()
      .select()
      .from(schema.deals)
      .orderBy(desc(schema.deals.createdAt))
      .limit(100);
  }),

  saveDeal: scopedAdmin("partnerships")
    .input(
      z.object({
        id: z.number().optional(),
        title: z.string().min(4).max(255),
        description: z.string().max(4000).optional(),
        tierGate: z
          .enum(["horizon", "ascent", "vanguard", "zenith"])
          .default("ascent"),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...vals } = input;
      if (id)
        await db.update(schema.deals).set(vals).where(eq(schema.deals.id, id));
      else await db.insert(schema.deals).values({ ...vals, postedBy: null });
      return { ok: true };
    }),

  deleteDeal: scopedAdmin("partnerships")
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await getDb().delete(schema.deals).where(eq(schema.deals.id, input.id));
      return { ok: true };
    }),

  /* ---- 1-2-1 oversight ---- */
  oneToOnesAdmin: scopedAdmin("community").query(async () => {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.oneToOnes)
      .orderBy(desc(schema.oneToOnes.createdAt))
      .limit(100);
    const ids = [...new Set(rows.flatMap(r => [r.aMemberId, r.bMemberId]))];
    const people = ids.length
      ? await db
          .select({ member: schema.members, user: schema.users })
          .from(schema.members)
          .innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
          .where(
            sql`${schema.members.id} in (${sql.join(
              ids.map(i => sql`${i}`),
              sql`, `
            )})`
          )
      : [];
    const nameOf = new Map(
      people.map(p => [p.member.id, p.user.name ?? p.user.email ?? "Member"])
    );
    return rows.map(r => ({
      ...r,
      aName: nameOf.get(r.aMemberId) ?? "—",
      bName: nameOf.get(r.bMemberId) ?? "—",
    }));
  }),

  /* ---- event door: check-in by code, no-show penalties, feedback ---- */
  eventCheckinByCode: scopedAdmin("events")
    .input(z.object({ code: z.string().min(4).max(12) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const reg = (
        await db
          .select()
          .from(schema.eventRegs)
          .where(
            eq(schema.eventRegs.checkinCode, input.code.trim().toUpperCase())
          )
          .limit(1)
      ).at(0);
      if (!reg)
        throw new TRPCError({ code: "NOT_FOUND", message: "Code not found" });
      if (reg.status === "attended")
        return { ok: true, already: true, memberId: reg.memberId };
      if (reg.status !== "registered")
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Registration is " + reg.status,
        });
      // Door check-in only records attendance around the event itself.
      const ev = (
        await db
          .select()
          .from(schema.events)
          .where(eq(schema.events.id, reg.eventId))
          .limit(1)
      ).at(0);
      if (ev) {
        const start = new Date(ev.startsAt).getTime();
        const now = Date.now();
        if (now < start - EVENT_CHECKIN_OPENS_BEFORE_MS)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "This event hasn't started — check-in opens 2 hours before it begins.",
          });
        if (now > start + EVENT_CHECKIN_CLOSES_AFTER_MS)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Check-in for this event has closed.",
          });
      }
      await db
        .update(schema.eventRegs)
        .set({ status: "attended" })
        .where(eq(schema.eventRegs.id, reg.id));
      await awardRulePoints(reg.memberId, "event_attend", "Event check-in");
      return { ok: true, memberId: reg.memberId };
    }),

  markNoShow: scopedAdmin("events")
    .input(z.object({ regId: z.number(), excused: z.boolean().default(false) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const reg = (
        await db
          .select()
          .from(schema.eventRegs)
          .where(eq(schema.eventRegs.id, input.regId))
          .limit(1)
      ).at(0);
      if (!reg) throw new TRPCError({ code: "NOT_FOUND" });
      if (reg.status === "attended")
        throw new TRPCError({ code: "CONFLICT", message: "Member attended" });
      const tag = `no-show reg#${reg.id}`;
      const dup = await db
        .select({ n: sql<number>`count(*)` })
        .from(schema.scoreEvents)
        .where(
          and(
            eq(schema.scoreEvents.memberId, reg.memberId),
            sql`${schema.scoreEvents.note} like ${"%" + tag + "%"}`
          )
        );
      if ((dup.at(0)?.n ?? 0) > 0)
        throw new TRPCError({
          code: "CONFLICT",
          message: "No-show already recorded",
        });
      await awardRulePoints(
        reg.memberId,
        input.excused ? "no_show_excused" : "no_show",
        `Event ${tag}${input.excused ? " (excused)" : ""}`
      );
      await notify(
        reg.memberId,
        input.excused
          ? "Your absence was recorded as excused."
          : "You were marked as a no-show. Points were deducted per the engagement rules.",
        "event"
      );
      return { ok: true };
    }),

  eventFeedbackAdmin: scopedAdmin("events")
    .input(z.object({ eventId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select({ fb: schema.eventFeedback, user: schema.users })
        .from(schema.eventFeedback)
        .innerJoin(
          schema.members,
          eq(schema.eventFeedback.memberId, schema.members.id)
        )
        .innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
        .where(eq(schema.eventFeedback.eventId, input.eventId))
        .orderBy(desc(schema.eventFeedback.createdAt));
      const avg = rows.length
        ? rows.reduce((a, r) => a + r.fb.rating, 0) / rows.length
        : null;
      return {
        rows: rows.map(r => ({
          ...r.fb,
          memberName: r.user.name ?? r.user.email ?? "Member",
        })),
        avg,
      };
    }),

  /* ---- Zenith admissions admin (BRD 6.6) ---- */
  zenithAdmin: scopedAdmin("member_success").query(async () => {
    const db = getDb();
    const apps = await db
      .select()
      .from(schema.zenithApps)
      .orderBy(desc(schema.zenithApps.createdAt))
      .limit(60);
    const out: Array<
      (typeof apps)[number] & {
        endorsements: {
          role: (typeof schema.endorsements.$inferSelect)["role"];
          name: string;
        }[];
        weight: number;
      }
    > = [];
    for (const a of apps) {
      const end = await db
        .select({ e: schema.endorsements, user: schema.users })
        .from(schema.endorsements)
        .innerJoin(
          schema.members,
          eq(schema.endorsements.memberId, schema.members.id)
        )
        .innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
        .where(eq(schema.endorsements.appId, a.id));
      out.push({
        ...a,
        endorsements: end.map(x => ({
          role: x.e.role,
          name: x.user.name ?? x.user.email ?? "Member",
        })),
        weight: end.reduce((w, x) => w + (x.e.role === "board" ? 2 : 1), 0),
      });
    }
    const zen = await db
      .select({ n: sql<number>`count(*)` })
      .from(schema.members)
      .where(eq(schema.members.tier, "zenith"));
    return { apps: out, zenithCount: zen.at(0)?.n ?? 0, cap: ZENITH_CAP };
  }),

  /* ---- ML-04b Save Playbook (at-risk interventions, member_success scope) ---- */
  savesList: scopedAdmin("member_success")
    .input(
      z
        .object({ status: z.enum(["open", "closed", "all"]).default("open") })
        .optional()
    )
    .query(({ input }) => listSaveCases({ status: input?.status ?? "open" })),

  savesSummary: scopedAdmin("member_success").query(() => saveCaseSummary()),

  saveUpdate: scopedAdmin("member_success")
    .input(
      z.object({
        id: z.number(),
        ownerUserId: z.number().nullable().optional(),
        stepsMask: z.number().int().min(0).max(1023).optional(),
        notes: z.string().max(4000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await updateSaveCase(input.id, {
        ownerUserId: input.ownerUserId,
        stepsMask: input.stepsMask,
        notes: input.notes,
      });
      await audit(ctx.user, "save.update", { type: "saveCase", id: input.id });
      return { ok: true };
    }),

  saveClose: scopedAdmin("member_success")
    .input(
      z.object({
        id: z.number(),
        outcome: z.enum(["saved", "lost"]),
        resolution: z.string().max(1000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const memberId = await closeSaveCase(
        input.id,
        input.outcome,
        input.resolution
      );
      if (memberId == null)
        throw new TRPCError({
          code: "CONFLICT",
          message: "This case is already closed.",
        });
      await audit(ctx.user, `save.${input.outcome}`, {
        type: "saveCase",
        id: input.id,
      });
      return { ok: true };
    }),

  saveOpen: scopedAdmin("member_success")
    .input(
      z.object({ memberId: z.number(), reason: z.string().min(1).max(255) })
    )
    .mutation(async ({ ctx, input }) => {
      const id = await openSaveCase(input.memberId, input.reason);
      await audit(ctx.user, "save.open", { type: "saveCase", id });
      return { ok: true, id };
    }),

  saveReopen: scopedAdmin("member_success")
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const ok = await reopenSaveCase(input.id);
      if (!ok)
        throw new TRPCError({
          code: "CONFLICT",
          message: "This case is already open.",
        });
      await audit(ctx.user, "save.reopen", { type: "saveCase", id: input.id });
      return { ok: true };
    }),

  decideZenith: scopedAdmin("member_success")
    .input(
      z.object({
        id: z.number(),
        approve: z.boolean(),
        note: z.string().max(1000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const app = (
        await db
          .select()
          .from(schema.zenithApps)
          .where(eq(schema.zenithApps.id, input.id))
          .limit(1)
      ).at(0);
      if (!app) throw new TRPCError({ code: "NOT_FOUND" });
      if (["approved", "rejected"].includes(app.status))
        throw new TRPCError({ code: "CONFLICT", message: "Already decided" });
      if (!input.approve) {
        await db
          .update(schema.zenithApps)
          .set({ status: "rejected", note: input.note, decidedAt: new Date() })
          .where(eq(schema.zenithApps.id, app.id));
        await audit(ctx.user, "zenith.reject", {
          type: "zenithApp",
          id: app.id,
        });
        return { ok: true };
      }
      // cap of 50 + induction number
      const zen = await db
        .select({ n: sql<number>`count(*)` })
        .from(schema.members)
        .where(eq(schema.members.tier, "zenith"));
      if ((zen.at(0)?.n ?? 0) >= ZENITH_CAP)
        throw new TRPCError({
          code: "CONFLICT",
          message: `Zenith is capped at ${ZENITH_CAP} members`,
        });
      const maxInd = await db
        .select({
          m: sql<number>`coalesce(max(${schema.members.inductionNo}),0)`,
        })
        .from(schema.members);
      const inductionNo = (maxInd.at(0)?.m ?? 0) + 1;
      const user = (
        await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.email, app.email))
          .limit(1)
      ).at(0);
      if (user) {
        const existing = (
          await db
            .select()
            .from(schema.members)
            .where(eq(schema.members.userId, user.id))
            .limit(1)
        ).at(0);
        if (existing) {
          await db
            .update(schema.members)
            .set({ tier: "zenith", inductionNo })
            .where(eq(schema.members.id, existing.id));
          await db.insert(schema.membershipEvents).values({
            memberId: existing.id,
            type: "upgrade",
            fromTier: existing.tier,
            toTier: "zenith",
            note: `Zenith induction №${inductionNo}`,
          });
        } else {
          const renew = new Date();
          renew.setFullYear(renew.getFullYear() + 1);
          // A newly inducted Zenith member enters onboarding like any other new
          // member (status stays active via statusForLifecycle) so they run the
          // first 30/60/90-day journey and receive the onboarding welcome.
          const res = await db.insert(schema.members).values({
            userId: user.id,
            tier: "zenith",
            status: "active",
            lifecycleState: "onboarding",
            renewalAt: renew,
            inductionNo,
          });
          const memberId = Number(res[0].insertId);
          try {
            await notify(
              memberId,
              "Welcome to eHive Circle. Your onboarding journey starts now.",
              "membership"
            );
          } catch {
            /* non-fatal */
          }
        }
      }
      await db
        .update(schema.zenithApps)
        .set({ status: "approved", note: input.note, decidedAt: new Date() })
        .where(eq(schema.zenithApps.id, app.id));
      await audit(ctx.user, "zenith.approve", {
        type: "zenithApp",
        id: app.id,
        detail: `induction №${inductionNo}`,
      });
      return { ok: true, inductionNo };
    }),

  /* ---- investor relationship tracker (BRD 6.6) ---- */
  investorIntros: scopedAdmin("partnerships").query(async () => {
    const db = getDb();
    const rows = await db
      .select({ intro: schema.investorIntros, user: schema.users })
      .from(schema.investorIntros)
      .innerJoin(
        schema.members,
        eq(schema.investorIntros.memberId, schema.members.id)
      )
      .innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
      .orderBy(desc(schema.investorIntros.createdAt))
      .limit(100);
    return rows.map(r => ({
      ...r.intro,
      memberName: r.user.name ?? r.user.email ?? "Member",
    }));
  }),

  addInvestorIntro: scopedAdmin("partnerships")
    .input(
      z.object({
        investorName: z.string().min(2).max(255),
        firm: z.string().max(255).optional(),
        memberId: z.number(),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const elig = await introEligibility(input.memberId);
      if (!elig.eligible)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Not intro-eligible: " + elig.reasons.join("; "),
        });
      const since = new Date(
        Date.now() - INVESTOR_COOLDOWN_DAYS * 24 * 60 * 60 * 1000
      );
      const dupe = await db
        .select({ n: sql<number>`count(*)` })
        .from(schema.investorIntros)
        .where(
          and(
            eq(schema.investorIntros.memberId, input.memberId),
            sql`lower(${schema.investorIntros.investorName}) = lower(${input.investorName})`,
            gte(schema.investorIntros.createdAt, since)
          )
        );
      if ((dupe.at(0)?.n ?? 0) > 0)
        throw new TRPCError({
          code: "CONFLICT",
          message: `Cool-down: this investor was introduced to this member within ${INVESTOR_COOLDOWN_DAYS} days`,
        });
      await db.insert(schema.investorIntros).values({
        ...input,
        introducedBy: ctx.user.name ?? ctx.user.email ?? "staff",
      });
      await notify(
        input.memberId,
        `An introduction to ${input.investorName}${input.firm ? " (" + input.firm + ")" : ""} was arranged for you.`
      );
      return { ok: true };
    }),

  checkIntroEligibility: scopedAdmin("partnerships")
    .input(z.object({ memberId: z.number() }))
    .query(async ({ input }) => introEligibility(input.memberId)),

  /* Command-strip overview for the chapter list (stage mix, health, at-risk). */
  chaptersOverview: scopedAdmin("chapters").query(() => chaptersOverview()),

  /* Unified per-chapter activity ledger (ERP parity). */
  chapterActivity: scopedAdmin("chapters")
    .input(z.object({ id: z.number() }))
    .query(({ input }) => chapterActivity(input.id)),

  /* ---- chapters admin (BRD 6.7) ---- */
  chaptersAdmin: scopedAdmin("chapters").query(async () => {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.chapters)
      .where(isNull(schema.chapters.deletedAt))
      .orderBy(asc(schema.chapters.name));
    // Batch member counts (was N+1) and the latest saved health snapshot per chapter.
    const ids = rows.map(r => r.id);
    const counts = ids.length
      ? await db
          .select({
            chapterId: schema.members.homeChapterId,
            n: sql<number>`count(*)`,
          })
          .from(schema.members)
          .where(
            sql`${schema.members.homeChapterId} in (${sql.join(
              ids.map(i => sql`${i}`),
              sql`, `
            )})`
          )
          .groupBy(schema.members.homeChapterId)
      : [];
    const countMap = new Map(counts.map(c => [c.chapterId, Number(c.n)]));
    const snaps = ids.length
      ? await db
          .select()
          .from(schema.healthSnapshots)
          .where(
            sql`${schema.healthSnapshots.chapterId} in (${sql.join(
              ids.map(i => sql`${i}`),
              sql`, `
            )})`
          )
          .orderBy(desc(schema.healthSnapshots.createdAt))
      : [];
    const latestHealth = new Map<number, number>();
    for (const s of snaps)
      if (!latestHealth.has(s.chapterId))
        latestHealth.set(s.chapterId, s.total);
    return rows.map(c => ({
      ...c,
      memberCount: countMap.get(c.id) ?? 0,
      lastHealth: latestHealth.get(c.id) ?? null,
    }));
  }),

  /* Chapter Health Index — live compute + last snapshot for trend (CH-06). */
  chapterHealth: scopedAdmin("chapters")
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const health = await computeChapterHealth(input.id);
      const last =
        (
          await getDb()
            .select()
            .from(schema.healthSnapshots)
            .where(eq(schema.healthSnapshots.chapterId, input.id))
            .orderBy(desc(schema.healthSnapshots.createdAt))
            .limit(1)
        ).at(0) ?? null;
      return { ...health, lastSnapshot: last };
    }),

  /* Save the quarterly snapshot (CH-06) — for trend and Zone comparison. */
  saveHealthSnapshot: scopedAdmin("chapters")
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const h = await computeChapterHealth(input.id);
      await getDb()
        .insert(schema.healthSnapshots)
        .values({
          chapterId: input.id,
          total: h.total,
          memberCount: h.memberCount,
          ...h.components,
        });
      await audit(ctx.user, "chapter.health.snapshot", {
        type: "chapter",
        id: input.id,
        detail: `index ${h.total} (${h.band})`,
      });
      return { ok: true, total: h.total };
    }),

  saveChapter: scopedAdmin("chapters")
    .input(
      z.object({
        id: z.number().optional(),
        name: z.string().min(2).max(255),
        code: z.string().max(24).optional(),
        country: z.string().max(128).optional(),
        region: z.string().max(128).optional(),
        state: z.string().max(128).optional(),
        city: z.string().max(128).optional(),
        zone: z.string().max(128).optional(),
        meetingCadence: z.string().max(64).optional(),
        status: z
          .enum(["seed", "provisional", "chartered", "mature", "at_risk"])
          .default("seed"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const { id, ...vals } = input;
      if (id) {
        await db
          .update(schema.chapters)
          .set({
            ...vals,
            charterDate:
              vals.status === "chartered" || vals.status === "mature"
                ? new Date()
                : undefined,
          })
          .where(eq(schema.chapters.id, id));
        await audit(ctx.user, "chapter.update", {
          type: "chapter",
          id,
          detail: vals.name,
        });
      } else {
        const res = await db.insert(schema.chapters).values(vals);
        await audit(ctx.user, "chapter.create", {
          type: "chapter",
          id: Number(res[0].insertId),
          detail: vals.name,
        });
      }
      return { ok: true };
    }),

  archiveChapter: scopedAdmin("chapters")
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const chapter = (
        await db
          .select()
          .from(schema.chapters)
          .where(
            and(
              eq(schema.chapters.id, input.id),
              isNull(schema.chapters.deletedAt)
            )
          )
          .limit(1)
      ).at(0);
      if (!chapter)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Chapter not found",
        });
      const [active] = await db
        .select({ n: sql<number>`count(*)` })
        .from(schema.members)
        .where(
          and(
            eq(schema.members.homeChapterId, input.id),
            eq(schema.members.status, "active")
          )
        );
      if ((active?.n ?? 0) > 0)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Archive failed: chapter still has active members. Reassign them first.",
        });
      await db
        .update(schema.chapters)
        .set({ deletedAt: new Date(), status: "at_risk" })
        .where(eq(schema.chapters.id, input.id));
      await audit(ctx.user, "chapter.archive", {
        type: "chapter",
        id: input.id,
        detail: chapter.name,
      });
      return { ok: true };
    }),

  /* Assign (or clear) a member's home chapter directly — the admin path used
     from Chapter management and the member 360°. */
  setHomeChapter: scopedAdmin("chapters")
    .input(z.object({ memberId: z.number(), chapterId: z.number().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await db
        .update(schema.members)
        .set({ homeChapterId: input.chapterId })
        .where(eq(schema.members.id, input.memberId));
      await audit(ctx.user, "member.chapter", {
        type: "member",
        id: input.memberId,
        detail: input.chapterId
          ? `→ chapter #${input.chapterId}`
          : "unassigned",
      });
      return { ok: true };
    }),

  /* Members available to add to a chapter — searchable, with their current
     chapter so admins don't move someone by accident. */
  assignableMembers: scopedAdmin("chapters")
    .input(
      z.object({
        q: z.string().max(120).optional(),
        excludeChapterId: z.number().optional(),
      })
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conds = [eq(schema.members.status, "active")];
      if (input.q) {
        const like = `%${input.q}%`;
        conds.push(
          sql`(${schema.users.name} like ${like} or ${schema.users.email} like ${like} or ${schema.members.company} like ${like})`
        );
      }
      if (input.excludeChapterId != null)
        conds.push(
          sql`(${schema.members.homeChapterId} is null or ${schema.members.homeChapterId} <> ${input.excludeChapterId})`
        );
      const rows = await db
        .select({
          id: schema.members.id,
          name: schema.users.name,
          email: schema.users.email,
          company: schema.members.company,
          homeChapterId: schema.members.homeChapterId,
          chapterName: schema.chapters.name,
        })
        .from(schema.members)
        .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
        .leftJoin(
          schema.chapters,
          eq(schema.chapters.id, schema.members.homeChapterId)
        )
        .where(and(...conds))
        .orderBy(asc(schema.users.name))
        .limit(50);
      return rows;
    }),

  /* Member-requested chapter transfers awaiting management approval. */
  pendingChapterTransfers: scopedAdmin("chapters").query(async () => {
    const db = getDb();
    const from = alias(schema.chapters, "fromCh");
    const to = alias(schema.chapters, "toCh");
    return db
      .select({
        req: schema.chapterTransfers,
        memberName: schema.users.name,
        memberEmail: schema.users.email,
        fromName: from.name,
        toName: to.name,
      })
      .from(schema.chapterTransfers)
      .innerJoin(
        schema.members,
        eq(schema.members.id, schema.chapterTransfers.memberId)
      )
      .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
      .leftJoin(from, eq(from.id, schema.chapterTransfers.fromChapterId))
      .leftJoin(to, eq(to.id, schema.chapterTransfers.toChapterId))
      .where(eq(schema.chapterTransfers.status, "pending"))
      .orderBy(desc(schema.chapterTransfers.createdAt))
      .limit(100);
  }),

  /* Approve or reject a transfer. The home chapter moves only on approval. */
  decideChapterTransfer: scopedAdmin("chapters")
    .input(
      z.object({
        id: z.number(),
        decision: z.enum(["approve", "reject"]),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const req = (
        await db
          .select()
          .from(schema.chapterTransfers)
          .where(eq(schema.chapterTransfers.id, input.id))
          .limit(1)
      ).at(0);
      if (!req)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Request not found",
        });
      if (req.status !== "pending")
        throw new TRPCError({ code: "CONFLICT", message: "Already decided." });
      let toChapterName: string | null = null;
      if (input.decision === "approve") {
        // Validate the destination chapter still exists (and isn't archived)
        // before moving the member into it.
        const toChapter = (
          await db
            .select({ id: schema.chapters.id, name: schema.chapters.name })
            .from(schema.chapters)
            .where(
              and(
                eq(schema.chapters.id, req.toChapterId),
                isNull(schema.chapters.deletedAt)
              )
            )
            .limit(1)
        ).at(0);
        if (!toChapter)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The destination chapter no longer exists.",
          });
        toChapterName = toChapter.name;
        await db
          .update(schema.members)
          .set({ homeChapterId: req.toChapterId })
          .where(eq(schema.members.id, req.memberId));
      }
      await db
        .update(schema.chapterTransfers)
        .set({
          status: input.decision === "approve" ? "approved" : "rejected",
          actorEmail: ctx.user.email,
          decidedAt: new Date(),
          note: input.note ?? req.note,
        })
        .where(eq(schema.chapterTransfers.id, req.id));
      // Notify the member of the outcome.
      try {
        await notify(
          req.memberId,
          input.decision === "approve"
            ? `Your chapter transfer to ${toChapterName ?? "your new chapter"} has been approved.`
            : "Your chapter transfer request wasn't approved. Your chapter membership is unchanged.",
          "membership"
        );
      } catch {
        /* non-fatal */
      }
      await audit(ctx.user, `chapter.transfer.${input.decision}`, {
        type: "member",
        id: req.memberId,
        detail: `→ chapter #${req.toChapterId}`,
      });
      return { ok: true };
    }),

  chapterDetail: scopedAdmin("chapters")
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const chapter = (
        await db
          .select()
          .from(schema.chapters)
          .where(
            and(
              eq(schema.chapters.id, input.id),
              isNull(schema.chapters.deletedAt)
            )
          )
          .limit(1)
      ).at(0);
      if (!chapter) throw new TRPCError({ code: "NOT_FOUND" });
      const roster = await db
        .select({ member: schema.members, user: schema.users })
        .from(schema.members)
        .innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
        .where(eq(schema.members.homeChapterId, chapter.id))
        .orderBy(asc(schema.users.name))
        .limit(200);
      const els = await db
        .select()
        .from(schema.elections)
        .where(eq(schema.elections.chapterId, chapter.id))
        .orderBy(desc(schema.elections.createdAt))
        .limit(20);
      const mos = await db
        .select()
        .from(schema.motions)
        .where(eq(schema.motions.chapterId, chapter.id))
        .orderBy(desc(schema.motions.createdAt))
        .limit(20);
      const budgets = await db
        .select()
        .from(schema.chapterBudgets)
        .where(eq(schema.chapterBudgets.chapterId, chapter.id))
        .orderBy(desc(schema.chapterBudgets.createdAt))
        .limit(40);
      const roles = await db
        .select({
          role: schema.chapterRoles,
          name: schema.users.name,
          email: schema.users.email,
        })
        .from(schema.chapterRoles)
        .leftJoin(
          schema.members,
          eq(schema.members.id, schema.chapterRoles.memberId)
        )
        .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
        .where(
          and(
            eq(schema.chapterRoles.chapterId, chapter.id),
            eq(schema.chapterRoles.status, "active")
          )
        )
        .orderBy(asc(schema.chapterRoles.createdAt));
      const cadence = await listCadences(chapter.id);
      const meetings = await db
        .select()
        .from(schema.meetings)
        .where(eq(schema.meetings.chapterId, chapter.id))
        .orderBy(desc(schema.meetings.createdAt))
        .limit(30);
      return {
        chapter,
        roster,
        board: roles.map(r => ({
          ...r.role,
          memberName: r.name ?? r.email ?? "Member",
        })),
        cadence,
        elections: els,
        motions: mos,
        budgets,
        meetings,
      };
    }),

  /* M3 — create a chapter/board meeting with the default agenda pre-loaded. */
  createMeeting: scopedAdmin("chapters")
    .input(
      z.object({
        chapterId: z.number(),
        kind: z.enum(["chapter_meeting", "board_meeting", "huddle", "other"]),
        title: z.string().min(3).max(255),
        scheduledAt: z.string().datetime().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const res = await getDb()
        .insert(schema.meetings)
        .values({
          chapterId: input.chapterId,
          kind: input.kind,
          title: input.title,
          scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
          agenda: MEETING_AGENDA_TEMPLATES[input.kind] ?? "",
        });
      await audit(ctx.user, "meeting.create", {
        type: "chapter",
        id: input.chapterId,
        detail: input.kind,
      });
      return { ok: true, id: Number(res[0].insertId) };
    }),

  /* Edit agenda / minutes / status of a meeting. */
  saveMeeting: scopedAdmin("chapters")
    .input(
      z.object({
        id: z.number(),
        title: z.string().min(3).max(255).optional(),
        agenda: z.string().max(10000).optional(),
        minutes: z.string().max(20000).optional(),
        status: z.enum(["scheduled", "held", "cancelled"]).optional(),
        scheduledAt: z.string().datetime().nullable().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, scheduledAt, ...rest } = input;
      const patch: Partial<typeof schema.meetings.$inferInsert> = { ...rest };
      if (scheduledAt !== undefined)
        patch.scheduledAt = scheduledAt ? new Date(scheduledAt) : null;
      await getDb()
        .update(schema.meetings)
        .set(patch)
        .where(eq(schema.meetings.id, id));
      return { ok: true };
    }),

  meetingAttendance: scopedAdmin("chapters")
    .input(z.object({ meetingId: z.number() }))
    .query(async ({ input }) => {
      return getDb()
        .select()
        .from(schema.meetingAttendance)
        .where(eq(schema.meetingAttendance.meetingId, input.meetingId));
    }),

  /* Replace a meeting's attendance with the supplied entries. */
  setMeetingAttendance: scopedAdmin("chapters")
    .input(
      z.object({
        meetingId: z.number(),
        entries: z.array(
          z.object({
            memberId: z.number(),
            status: z.enum(["present", "absent", "excused"]),
          })
        ),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      await db
        .delete(schema.meetingAttendance)
        .where(eq(schema.meetingAttendance.meetingId, input.meetingId));
      if (input.entries.length) {
        await db.insert(schema.meetingAttendance).values(
          input.entries.map(e => ({
            meetingId: input.meetingId,
            memberId: e.memberId,
            status: e.status,
          }))
        );
      }
      return {
        ok: true,
        count: input.entries.filter(e => e.status === "present").length,
      };
    }),

  /* Set the chapter's operating rhythm up to standard (the recurring cadences). */
  setupChapterCadences: scopedAdmin("chapters")
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const added = await ensureCadenceTemplates(input.id);
      await audit(ctx.user, "chapter.cadences.setup", {
        type: "chapter",
        id: input.id,
        detail: `+${added} cadences`,
      });
      return { ok: true, added };
    }),

  markChapterCadence: scopedAdmin("chapters")
    .input(
      z.object({
        cadenceId: z.number(),
        status: z.enum(CADENCE_STATUSES),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { chapterId } = await recordCadence(
        input.cadenceId,
        input.status,
        input.note,
        null
      );
      await audit(ctx.user, "chapter.cadence.mark", {
        type: "chapter",
        id: chapterId,
        detail: `${input.cadenceId} → ${input.status}`,
      });
      return { ok: true };
    }),

  /* Assign a member of the chapter to a leadership role (directly or from an
     election result). One active holder per role — the previous holder is
     retired. Only members of the chapter are eligible. */
  assignChapterRole: scopedAdmin("chapters")
    .input(
      z.object({
        chapterId: z.number(),
        memberId: z.number(),
        role: z.string().min(2).max(64),
        title: z.string().max(128).optional(),
        responsibilities: z.string().max(2000).optional(),
        electionId: z.number().optional(),
        termStart: z.coerce.date().optional(),
        termEnd: z.coerce.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const m = (
        await db
          .select()
          .from(schema.members)
          .where(eq(schema.members.id, input.memberId))
          .limit(1)
      ).at(0);
      if (!m)
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
      if (m.homeChapterId !== input.chapterId)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A role can only go to a member of this chapter.",
        });
      // Retire the current holder of this role in this chapter.
      await db
        .update(schema.chapterRoles)
        .set({ status: "ended", termEnd: new Date() })
        .where(
          and(
            eq(schema.chapterRoles.chapterId, input.chapterId),
            eq(schema.chapterRoles.role, input.role),
            eq(schema.chapterRoles.status, "active")
          )
        );
      await db.insert(schema.chapterRoles).values({
        chapterId: input.chapterId,
        memberId: input.memberId,
        role: input.role,
        title: input.role === "other" ? (input.title ?? "Officer") : null,
        responsibilities: input.responsibilities,
        electionId: input.electionId,
        termStart: input.termStart ?? new Date(),
        termEnd: input.termEnd,
        status: "active",
        appointedBy: ctx.user.email,
      });
      await audit(ctx.user, "chapter.role.assign", {
        type: "member",
        id: input.memberId,
        detail: `${input.role} @ chapter #${input.chapterId}`,
      });
      return { ok: true };
    }),

  endChapterRole: scopedAdmin("chapters")
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const row = (
        await db
          .select()
          .from(schema.chapterRoles)
          .where(eq(schema.chapterRoles.id, input.id))
          .limit(1)
      ).at(0);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      await db
        .update(schema.chapterRoles)
        .set({ status: "ended", termEnd: new Date() })
        .where(eq(schema.chapterRoles.id, input.id));
      await audit(ctx.user, "chapter.role.end", {
        type: "member",
        id: row.memberId,
        detail: `${row.role} ended`,
      });
      return { ok: true };
    }),

  saveElection: scopedAdmin("chapters")
    .input(
      z.object({
        id: z.number().optional(),
        chapterId: z.number(),
        title: z.string().min(3).max(255),
        seat: z.string().min(2).max(128),
        quorumPct: z.number().min(1).max(100).default(50),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...vals } = input;
      if (id)
        await db
          .update(schema.elections)
          .set(vals)
          .where(eq(schema.elections.id, id));
      else await db.insert(schema.elections).values(vals);
      return { ok: true };
    }),

  setElectionStatus: scopedAdmin("chapters")
    .input(
      z.object({ id: z.number(), status: z.enum(["open", "voting", "closed"]) })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const e = (
        await db
          .select()
          .from(schema.elections)
          .where(eq(schema.elections.id, input.id))
          .limit(1)
      ).at(0);
      if (!e) throw new TRPCError({ code: "NOT_FOUND" });
      if (input.status === "voting") {
        await db
          .update(schema.elections)
          .set({ status: "voting", opensAt: new Date() })
          .where(eq(schema.elections.id, e.id));
        return { ok: true };
      }
      if (input.status === "closed") {
        // tally + quorum + tamper-evident result hash
        const memberCount =
          (
            await db
              .select({ n: sql<number>`count(*)` })
              .from(schema.members)
              .where(eq(schema.members.homeChapterId, e.chapterId))
          ).at(0)?.n ?? 0;
        const turnout =
          (
            await db
              .select({ n: sql<number>`count(*)` })
              .from(schema.ballotRoll)
              .where(eq(schema.ballotRoll.electionId, e.id))
          ).at(0)?.n ?? 0;
        const tally = await db
          .select({
            candidateId: schema.ballots.candidateId,
            n: sql<number>`count(*)`,
          })
          .from(schema.ballots)
          .where(eq(schema.ballots.electionId, e.id))
          .groupBy(schema.ballots.candidateId);
        const quorumMet =
          memberCount > 0 && (turnout / memberCount) * 100 >= e.quorumPct;
        const hash = createHash("sha256")
          .update(
            JSON.stringify({
              electionId: e.id,
              tally,
              turnout,
              quorumMet,
              closedAt: Date.now(),
            })
          )
          .digest("hex");
        await db
          .update(schema.elections)
          .set({ status: "closed", closesAt: new Date(), resultHash: hash })
          .where(eq(schema.elections.id, e.id));
        // Winner = candidate with the most votes (only meaningful when quorum met
        // and there's a single top scorer). Surfaced so the seat can be filled.
        let winner: { memberId: number; name: string; votes: number } | null =
          null;
        const sorted = [...tally].sort((a, b) => Number(b.n) - Number(a.n));
        const top = sorted[0];
        const tied =
          sorted.length > 1 && Number(sorted[1].n) === Number(top?.n ?? 0);
        if (quorumMet && top && Number(top.n) > 0 && !tied) {
          const cand = (
            await db
              .select({
                memberId: schema.candidates.memberId,
                name: schema.users.name,
              })
              .from(schema.candidates)
              .leftJoin(
                schema.members,
                eq(schema.members.id, schema.candidates.memberId)
              )
              .leftJoin(
                schema.users,
                eq(schema.users.id, schema.members.userId)
              )
              .where(eq(schema.candidates.id, top.candidateId))
              .limit(1)
          ).at(0);
          if (cand)
            winner = {
              memberId: cand.memberId,
              name: cand.name ?? "Member",
              votes: Number(top.n),
            };
        }
        // H9 — fill the seat: assign the winner to the chapter's leadership team
        // (retiring the current holder), record the term, and notify them.
        let assigned = false;
        if (winner) {
          const { role, title } = seatToChapterRole(e.seat);
          await db
            .update(schema.chapterRoles)
            .set({ status: "ended", termEnd: new Date() })
            .where(
              and(
                eq(schema.chapterRoles.chapterId, e.chapterId),
                eq(schema.chapterRoles.role, role),
                eq(schema.chapterRoles.status, "active")
              )
            );
          await db.insert(schema.chapterRoles).values({
            chapterId: e.chapterId,
            memberId: winner.memberId,
            role,
            title,
            electionId: e.id,
            termStart: new Date(),
            status: "active",
            appointedBy: `Election #${e.id}`,
          });
          assigned = true;
          try {
            await notify(
              winner.memberId,
              `You've been elected ${e.seat} — congratulations. Your term starts now. 🗳️`,
              "governance"
            );
          } catch {
            /* non-fatal */
          }
          await audit(ctx.user, "election.seat.filled", {
            type: "member",
            id: winner.memberId,
            detail: `${e.seat} (${role}) @ chapter #${e.chapterId} · election #${e.id}`,
          });
        }
        return {
          ok: true,
          turnout,
          memberCount,
          quorumMet,
          resultHash: hash,
          seat: e.seat,
          winner,
          assigned,
        };
      }
      await db
        .update(schema.elections)
        .set({ status: "open" })
        .where(eq(schema.elections.id, e.id));
      return { ok: true };
    }),

  saveMotion: scopedAdmin("chapters")
    .input(
      z.object({
        id: z.number().optional(),
        chapterId: z.number(),
        title: z.string().min(3).max(255),
        body: z.string().max(4000).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...vals } = input;
      if (id)
        await db
          .update(schema.motions)
          .set(vals)
          .where(eq(schema.motions.id, id));
      else await db.insert(schema.motions).values(vals);
      return { ok: true };
    }),

  closeMotion: scopedAdmin("chapters")
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const mo = (
        await db
          .select()
          .from(schema.motions)
          .where(eq(schema.motions.id, input.id))
          .limit(1)
      ).at(0);
      if (!mo || mo.status !== "open")
        throw new TRPCError({
          code: "CONFLICT",
          message: "Motion is not open",
        });
      const votes = await db
        .select({ choice: schema.motionVotes.choice, n: sql<number>`count(*)` })
        .from(schema.motionVotes)
        .where(eq(schema.motionVotes.motionId, mo.id))
        .groupBy(schema.motionVotes.choice);
      const yes = votes.find(v => v.choice === "yes")?.n ?? 0;
      const no = votes.find(v => v.choice === "no")?.n ?? 0;
      const status = yes > no ? "passed" : "rejected";
      await db
        .update(schema.motions)
        .set({ status, closesAt: new Date() })
        .where(eq(schema.motions.id, mo.id));
      return { ok: true, status, yes, no };
    }),

  saveBudget: scopedAdmin("chapters")
    .input(
      z.object({
        id: z.number().optional(),
        chapterId: z.number(),
        label: z.string().min(3).max(255),
        kind: z
          .enum(["allocation", "sponsorship", "spend"])
          .default("allocation"),
        amount: z.number().min(0),
        status: z
          .enum(["proposed", "approved", "spent", "rejected"])
          .default("proposed"),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...vals } = input;
      if (id)
        await db
          .update(schema.chapterBudgets)
          .set(vals)
          .where(eq(schema.chapterBudgets.id, id));
      else await db.insert(schema.chapterBudgets).values(vals);
      return { ok: true };
    }),

  /* ---- ML-01 prospect funnel (membership scope) ---- */
  prospects: scopedAdmin("membership")
    .input(
      z
        .object({
          stage: z
            .enum(["prospect", "guest", "invited", "converted", "declined"])
            .optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      return input?.stage
        ? db
            .select()
            .from(schema.prospects)
            .where(eq(schema.prospects.stage, input.stage))
            .orderBy(desc(schema.prospects.updatedAt))
        : db
            .select()
            .from(schema.prospects)
            .orderBy(desc(schema.prospects.updatedAt));
    }),

  addProspect: scopedAdmin("membership")
    .input(
      z.object({
        name: z.string().min(2).max(255),
        email: z.string().email().max(320).optional().or(z.literal("")),
        phone: z.string().max(40).optional(),
        company: z.string().max(255).optional(),
        chapterId: z.number().optional(),
        source: z.string().max(120).optional(),
        notes: z.string().max(5000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const res = await getDb()
        .insert(schema.prospects)
        .values({
          name: input.name,
          email: input.email || null,
          phone: input.phone ?? null,
          company: input.company ?? null,
          chapterId: input.chapterId ?? null,
          source: input.source ?? null,
          notes: input.notes ?? null,
          ownerUserId: ctx.user.id,
        });
      const prospectId = Number(res[0].insertId);
      // CH-01/CH-03 — auto-create a 48-hour guest follow-up so no warm guest is dropped.
      const { openGuestFollowUp } = await import("./queries/followups");
      await openGuestFollowUp(
        prospectId,
        input.name,
        input.chapterId ?? null,
        ctx.user.id
      );
      await audit(ctx.user, "prospect.add", {
        type: "prospect",
        id: prospectId,
        detail: input.name,
      });
      return { ok: true, id: prospectId };
    }),

  /* ---- CH-01/CH-03 guest follow-up tasks ---- */
  followUps: scopedAdmin("membership")
    .input(
      z.object({ status: z.enum(["open", "all"]).default("open") }).optional()
    )
    .query(async ({ input }) => {
      const { listFollowUps } = await import("./queries/followups");
      return listFollowUps({ status: input?.status ?? "open" });
    }),

  followUpDone: scopedAdmin("membership")
    .input(z.object({ id: z.number(), dismiss: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const { setFollowUpStatus } = await import("./queries/followups");
      await setFollowUpStatus(input.id, input.dismiss ? "dismissed" : "done");
      await audit(
        ctx.user,
        input.dismiss ? "followup.dismiss" : "followup.done",
        { type: "followUp", id: input.id }
      );
      return { ok: true };
    }),

  updateProspect: scopedAdmin("membership")
    .input(
      z.object({
        id: z.number(),
        stage: z
          .enum(["prospect", "guest", "invited", "converted", "declined"])
          .optional(),
        notes: z.string().max(5000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const patch: Partial<typeof schema.prospects.$inferInsert> = {};
      if (input.stage) patch.stage = input.stage;
      if (input.notes !== undefined) patch.notes = input.notes;
      await getDb()
        .update(schema.prospects)
        .set(patch)
        .where(eq(schema.prospects.id, input.id));
      await audit(ctx.user, "prospect.update", {
        type: "prospect",
        id: input.id,
        detail: input.stage,
      });
      return { ok: true };
    }),

  /* ---- Governance hierarchy (Zone → Region → Country) + roll-ups ---- */
  orgTree: scopedAdmin("chapters").query(async () => {
    const db = getDb();
    const units = await db.select().from(schema.orgUnits);
    const chapters = await db
      .select({
        id: schema.chapters.id,
        name: schema.chapters.name,
        zoneId: schema.chapters.zoneId,
        status: schema.chapters.status,
      })
      .from(schema.chapters)
      .where(isNull(schema.chapters.deletedAt));
    const counts = await db
      .select({
        chapterId: schema.members.homeChapterId,
        n: sql<number>`count(*)`,
      })
      .from(schema.members)
      .where(eq(schema.members.status, "active"))
      .groupBy(schema.members.homeChapterId);
    const memberBy = new Map(counts.map(c => [c.chapterId, Number(c.n)]));
    // At-risk members per chapter (rolls up so regional leaders see hotspots).
    const atRiskCounts = await db
      .select({
        chapterId: schema.members.homeChapterId,
        n: sql<number>`count(*)`,
      })
      .from(schema.members)
      .where(
        and(
          eq(schema.members.status, "active"),
          eq(schema.members.lifecycleState, "at_risk")
        )
      )
      .groupBy(schema.members.homeChapterId);
    const atRiskBy = new Map(atRiskCounts.map(c => [c.chapterId, Number(c.n)]));
    // Chapter health: prefer the latest snapshot (CH-06 record); fall back to a
    // live compute only for chapters that have never been snapshotted.
    const snaps = await db
      .select({
        chapterId: schema.healthSnapshots.chapterId,
        total: schema.healthSnapshots.total,
      })
      .from(schema.healthSnapshots)
      .orderBy(desc(schema.healthSnapshots.createdAt));
    const healthBy = new Map<number, number>();
    for (const s of snaps)
      if (!healthBy.has(s.chapterId)) healthBy.set(s.chapterId, s.total);
    for (const c of chapters) {
      if (healthBy.has(c.id)) continue;
      try {
        healthBy.set(c.id, (await computeChapterHealth(c.id)).total);
      } catch {
        /* skip */
      }
    }
    // Leaders at every unit level (councils above the chapter).
    const leaderRows = await db
      .select({
        id: schema.unitRoles.id,
        unitId: schema.unitRoles.unitId,
        role: schema.unitRoles.role,
        name: schema.users.name,
        email: schema.users.email,
      })
      .from(schema.unitRoles)
      .innerJoin(
        schema.members,
        eq(schema.members.id, schema.unitRoles.memberId)
      )
      .innerJoin(schema.users, eq(schema.users.id, schema.members.userId));
    const leadersBy = new Map<
      number,
      { id: number; role: string; name: string }[]
    >();
    for (const l of leaderRows) {
      const a = leadersBy.get(l.unitId) ?? [];
      a.push({ id: l.id, role: l.role, name: l.name ?? l.email ?? "Member" });
      leadersBy.set(l.unitId, a);
    }
    const avg = (xs: number[]): number | null =>
      xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
    const chs = chapters.map(c => ({
      ...c,
      members: memberBy.get(c.id) ?? 0,
      atRisk: atRiskBy.get(c.id) ?? 0,
      health: healthBy.get(c.id) ?? null,
    }));
    const kids = (level: "zone" | "region" | "country", pid: number | null) =>
      units.filter(u => u.level === level && (u.parentId ?? null) === pid);
    const zoneNode = (z: schema.OrgUnit) => {
      const zc = chs.filter(c => c.zoneId === z.id);
      return {
        id: z.id,
        name: z.name,
        code: z.code,
        chapters: zc,
        chapterCount: zc.length,
        leaders: leadersBy.get(z.id) ?? [],
        members: zc.reduce((a, c) => a + c.members, 0),
        atRisk: zc.reduce((a, c) => a + c.atRisk, 0),
        health: avg(
          zc.map(c => c.health).filter((h): h is number => h != null)
        ),
      };
    };
    const regionNode = (r: schema.OrgUnit) => {
      const zones = kids("zone", r.id).map(zoneNode);
      return {
        id: r.id,
        name: r.name,
        code: r.code,
        zones,
        chapterCount: zones.reduce((a, z) => a + z.chapterCount, 0),
        leaders: leadersBy.get(r.id) ?? [],
        members: zones.reduce((a, z) => a + z.members, 0),
        atRisk: zones.reduce((a, z) => a + z.atRisk, 0),
        health: avg(
          zones.map(z => z.health).filter((h): h is number => h != null)
        ),
      };
    };
    const countryNode = (c: schema.OrgUnit) => {
      const regions = kids("region", c.id).map(regionNode);
      return {
        id: c.id,
        name: c.name,
        code: c.code,
        regions,
        chapterCount: regions.reduce((a, r) => a + r.chapterCount, 0),
        leaders: leadersBy.get(c.id) ?? [],
        members: regions.reduce((a, r) => a + r.members, 0),
        atRisk: regions.reduce((a, r) => a + r.atRisk, 0),
        health: avg(
          regions.map(r => r.health).filter((h): h is number => h != null)
        ),
      };
    };
    const countries = kids("country", null).map(countryNode);
    const allHealth = chs
      .map(c => c.health)
      .filter((h): h is number => h != null);
    return {
      countries,
      unassigned: chs.filter(c => !c.zoneId),
      zones: units
        .filter(u => u.level === "zone")
        .map(z => ({ id: z.id, name: z.name })),
      summary: {
        countries: units.filter(u => u.level === "country").length,
        regions: units.filter(u => u.level === "region").length,
        zones: units.filter(u => u.level === "zone").length,
        chapters: chs.length,
        members: chs.reduce((a, c) => a + c.members, 0),
        atRisk: chs.reduce((a, c) => a + c.atRisk, 0),
        avgHealth: avg(allHealth),
        leaders: leaderRows.length,
      },
    };
  }),

  /* Assign a leader to an org unit (Zone/Region/Country council). */
  assignUnitLeader: scopedAdmin("chapters")
    .input(
      z.object({
        unitId: z.number(),
        level: z.enum(["zone", "region", "country"]),
        memberId: z.number(),
        role: z.string().min(2).max(96),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const dupe = await db
        .select({ id: schema.unitRoles.id })
        .from(schema.unitRoles)
        .where(
          and(
            eq(schema.unitRoles.unitId, input.unitId),
            eq(schema.unitRoles.memberId, input.memberId),
            eq(schema.unitRoles.role, input.role)
          )
        )
        .limit(1);
      if (dupe.length)
        throw new TRPCError({
          code: "CONFLICT",
          message: "That member already holds this role here.",
        });
      await db.insert(schema.unitRoles).values({
        unitId: input.unitId,
        level: input.level,
        memberId: input.memberId,
        role: input.role,
      });
      await audit(ctx.user, "org.leader.assign", {
        type: "org_unit",
        id: input.unitId,
        detail: `${input.role} (member #${input.memberId})`,
      });
      return { ok: true };
    }),

  /* Remove a leader from an org unit. */
  removeUnitLeader: scopedAdmin("chapters")
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await getDb()
        .delete(schema.unitRoles)
        .where(eq(schema.unitRoles.id, input.id));
      await audit(ctx.user, "org.leader.remove", {
        type: "unit_role",
        id: input.id,
      });
      return { ok: true };
    }),

  /* ---- Councils as working bodies (ZO/RE/NA governance) ---- */
  councilView: scopedAdmin("chapters")
    .input(z.object({ unitId: z.number() }))
    .query(({ input }) => listCouncil(input.unitId)),

  councilCreateMeeting: scopedAdmin("chapters")
    .input(
      z.object({
        unitId: z.number(),
        title: z.string().min(2).max(255),
        scheduledAt: z.coerce.date().optional(),
        agenda: z.string().max(8000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const id = await createCouncilMeeting(input.unitId, {
        title: input.title,
        scheduledAt: input.scheduledAt,
        agenda: input.agenda,
      });
      await audit(ctx.user, "council.meeting.create", {
        type: "orgUnit",
        id: input.unitId,
        detail: input.title,
      });
      return { ok: true, id };
    }),

  councilUpdateMeeting: scopedAdmin("chapters")
    .input(
      z.object({
        id: z.number(),
        status: z.enum(["scheduled", "held", "cancelled"]).optional(),
        agenda: z.string().max(8000).optional(),
        minutes: z.string().max(20000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await updateCouncilMeeting(input.id, {
        status: input.status,
        agenda: input.agenda,
        minutes: input.minutes,
      });
      await audit(ctx.user, "council.meeting.update", {
        type: "councilMeeting",
        id: input.id,
      });
      return { ok: true };
    }),

  councilLogDecision: scopedAdmin("chapters")
    .input(
      z.object({
        unitId: z.number(),
        meetingId: z.number().optional(),
        title: z.string().min(2).max(255),
        detail: z.string().max(8000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const id = await logDecision(input.unitId, {
        meetingId: input.meetingId,
        title: input.title,
        detail: input.detail,
      });
      await audit(ctx.user, "council.decision.log", {
        type: "orgUnit",
        id: input.unitId,
        detail: input.title,
      });
      return { ok: true, id };
    }),

  councilDecide: scopedAdmin("chapters")
    .input(
      z.object({
        id: z.number(),
        status: z.enum(["proposed", "carried", "failed", "deferred"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await updateDecision(input.id, input.status);
      await audit(ctx.user, "council.decision.decide", {
        type: "councilDecision",
        id: input.id,
        detail: input.status,
      });
      return { ok: true };
    }),

  /* ---- NA-03 Recognition Awards (community scope) ---- */
  awardsCycles: scopedAdmin("community").query(() => listCycles()),

  /* Units selectable for an award level (chapters, or org units by level). */
  awardsUnits: scopedAdmin("community")
    .input(
      z.object({ level: z.enum(["chapter", "zone", "region", "country"]) })
    )
    .query(({ input }) => awardUnits(input.level)),

  awardsCreateCycle: scopedAdmin("community")
    .input(
      z
        .object({
          name: z.string().min(2).max(160),
          level: z
            .enum(AWARD_LEVEL_KEYS as [string, ...string[]])
            .default("network"),
          unitId: z.number().int().positive().optional(),
          opensAt: z.coerce.date().optional(),
          closesAt: z.coerce.date().optional(),
        })
        .refine(v => v.level === "network" || v.unitId != null, {
          message: "Pick a unit for a chapter/zone/region/country award.",
          path: ["unitId"],
        })
    )
    .mutation(async ({ ctx, input }) => {
      const id = await createCycle({
        name: input.name,
        level: input.level as never,
        unitId: input.unitId ?? null,
        opensAt: input.opensAt,
        closesAt: input.closesAt,
      });
      await audit(ctx.user, "awards.cycle.create", {
        type: "awardCycle",
        id,
        detail: `${input.level} · ${input.name}`,
      });
      return { ok: true, id };
    }),

  awardsSetCycleStatus: scopedAdmin("community")
    .input(
      z.object({
        id: z.number(),
        status: z.enum(["draft", "open", "judging", "announced", "closed"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.status === "open") {
        const cycle = (
          await getDb()
            .select({
              opensAt: schema.awardCycles.opensAt,
              closesAt: schema.awardCycles.closesAt,
            })
            .from(schema.awardCycles)
            .where(eq(schema.awardCycles.id, input.id))
            .limit(1)
        ).at(0);
        const now = Date.now();
        if (cycle?.opensAt && now < new Date(cycle.opensAt).getTime())
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This cycle can't open before its nomination start date.",
          });
        if (cycle?.closesAt && now > new Date(cycle.closesAt).getTime())
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This cycle's nomination window has already closed.",
          });
        // Keep the single-open-cycle invariant that openCycle() relies on.
        const otherOpen = (
          await getDb()
            .select({ id: schema.awardCycles.id })
            .from(schema.awardCycles)
            .where(eq(schema.awardCycles.status, "open"))
            .limit(1)
        ).at(0);
        if (otherOpen && otherOpen.id !== input.id)
          throw new TRPCError({
            code: "CONFLICT",
            message: "Another cycle is already open for nominations.",
          });
      }
      await updateCycleStatus(input.id, input.status);
      await audit(ctx.user, "awards.cycle.status", {
        type: "awardCycle",
        id: input.id,
        detail: input.status,
      });
      return { ok: true };
    }),

  awardsNominations: scopedAdmin("community")
    .input(z.object({ cycleId: z.number() }))
    .query(({ input }) => listNominations(input.cycleId)),

  awardsNominate: scopedAdmin("community")
    .input(
      z.object({
        cycleId: z.number(),
        category: z.string().min(2).max(48),
        nomineeMemberId: z.number().optional(),
        nomineeChapterId: z.number().optional(),
        citation: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.nomineeMemberId && !input.nomineeChapterId)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Pick a member or chapter to nominate.",
        });
      const id = await nominate({
        cycleId: input.cycleId,
        category: input.category,
        nomineeMemberId: input.nomineeMemberId,
        nomineeChapterId: input.nomineeChapterId,
        citation: input.citation,
      });
      await audit(ctx.user, "awards.nominate", { type: "awardNomination", id });
      return { ok: true, id };
    }),

  awardsSetNominationStatus: scopedAdmin("community")
    .input(
      z.object({
        id: z.number(),
        status: z.enum(["nominated", "shortlisted", "winner", "declined"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await setNominationStatus(input.id, input.status);
      // Notify the nominee when they're shortlisted or announced as a winner.
      if (input.status === "shortlisted" || input.status === "winner") {
        const { getNominationNominee } = await import("./queries/awards");
        const nom = await getNominationNominee(input.id);
        if (nom?.nomineeMemberId) {
          const label = AWARD_CATEGORY_LABEL[nom.category] ?? "an award";
          const msg =
            input.status === "winner"
              ? `Congratulations — you've won ${label}! 🏆`
              : `You've been shortlisted for ${label}.`;
          try {
            await notify(nom.nomineeMemberId, msg, "recognition");
          } catch {
            /* non-fatal */
          }
        }
      }
      await audit(ctx.user, "awards.nomination.status", {
        type: "awardNomination",
        id: input.id,
        detail: input.status,
      });
      return { ok: true };
    }),

  /* ---- Panel judging (Awards spec Part 1 / Part 7) ---- */
  awardsSetRubric: scopedAdmin("community")
    .input(
      z.object({
        cycleId: z.number(),
        rubric: z
          .array(
            z.object({
              key: z.string().min(1).max(48),
              label: z.string().min(1).max(80),
              weight: z.number().min(0).max(100),
            })
          )
          .min(1)
          .max(10),
      })
    )
    .mutation(({ ctx, input }) =>
      setCycleRubric(ctx.user, input.cycleId, input.rubric)
    ),

  awardsJudges: scopedAdmin("community")
    .input(z.object({ cycleId: z.number() }))
    .query(({ input }) => listJudges(input.cycleId)),

  awardsAssignJudge: scopedAdmin("community")
    .input(z.object({ cycleId: z.number(), userId: z.number() }))
    .mutation(({ ctx, input }) =>
      assignJudge(ctx.user, input.cycleId, input.userId)
    ),

  awardsRemoveJudge: scopedAdmin("community")
    .input(z.object({ cycleId: z.number(), userId: z.number() }))
    .mutation(({ ctx, input }) =>
      removeJudge(ctx.user, input.cycleId, input.userId)
    ),

  awardsJudgingBoard: scopedAdmin("community")
    .input(z.object({ cycleId: z.number() }))
    .query(({ input }) => judgingBoard(input.cycleId)),

  // Score submission is gated to assigned judges inside submitScore(); the
  // community scope simply ensures the caller is a staff user.
  awardsSubmitScore: scopedAdmin("community")
    .input(
      z.object({
        cycleId: z.number(),
        nominationId: z.number(),
        scores: z
          .array(
            z.object({ key: z.string().min(1).max(48), value: z.number() })
          )
          .max(10),
        note: z.string().max(1000).optional(),
      })
    )
    .mutation(({ ctx, input }) => submitScore(ctx.user, input)),

  awardsRatifyWinner: scopedAdmin("community")
    .input(z.object({ cycleId: z.number(), nominationId: z.number() }))
    .mutation(({ ctx, input }) =>
      ratifyWinner(ctx.user, input.cycleId, input.nominationId)
    ),

  // Auto-scored judging (default mechanism): rank eligible members from live KPI
  // data against the auto-score rubric. Read-only computation for review.
  awardsAutoScore: scopedAdmin("community")
    .input(z.object({ cycleId: z.number() }))
    .query(({ input }) => autoScoreCycle(input.cycleId)),

  // Conferral (gate 5): record the top auto-scored member as the winner, with
  // the no-back-to-back fairness cap enforced.
  awardsRecordAutoWinner: scopedAdmin("community")
    .input(z.object({ cycleId: z.number(), memberId: z.number() }))
    .mutation(({ ctx, input }) =>
      recordAutoWinner(ctx.user, input.cycleId, input.memberId)
    ),

  awardsMemberAwards: scopedAdmin("membership")
    .input(z.object({ memberId: z.number() }))
    .query(({ input }) => memberAwards(input.memberId)),

  /* ---- Hall of Fame (lifetime honours — multi-year auto-qualification) ---- */
  awardsHallOfFameBoard: scopedAdmin("community").query(() =>
    hallOfFameBoard()
  ),

  awardsInductHallOfFame: scopedAdmin("community")
    .input(z.object({ memberId: z.number() }))
    .mutation(({ ctx, input }) => inductHallOfFame(ctx.user, input.memberId)),

  awardsHallOfFameInductees: scopedAdmin("community").query(() =>
    hallOfFameInductees()
  ),

  /* ---- integrity layer (anti-gaming, conflict & moderation flags) ---- */
  awardsIntegrityScan: scopedAdmin("community")
    .input(z.object({ cycleId: z.number() }))
    .mutation(({ ctx, input }) => scanCycleIntegrity(ctx.user, input.cycleId)),

  awardsIntegrityFlags: scopedAdmin("community")
    .input(z.object({ cycleId: z.number() }))
    .query(({ input }) => listFlags(input.cycleId)),

  awardsRaiseFlag: scopedAdmin("community")
    .input(
      z.object({
        cycleId: z.number(),
        nominationId: z.number().optional(),
        memberId: z.number().optional(),
        detail: z.string().min(3).max(500),
        severity: z.enum(["info", "warn", "block"]).optional(),
      })
    )
    .mutation(({ ctx, input }) => raiseFlag(ctx.user, input)),

  awardsResolveFlag: scopedAdmin("community")
    .input(
      z.object({
        flagId: z.number(),
        decision: z.enum(["clear", "uphold"]),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      resolveFlag(ctx.user, input.flagId, input.decision, input.note)
    ),

  /* ---- member-vote awards (admin tally + conferral) ---- */
  awardsVoteTally: scopedAdmin("community")
    .input(z.object({ cycleId: z.number() }))
    .query(({ input }) => voteTally(input.cycleId)),

  awardsRecordVoteWinner: scopedAdmin("community")
    .input(z.object({ cycleId: z.number(), nominationId: z.number() }))
    .mutation(({ ctx, input }) =>
      recordVoteWinner(ctx.user, input.cycleId, input.nominationId)
    ),

  createOrgUnit: scopedAdmin("chapters")
    .input(
      z.object({
        level: z.enum(["zone", "region", "country"]),
        name: z.string().min(2).max(255),
        code: z.string().max(24).optional(),
        parentId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const res = await getDb()
        .insert(schema.orgUnits)
        .values({
          level: input.level,
          name: input.name,
          code: input.code ?? null,
          parentId: input.parentId ?? null,
        });
      await audit(ctx.user, "org.create", {
        type: "org_unit",
        id: Number(res[0].insertId),
        detail: `${input.level}: ${input.name}`,
      });
      return { ok: true, id: Number(res[0].insertId) };
    }),

  setChapterZone: scopedAdmin("chapters")
    .input(z.object({ chapterId: z.number(), zoneId: z.number().nullable() }))
    .mutation(async ({ ctx, input }) => {
      await getDb()
        .update(schema.chapters)
        .set({ zoneId: input.zoneId })
        .where(eq(schema.chapters.id, input.chapterId));
      await audit(ctx.user, "org.assignChapter", {
        type: "chapter",
        id: input.chapterId,
        detail: `zone #${input.zoneId ?? "none"}`,
      });
      return { ok: true };
    }),

  /* AF-02 — decide a proposed spend, gated by the approval threshold. A spend
     over SPEND_APPROVAL_THRESHOLD_AED needs a full administrator to approve. */
  decideBudgetLine: scopedAdmin("chapters")
    .input(
      z.object({
        id: z.number(),
        decision: z.enum(["approve", "reject"]),
        note: z.string().max(1000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const line = (
        await db
          .select()
          .from(schema.chapterBudgets)
          .where(eq(schema.chapterBudgets.id, input.id))
          .limit(1)
      ).at(0);
      if (!line)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Budget line not found",
        });
      if (line.status !== "proposed")
        throw new TRPCError({
          code: "CONFLICT",
          message: "This line has already been decided.",
        });
      if (
        input.decision === "approve" &&
        line.kind === "spend" &&
        line.amount > SPEND_APPROVAL_THRESHOLD_AED &&
        !isFullAdmin(ctx.user as never)
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Spends over AED ${SPEND_APPROVAL_THRESHOLD_AED.toLocaleString()} need a full administrator (President / Director) to approve.`,
        });
      }
      await db
        .update(schema.chapterBudgets)
        .set({
          status: input.decision === "approve" ? "approved" : "rejected",
          approvedByUserId: ctx.user.id,
          note: input.note ?? null,
          decidedAt: new Date(),
        })
        .where(eq(schema.chapterBudgets.id, input.id));
      await audit(ctx.user, `budget.${input.decision}`, {
        type: "chapter_budget",
        id: input.id,
        detail: `${line.kind} AED ${line.amount}`,
      });
      return { ok: true };
    }),

  /* ---- insights CMS + newsletter archive (BRD 6.1/6.5) ---- */
  insightsAdmin: scopedAdmin("content").query(async () => {
    return getDb()
      .select()
      .from(schema.insights)
      .orderBy(desc(schema.insights.createdAt))
      .limit(100);
  }),

  saveInsight: scopedAdmin("content")
    .input(
      z.object({
        id: z.number().optional(),
        title: z.string().min(3).max(255),
        slug: z
          .string()
          .min(3)
          .max(255)
          .regex(/^[a-z0-9-]+$/, "lowercase letters, numbers, dashes"),
        excerpt: z.string().max(500).optional(),
        body: z.string().max(50000).optional(),
        tag: z.string().max(64).default("Note"),
        publish: z.boolean().default(false),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, publish, ...vals } = input;
      const clash = await db
        .select()
        .from(schema.insights)
        .where(
          and(
            eq(schema.insights.slug, vals.slug),
            id ? sql`${schema.insights.id} != ${id}` : sql`1=1`
          )
        )
        .limit(1);
      if (clash.length)
        throw new TRPCError({
          code: "CONFLICT",
          message: "Slug already in use",
        });
      if (id) {
        await db
          .update(schema.insights)
          .set({ ...vals, ...(publish ? { publishedAt: new Date() } : {}) })
          .where(eq(schema.insights.id, id));
      } else {
        await db
          .insert(schema.insights)
          .values({ ...vals, publishedAt: publish ? new Date() : null });
      }
      return { ok: true };
    }),

  setInsightPublished: scopedAdmin("content")
    .input(z.object({ id: z.number(), publish: z.boolean() }))
    .mutation(async ({ input }) => {
      await getDb()
        .update(schema.insights)
        .set({ publishedAt: input.publish ? new Date() : null })
        .where(eq(schema.insights.id, input.id));
      return { ok: true };
    }),

  deleteInsight: scopedAdmin("content")
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await getDb()
        .delete(schema.insights)
        .where(eq(schema.insights.id, input.id));
      return { ok: true };
    }),

  newslettersAdmin: scopedAdmin("content").query(async () => {
    return getDb()
      .select()
      .from(schema.newsletters)
      .orderBy(desc(schema.newsletters.publishedAt))
      .limit(100);
  }),

  saveNewsletter: scopedAdmin("content")
    .input(
      z.object({
        id: z.number().optional(),
        title: z.string().min(3).max(255),
        issue: z.string().max(64).optional(),
        url: safeUrl,
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...vals } = input;
      if (id)
        await db
          .update(schema.newsletters)
          .set(vals)
          .where(eq(schema.newsletters.id, id));
      else await db.insert(schema.newsletters).values(vals);
      return { ok: true };
    }),

  deleteNewsletter: scopedAdmin("content")
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await getDb()
        .delete(schema.newsletters)
        .where(eq(schema.newsletters.id, input.id));
      return { ok: true };
    }),

  /* ---- PDPL data-subject requests (BRD 8.4) ---- */
  dataRequestsAdmin: scopedAdmin("finance").query(async () => {
    const db = getDb();
    const rows = await db
      .select({ req: schema.dataRequests, user: schema.users })
      .from(schema.dataRequests)
      .innerJoin(
        schema.members,
        eq(schema.dataRequests.memberId, schema.members.id)
      )
      .innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
      .orderBy(desc(schema.dataRequests.createdAt))
      .limit(100);
    return rows.map(r => ({
      ...r.req,
      memberName: r.user.name ?? r.user.email ?? "Member",
    }));
  }),

  /* Mark a PDPL data-subject request (export/deletion) as fulfilled. */
  resolveDataRequest: scopedAdmin("finance")
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await getDb()
        .update(schema.dataRequests)
        .set({ status: "done" })
        .where(eq(schema.dataRequests.id, input.id));
      await audit(ctx.user, "data_request.resolve", {
        type: "data_request",
        id: input.id,
      });
      return { ok: true };
    }),

  completeDataRequest: scopedAdmin("finance")
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const req = (
        await db
          .select()
          .from(schema.dataRequests)
          .where(eq(schema.dataRequests.id, input.id))
          .limit(1)
      ).at(0);
      if (!req) throw new TRPCError({ code: "NOT_FOUND" });
      await db
        .update(schema.dataRequests)
        .set({ status: "done" })
        .where(eq(schema.dataRequests.id, req.id));
      await notify(
        req.memberId,
        `Your data ${req.kind} request has been completed.`
      );
      await audit(ctx.user, "data.complete", {
        type: "dataRequest",
        id: req.id,
        detail: req.kind,
      });
      return { ok: true };
    }),
});
