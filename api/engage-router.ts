import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, inArray, desc, asc, gte, isNull, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { createRouter, authedQuery } from "./middleware";
import {
  getMemberByUserId,
  awardRulePoints,
  notify,
  engagementCounts,
  quarterStart,
} from "./queries/circle";
import { getVapidPublicKey } from "./lib/push";
import {
  tierRank,
  POINT_RULE_DEFAULTS,
  POINT_RULE_LABEL,
  POINT_RULE_FACTOR,
  ZENITH_CAP,
  PUSH_CATEGORY_KEYS,
  EVENT_CHECKIN_OPENS_BEFORE_MS,
  EVENT_CHECKIN_CLOSES_AFTER_MS,
  BUDDY_CHECKIN_DAYS,
} from "@contracts/constants";

const DAY_MS = 24 * 60 * 60 * 1000;
/** The 30-day buddy check-in can't be completed in the first few weeks — it
 *  opens a short grace window before day 30 so it lands around the real mark. */
const BUDDY_CHECKIN_OPENS_AFTER_DAYS = BUDDY_CHECKIN_DAYS - 5; // day 25

async function requireMember(userId: number) {
  const member = await getMemberByUserId(userId);
  if (!member)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No active membership yet",
    });
  return member;
}

export const engageRouter = createRouter({
  /* ---- NA-03 Recognition Awards — member nominations + winners wall ---- */
  awardsOpen: authedQuery.query(async () => {
    const { openCycle, announcedWinners } = await import("./queries/awards");
    const [cycle, winners] = await Promise.all([
      openCycle(),
      announcedWinners(),
    ]);
    return { cycle, winners };
  }),

  submitNomination: authedQuery
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
      const me = await requireMember(ctx.user.id);
      const { openCycle, alreadyNominated, nominate, nomineeInUnit } =
        await import("./queries/awards");
      const { nominationWindowState, validateNomineeForCategory } =
        await import("@contracts/awards");
      const open = await openCycle();
      if (!open || open.id !== input.cycleId)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Nominations aren't open right now.",
        });
      // Enforce the cycle's nomination window even if an admin left status "open".
      if (nominationWindowState(open.opensAt, open.closesAt) !== "open")
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Nominations for this cycle aren't open right now.",
        });
      // The category must exist and its subject (member vs chapter) must match
      // the nominee type — blocks e.g. nominating a member for Chapter of the Year.
      const subjectCheck = validateNomineeForCategory(input.category, {
        nomineeMemberId: input.nomineeMemberId,
        nomineeChapterId: input.nomineeChapterId,
      });
      if (!subjectCheck.ok)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: subjectCheck.error,
        });
      if (input.nomineeMemberId === me.id)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You can't nominate yourself.",
        });
      // Scoped cycles (chapter/zone/region/country) only accept nominees that
      // belong to the cycle's unit.
      if (
        open.level !== "network" &&
        open.unitId &&
        !(await nomineeInUnit(open.level, open.unitId, {
          nomineeMemberId: input.nomineeMemberId,
          nomineeChapterId: input.nomineeChapterId,
        }))
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That nominee isn't part of this award's chapter or region.",
        });
      if (await alreadyNominated(input.cycleId, input.category, me.id))
        throw new TRPCError({
          code: "CONFLICT",
          message: "You've already nominated in this category.",
        });
      await nominate({
        cycleId: input.cycleId,
        category: input.category,
        nomineeMemberId: input.nomineeMemberId,
        nomineeChapterId: input.nomineeChapterId,
        nominatedByMemberId: me.id,
        citation: input.citation,
      });
      return { ok: true };
    }),

  /* ---- web push notifications (UX-10) ---- */
  pushKey: authedQuery.query(() => getVapidPublicKey()),

  pushSubscribe: authedQuery
    .input(
      z.object({
        endpoint: z.string().url().max(500),
        p256dh: z.string().max(255),
        auth: z.string().max(255),
        categories: z
          .array(z.enum(PUSH_CATEGORY_KEYS as [string, ...string[]]))
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      const cats = JSON.stringify(input.categories ?? PUSH_CATEGORY_KEYS);
      await getDb()
        .insert(schema.pushSubscriptions)
        .values({
          memberId: member.id,
          endpoint: input.endpoint,
          p256dh: input.p256dh,
          auth: input.auth,
          categories: cats,
        })
        .onDuplicateKeyUpdate({
          set: {
            memberId: member.id,
            p256dh: input.p256dh,
            auth: input.auth,
            categories: cats,
          },
        });
      return { ok: true };
    }),

  pushUnsubscribe: authedQuery
    .input(z.object({ endpoint: z.string().max(500) }))
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      await getDb()
        .delete(schema.pushSubscriptions)
        .where(
          and(
            eq(schema.pushSubscriptions.endpoint, input.endpoint),
            eq(schema.pushSubscriptions.memberId, member.id)
          )
        );
      return { ok: true };
    }),

  pushCategories: authedQuery
    .input(z.object({ endpoint: z.string().max(500) }))
    .query(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      const row = (
        await getDb()
          .select()
          .from(schema.pushSubscriptions)
          .where(
            and(
              eq(schema.pushSubscriptions.endpoint, input.endpoint),
              eq(schema.pushSubscriptions.memberId, member.id)
            )
          )
          .limit(1)
      ).at(0);
      if (!row)
        return { subscribed: false, categories: [...PUSH_CATEGORY_KEYS] };
      let cats: string[] = [...PUSH_CATEGORY_KEYS];
      try {
        if (row.categories) cats = JSON.parse(row.categories);
      } catch {
        /* default */
      }
      return { subscribed: true, categories: cats };
    }),

  setPushCategories: authedQuery
    .input(
      z.object({
        endpoint: z.string().max(500),
        categories: z.array(
          z.enum(PUSH_CATEGORY_KEYS as [string, ...string[]])
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      await getDb()
        .update(schema.pushSubscriptions)
        .set({ categories: JSON.stringify(input.categories) })
        .where(
          and(
            eq(schema.pushSubscriptions.endpoint, input.endpoint),
            eq(schema.pushSubscriptions.memberId, member.id)
          )
        );
      return { ok: true };
    }),

  /* ---- notifications (BRD 6.3/7.4) ---- */
  myNotifications: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    const rows = await getDb()
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.memberId, member.id))
      .orderBy(desc(schema.notifications.createdAt))
      .limit(30);
    const unread = rows.filter(r => !r.readAt).length;
    return { rows, unread };
  }),

  markNotificationsRead: authedQuery
    .input(z.object({ id: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      const db = getDb();
      if (input.id) {
        await db
          .update(schema.notifications)
          .set({ readAt: new Date() })
          .where(
            and(
              eq(schema.notifications.id, input.id),
              eq(schema.notifications.memberId, member.id)
            )
          );
      } else {
        await db
          .update(schema.notifications)
          .set({ readAt: new Date() })
          .where(
            and(
              eq(schema.notifications.memberId, member.id),
              sql`${schema.notifications.readAt} is null`
            )
          );
      }
      return { ok: true };
    }),

  /* ---- engagement status (BRD 6.3 Engagement Standard + Dormancy Ladder) ---- */
  myEngagement: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    const db = getDb();
    const cfg =
      (
        await db
          .select()
          .from(schema.engagementConfig)
          .where(eq(schema.engagementConfig.tier, member.tier))
          .limit(1)
      ).at(0) ?? null;
    const counts = await engagementCounts(member.id);
    const log = await db
      .select()
      .from(schema.dormancyLog)
      .where(eq(schema.dormancyLog.memberId, member.id))
      .orderBy(desc(schema.dormancyLog.createdAt))
      .limit(10);
    const rules = await db.select().from(schema.pointRules);
    const ruleRows = (
      Object.keys(POINT_RULE_DEFAULTS) as (keyof typeof POINT_RULE_DEFAULTS)[]
    ).map(k => ({
      key: k,
      label: POINT_RULE_LABEL[k],
      factor: POINT_RULE_FACTOR[k],
      points: rules.find(r => r.key === k)?.points ?? POINT_RULE_DEFAULTS[k],
    }));
    return {
      member,
      config: cfg,
      counts,
      log,
      rules: ruleRows,
      quarterStart: quarterStart(),
    };
  }),

  /* ---- directory visibility + PDPL (BRD 8.4) ---- */
  setDirectoryVisible: authedQuery
    .input(z.object({ visible: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      await getDb()
        .update(schema.members)
        .set({ directoryVisible: input.visible ? 1 : 0 })
        .where(eq(schema.members.id, member.id));
      return { ok: true };
    }),

  /* ---- email-notification preference ---- */
  setEmailNotify: authedQuery
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      await getDb()
        .update(schema.members)
        .set({ emailNotify: input.enabled ? 1 : 0 })
        .where(eq(schema.members.id, member.id));
      return { ok: true };
    }),

  requestData: authedQuery
    .input(z.object({ kind: z.enum(["export", "deletion"]) }))
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      const db = getDb();
      // One open request per KIND — export and deletion are distinct PDPL
      // rights a member may legitimately exercise at the same time.
      const open = await db
        .select()
        .from(schema.dataRequests)
        .where(
          and(
            eq(schema.dataRequests.memberId, member.id),
            eq(schema.dataRequests.kind, input.kind),
            eq(schema.dataRequests.status, "open")
          )
        )
        .limit(1);
      if (open.length)
        throw new TRPCError({
          code: "CONFLICT",
          message: `You already have an open ${input.kind} request.`,
        });
      await db
        .insert(schema.dataRequests)
        .values({ memberId: member.id, kind: input.kind });
      return { ok: true };
    }),

  myDataRequests: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    return getDb()
      .select()
      .from(schema.dataRequests)
      .where(eq(schema.dataRequests.memberId, member.id))
      .orderBy(desc(schema.dataRequests.createdAt))
      .limit(10);
  }),

  /* ---- Connect: 1-2-1s with counterpart confirmation (BRD 6.3) ---- */
  myOneToOnes: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.oneToOnes)
      .where(
        sql`${schema.oneToOnes.aMemberId} = ${member.id} or ${schema.oneToOnes.bMemberId} = ${member.id}`
      )
      .orderBy(desc(schema.oneToOnes.createdAt))
      .limit(40);
    // hydrate counterpart names
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
      aName: nameOf.get(r.aMemberId) ?? "Member",
      bName: nameOf.get(r.bMemberId) ?? "Member",
      mine: r.aMemberId === member.id,
    }));
  }),

  logOneToOne: authedQuery
    .input(
      z.object({
        counterpartId: z.number(),
        kind: z.enum(["one_to_one", "mentoring"]).default("one_to_one"),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      const db = getDb();
      if (input.counterpartId === member.id)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Pick another member",
        });
      const cp = (
        await db
          .select()
          .from(schema.members)
          .where(eq(schema.members.id, input.counterpartId))
          .limit(1)
      ).at(0);
      if (!cp)
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
      await db.insert(schema.oneToOnes).values({
        aMemberId: member.id,
        bMemberId: cp.id,
        kind: input.kind,
        note: input.note,
      });
      await notify(
        cp.id,
        input.kind === "mentoring"
          ? "A mentoring session with you was logged — please confirm."
          : "A 1-2-1 with you was logged — please confirm.",
        "connect"
      );
      return { ok: true };
    }),

  respondOneToOne: authedQuery
    .input(z.object({ id: z.number(), accept: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      const db = getDb();
      const row = (
        await db
          .select()
          .from(schema.oneToOnes)
          .where(eq(schema.oneToOnes.id, input.id))
          .limit(1)
      ).at(0);
      if (!row || row.bMemberId !== member.id)
        throw new TRPCError({ code: "FORBIDDEN" });
      if (row.status !== "pending")
        throw new TRPCError({ code: "CONFLICT", message: "Already responded" });
      const meName =
        (
          await db
            .select({ name: schema.users.name })
            .from(schema.users)
            .where(eq(schema.users.id, ctx.user.id))
            .limit(1)
        ).at(0)?.name ?? "A member";
      if (!input.accept) {
        await db
          .update(schema.oneToOnes)
          .set({ status: "declined" })
          .where(eq(schema.oneToOnes.id, row.id));
        // Tell the requester the outcome (in-app + email).
        await notify(
          row.aMemberId,
          `${meName} couldn't take up your 1-2-1 this time. No worries — pick another member from the directory.`,
          "connect"
        );
        return { ok: true };
      }
      await db
        .update(schema.oneToOnes)
        .set({ status: "confirmed", confirmedAt: new Date() })
        .where(eq(schema.oneToOnes.id, row.id));
      await notify(
        row.aMemberId,
        `${meName} confirmed your 1-2-1. Check the portal for the details.`,
        "connect"
      );
      let score = member.hiveScore;
      if (row.kind === "mentoring") {
        // Give-Back: the mentor (counterpart confirming) earns the mentoring points
        score = await awardRulePoints(
          member.id,
          "mentoring",
          "Mentoring session confirmed"
        );
      } else {
        await awardRulePoints(row.aMemberId, "one_to_one", "1-2-1 confirmed");
        score = await awardRulePoints(
          row.bMemberId,
          "one_to_one",
          "1-2-1 confirmed"
        );
      }
      return { ok: true, score };
    }),

  /* directory of members for picking a 1-2-1 counterpart (respects visibility) */
  /* M10 — recognition leaderboard: top members by Hive Score, scoped to the
     member's chapter when they have one (else across the Circle). */
  leaderboard: authedQuery.query(async ({ ctx }) => {
    const member = await getMemberByUserId(ctx.user.id);
    if (!member) return null;
    const scope = member.homeChapterId;
    const rows = await getDb()
      .select({
        id: schema.members.id,
        name: schema.users.name,
        email: schema.users.email,
        score: schema.members.hiveScore,
      })
      .from(schema.members)
      .innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
      .where(
        and(
          eq(schema.members.status, "active"),
          scope ? eq(schema.members.homeChapterId, scope) : sql`1 = 1`
        )
      )
      .orderBy(desc(schema.members.hiveScore))
      .limit(10);
    return {
      scoped: !!scope,
      meId: member.id,
      rows: rows.map((r, i) => ({
        rank: i + 1,
        id: r.id,
        name: r.name?.trim() || r.email?.split("@")[0] || "Member",
        score: r.score,
      })),
    };
  }),

  memberDirectory: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    const rows = await getDb()
      .select({ member: schema.members, user: schema.users })
      .from(schema.members)
      .innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
      .where(
        and(
          eq(schema.members.directoryVisible, 1),
          sql`${schema.members.id} != ${member.id}`
        )
      )
      .orderBy(asc(schema.users.name))
      .limit(200);
    return rows.map(r => ({
      id: r.member.id,
      name: r.user.name ?? r.user.email ?? "Member",
      company: r.member.company,
      tier: r.member.tier,
    }));
  }),

  /* ---- buddy pairing (BRD 6.3) ---- */
  myBuddy: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    const db = getDb();
    const asNew = await db
      .select()
      .from(schema.buddies)
      .where(eq(schema.buddies.newMemberId, member.id))
      .orderBy(desc(schema.buddies.pairedAt))
      .limit(1);
    const asBuddy = await db
      .select()
      .from(schema.buddies)
      .where(eq(schema.buddies.buddyMemberId, member.id))
      .orderBy(desc(schema.buddies.pairedAt))
      .limit(5);
    const ids = [
      ...new Set([
        ...asNew.map(b => b.buddyMemberId),
        ...asBuddy.map(b => b.newMemberId),
      ]),
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
    return {
      pairedWith: asNew.at(0)
        ? {
            ...asNew.at(0)!,
            name: nameOf.get(asNew.at(0)!.buddyMemberId) ?? "Member",
          }
        : null,
      buddyFor: asBuddy.map(b => ({
        ...b,
        name: nameOf.get(b.newMemberId) ?? "Member",
      })),
    };
  }),

  buddyCheckin: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      const db = getDb();
      const row = (
        await db
          .select()
          .from(schema.buddies)
          .where(eq(schema.buddies.id, input.id))
          .limit(1)
      ).at(0);
      if (!row || row.buddyMemberId !== member.id)
        throw new TRPCError({ code: "FORBIDDEN" });
      if (row.checkinAt) return { ok: true };
      // Temporal integrity: it's a *30-day* check-in — it can't be completed in
      // the first few weeks after pairing.
      const opensAt =
        new Date(row.pairedAt).getTime() +
        BUDDY_CHECKIN_OPENS_AFTER_DAYS * DAY_MS;
      if (Date.now() < opensAt) {
        const days = Math.ceil((opensAt - Date.now()) / DAY_MS);
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `The 30-day check-in opens closer to the mark — about ${days} day${days === 1 ? "" : "s"} from now.`,
        });
      }
      await db
        .update(schema.buddies)
        .set({ checkinAt: new Date() })
        .where(eq(schema.buddies.id, row.id));
      await awardRulePoints(member.id, "one_to_one", "Buddy 30-day check-in");
      await notify(
        row.newMemberId,
        "Your buddy completed your 30-day check-in.",
        "connect"
      );
      return { ok: true };
    }),

  /* ---- referrals + deal flow give-to-get (BRD 6.3) ---- */
  myReferrals: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    return getDb()
      .select()
      .from(schema.referrals)
      .where(eq(schema.referrals.memberId, member.id))
      .orderBy(desc(schema.referrals.createdAt))
      .limit(30);
  }),

  submitReferral: authedQuery
    .input(
      z.object({
        prospectName: z.string().min(2).max(255),
        prospectContact: z.string().max(255).optional(),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      await getDb()
        .insert(schema.referrals)
        .values({ memberId: member.id, ...input });
      const score = await awardRulePoints(
        member.id,
        "referral_submitted",
        "Referral: " + input.prospectName
      );
      return { ok: true, score };
    }),

  deals: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.deals)
      .orderBy(desc(schema.deals.createdAt))
      .limit(50);
    const visible = rows.filter(
      d => tierRank(member.tier) >= tierRank(d.tierGate)
    );
    // give-to-get state: 1 referral this quarter unlocks posting for Ascent
    const since = quarterStart();
    const refs = await db
      .select({ n: sql<number>`count(*)` })
      .from(schema.referrals)
      .where(
        and(
          eq(schema.referrals.memberId, member.id),
          gte(schema.referrals.createdAt, since)
        )
      );
    const referralsThisQuarter = refs.at(0)?.n ?? 0;
    const canPost =
      tierRank(member.tier) >= tierRank("vanguard") ||
      referralsThisQuarter >= 1;
    return {
      deals: visible,
      canPost,
      referralsThisQuarter,
      gated: visible.length < rows.length,
    };
  }),

  postDeal: authedQuery
    .input(
      z.object({
        title: z.string().min(4).max(255),
        description: z.string().max(4000).optional(),
        tierGate: z
          .enum(["horizon", "ascent", "vanguard", "zenith"])
          .default("ascent"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      const db = getDb();
      if (tierRank(member.tier) < tierRank("ascent"))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Deal Flow is available from Ascent and above",
        });
      if (tierRank(member.tier) < tierRank("vanguard")) {
        const refs = await db
          .select({ n: sql<number>`count(*)` })
          .from(schema.referrals)
          .where(
            and(
              eq(schema.referrals.memberId, member.id),
              gte(schema.referrals.createdAt, quarterStart())
            )
          );
        if ((refs.at(0)?.n ?? 0) < 1)
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Give-to-get: submit at least 1 referral this quarter to post a deal",
          });
      }
      await db.insert(schema.deals).values({ ...input, postedBy: member.id });
      return { ok: true };
    }),

  /* ---- events v2: QR check-in + feedback (BRD 6.4) ---- */
  checkinEvent: authedQuery
    .input(z.object({ eventId: z.number(), code: z.string().min(4).max(12) }))
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      const db = getDb();
      const reg = (
        await db
          .select()
          .from(schema.eventRegs)
          .where(
            and(
              eq(schema.eventRegs.eventId, input.eventId),
              eq(schema.eventRegs.memberId, member.id)
            )
          )
          .limit(1)
      ).at(0);
      if (!reg || reg.status === "cancelled")
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No registration found",
        });
      if (reg.status === "waitlisted")
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "You're on the waitlist",
        });
      if (reg.status === "attended")
        return { ok: true, score: member.hiveScore, already: true };
      // Temporal integrity: you can only check in around the event itself — never
      // before it happens (BRD 6.4: check-in writes score in real time at the door).
      const ev = (
        await db
          .select()
          .from(schema.events)
          .where(
            and(
              eq(schema.events.id, input.eventId),
              isNull(schema.events.deletedAt)
            )
          )
          .limit(1)
      ).at(0);
      if (!ev)
        throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
      const start = new Date(ev.startsAt).getTime();
      const now = Date.now();
      if (now < start - EVENT_CHECKIN_OPENS_BEFORE_MS)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Check-in opens closer to the event — you can't check in before it starts.",
        });
      if (now > start + EVENT_CHECKIN_CLOSES_AFTER_MS)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Check-in for this event has closed.",
        });
      if (
        (reg.checkinCode ?? "").toUpperCase() !==
        input.code.trim().toUpperCase()
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Check-in code doesn't match",
        });
      await db
        .update(schema.eventRegs)
        .set({ status: "attended" })
        .where(eq(schema.eventRegs.id, reg.id));
      const score = await awardRulePoints(
        member.id,
        "event_attend",
        "Event check-in"
      );
      return { ok: true, score };
    }),

  submitEventFeedback: authedQuery
    .input(
      z.object({
        eventId: z.number(),
        rating: z.number().min(1).max(5),
        comment: z.string().max(1000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      const db = getDb();
      const reg = (
        await db
          .select()
          .from(schema.eventRegs)
          .where(
            and(
              eq(schema.eventRegs.eventId, input.eventId),
              eq(schema.eventRegs.memberId, member.id),
              eq(schema.eventRegs.status, "attended")
            )
          )
          .limit(1)
      ).at(0);
      if (!reg)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Feedback opens after you attend",
        });
      const dup = await db
        .select()
        .from(schema.eventFeedback)
        .where(
          and(
            eq(schema.eventFeedback.eventId, input.eventId),
            eq(schema.eventFeedback.memberId, member.id)
          )
        )
        .limit(1);
      if (dup.length)
        throw new TRPCError({
          code: "CONFLICT",
          message: "Feedback already submitted",
        });
      await db.insert(schema.eventFeedback).values({
        eventId: input.eventId,
        memberId: member.id,
        rating: input.rating,
        comment: input.comment,
      });
      return { ok: true };
    }),

  myPastEvents: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    const db = getDb();
    const rows = await db
      .select({ event: schema.events, reg: schema.eventRegs })
      .from(schema.eventRegs)
      .innerJoin(schema.events, eq(schema.eventRegs.eventId, schema.events.id))
      .where(
        and(
          eq(schema.eventRegs.memberId, member.id),
          sql`${schema.eventRegs.status} in ('attended','registered')`,
          sql`${schema.events.startsAt} < now()`
        )
      )
      .orderBy(desc(schema.events.startsAt))
      .limit(12);
    const fb = await db
      .select()
      .from(schema.eventFeedback)
      .where(eq(schema.eventFeedback.memberId, member.id));
    const fbSet = new Set(fb.map(f => f.eventId));
    return rows.map(r => ({ ...r, feedbackGiven: fbSet.has(r.event.id) }));
  }),

  /* ---- Zenith admissions (BRD 6.6) ---- */
  nominateZenith: authedQuery
    .input(
      z.object({
        name: z.string().min(2),
        email: z.string().email(),
        company: z.string().optional(),
        proofPoint: z.string().max(4000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      if (tierRank(member.tier) < tierRank("zenith"))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Zenith nominations are made by Zenith members",
        });
      await getDb()
        .insert(schema.zenithApps)
        .values({ userId: ctx.user.id, ...input, status: "endorsing" });
      return { ok: true };
    }),

  zenithPipeline: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    const db = getDb();
    if (tierRank(member.tier) < tierRank("vanguard"))
      return { apps: [], zenithCount: 0 };
    const apps = await db
      .select()
      .from(schema.zenithApps)
      .where(
        sql`${schema.zenithApps.status} in ('nominated','endorsing','review')`
      )
      .orderBy(desc(schema.zenithApps.createdAt))
      .limit(30);
    const out: Array<
      (typeof apps)[number] & {
        endorsements: number;
        weight: number;
        mine: boolean;
      }
    > = [];
    for (const a of apps) {
      const end = await db
        .select()
        .from(schema.endorsements)
        .where(eq(schema.endorsements.appId, a.id));
      const mine = end.some(e => e.memberId === member.id);
      const weight = end.reduce((w, e) => w + (e.role === "board" ? 2 : 1), 0); // 2 QC or 1 board
      out.push({ ...a, endorsements: end.length, weight, mine });
    }
    const zen = await db
      .select({ n: sql<number>`count(*)` })
      .from(schema.members)
      .where(eq(schema.members.tier, "zenith"));
    return { apps: out, zenithCount: zen.at(0)?.n ?? 0, cap: ZENITH_CAP };
  }),

  endorseZenith: authedQuery
    .input(
      z.object({
        appId: z.number(),
        role: z.enum(["qc", "board"]).default("qc"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      if (tierRank(member.tier) < tierRank("vanguard"))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only Vanguard and Zenith members can endorse",
        });
      const db = getDb();
      const app = (
        await db
          .select()
          .from(schema.zenithApps)
          .where(eq(schema.zenithApps.id, input.appId))
          .limit(1)
      ).at(0);
      if (!app || !["nominated", "endorsing"].includes(app.status))
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Not open for endorsement",
        });
      const dup = await db
        .select()
        .from(schema.endorsements)
        .where(
          and(
            eq(schema.endorsements.appId, app.id),
            eq(schema.endorsements.memberId, member.id)
          )
        )
        .limit(1);
      if (dup.length)
        throw new TRPCError({ code: "CONFLICT", message: "Already endorsed" });
      await db
        .insert(schema.endorsements)
        .values({ appId: app.id, memberId: member.id, role: input.role });
      // Atomically promote to review when the weighted threshold is met
      // (2 QC or 1 board). The CASE expression is evaluated on the server so
      // concurrent endorsements can't miss the threshold.
      await db
        .update(schema.zenithApps)
        .set({
          status: sql`case
            when ${schema.zenithApps.status} in ('nominated','endorsing')
              and (select sum(case when ${schema.endorsements.role} = 'board' then 2 else 1 end)
                   from ${schema.endorsements}
                   where ${schema.endorsements.appId} = ${app.id}) >= 2
            then 'review'
            else ${schema.zenithApps.status}
          end`,
        })
        .where(eq(schema.zenithApps.id, app.id));
      return { ok: true };
    }),

  /* ---- chapters: elections + motions (BRD 6.7) ---- */
  myChapter: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    const db = getDb();
    if (!member.homeChapterId) return { chapter: null };
    const chapter =
      (
        await db
          .select()
          .from(schema.chapters)
          .where(
            and(
              eq(schema.chapters.id, member.homeChapterId),
              isNull(schema.chapters.deletedAt)
            )
          )
          .limit(1)
      ).at(0) ?? null;
    if (!chapter) return { chapter: null };
    const memberCount =
      (
        await db
          .select({ n: sql<number>`count(*)` })
          .from(schema.members)
          .where(eq(schema.members.homeChapterId, chapter.id))
      ).at(0)?.n ?? 0;
    const els = await db
      .select()
      .from(schema.elections)
      .where(eq(schema.elections.chapterId, chapter.id))
      .orderBy(desc(schema.elections.createdAt))
      .limit(10);

    // Batch all election-related subqueries instead of one per election.
    const electionIds = els.map(e => e.id);
    const closedElectionIds = els
      .filter(e => e.status === "closed")
      .map(e => e.id);
    const [allCands, allRoll, allBallots] = await Promise.all([
      electionIds.length
        ? db
            .select({ candidate: schema.candidates, user: schema.users })
            .from(schema.candidates)
            .innerJoin(
              schema.members,
              eq(schema.candidates.memberId, schema.members.id)
            )
            .innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
            .where(inArray(schema.candidates.electionId, electionIds))
        : Promise.resolve(
            [] as {
              candidate: typeof schema.candidates.$inferSelect;
              user: typeof schema.users.$inferSelect;
            }[]
          ),
      electionIds.length
        ? db
            .select({
              electionId: schema.ballotRoll.electionId,
              memberId: schema.ballotRoll.memberId,
            })
            .from(schema.ballotRoll)
            .where(inArray(schema.ballotRoll.electionId, electionIds))
        : Promise.resolve([] as { electionId: number; memberId: number }[]),
      closedElectionIds.length
        ? db
            .select({
              electionId: schema.ballots.electionId,
              candidateId: schema.ballots.candidateId,
              n: sql<number>`count(*)`,
            })
            .from(schema.ballots)
            .where(inArray(schema.ballots.electionId, closedElectionIds))
            .groupBy(schema.ballots.electionId, schema.ballots.candidateId)
        : Promise.resolve(
            [] as { electionId: number; candidateId: number; n: number }[]
          ),
    ]);

    const candsByElection = new Map<
      number,
      {
        candidate: typeof schema.candidates.$inferSelect;
        user: typeof schema.users.$inferSelect;
      }[]
    >();
    for (const c of allCands) {
      const arr = candsByElection.get(c.candidate.electionId) ?? [];
      arr.push(c);
      candsByElection.set(c.candidate.electionId, arr);
    }
    const votedSet = new Set(
      allRoll.filter(r => r.memberId === member.id).map(r => r.electionId)
    );
    const turnoutByElection = new Map<number, number>();
    for (const r of allRoll) {
      turnoutByElection.set(
        r.electionId,
        (turnoutByElection.get(r.electionId) ?? 0) + 1
      );
    }
    const resultsByElection = new Map<
      number,
      { candidateId: number; n: number }[]
    >();
    for (const b of allBallots) {
      const arr = resultsByElection.get(b.electionId) ?? [];
      arr.push({ candidateId: b.candidateId, n: b.n });
      resultsByElection.set(b.electionId, arr);
    }

    const electionOut = els.map(e => {
      const cands = candsByElection.get(e.id) ?? [];
      return {
        ...e,
        voted: votedSet.has(e.id),
        turnout: turnoutByElection.get(e.id) ?? 0,
        results: resultsByElection.get(e.id) ?? null,
        candidates: cands.map(c => ({
          id: c.candidate.id,
          memberId: c.candidate.memberId,
          name: c.user.name ?? c.user.email ?? "Member",
          statement: c.candidate.statement,
          mine: c.candidate.memberId === member.id,
        })),
      };
    });

    const mos = await db
      .select()
      .from(schema.motions)
      .where(eq(schema.motions.chapterId, chapter.id))
      .orderBy(desc(schema.motions.createdAt))
      .limit(10);

    // Batch motion votes similarly.
    const motionIds = mos.map(m => m.id);
    const [allMotionVotes, myMotionVotes] = await Promise.all([
      motionIds.length
        ? db
            .select({
              motionId: schema.motionVotes.motionId,
              choice: schema.motionVotes.choice,
              n: sql<number>`count(*)`,
            })
            .from(schema.motionVotes)
            .where(inArray(schema.motionVotes.motionId, motionIds))
            .groupBy(schema.motionVotes.motionId, schema.motionVotes.choice)
        : Promise.resolve(
            [] as { motionId: number; choice: string; n: number }[]
          ),
      motionIds.length
        ? db
            .select({
              motionId: schema.motionVotes.motionId,
              choice: schema.motionVotes.choice,
            })
            .from(schema.motionVotes)
            .where(
              and(
                inArray(schema.motionVotes.motionId, motionIds),
                eq(schema.motionVotes.memberId, member.id)
              )
            )
        : Promise.resolve([] as { motionId: number; choice: string }[]),
    ]);

    const votesByMotion = new Map<number, { choice: string; n: number }[]>();
    for (const v of allMotionVotes) {
      const arr = votesByMotion.get(v.motionId) ?? [];
      arr.push({ choice: v.choice, n: v.n });
      votesByMotion.set(v.motionId, arr);
    }
    const myChoiceByMotion = new Map<number, string>();
    for (const v of myMotionVotes) {
      myChoiceByMotion.set(v.motionId, v.choice);
    }

    const motionOut = mos.map(mo => ({
      ...mo,
      votes: votesByMotion.get(mo.id) ?? [],
      myChoice: myChoiceByMotion.get(mo.id) ?? null,
    }));

    const budgets = await db
      .select()
      .from(schema.chapterBudgets)
      .where(
        and(
          eq(schema.chapterBudgets.chapterId, chapter.id),
          sql`${schema.chapterBudgets.status} != 'rejected'`
        )
      )
      .orderBy(desc(schema.chapterBudgets.createdAt))
      .limit(20);
    // Leadership board — who holds each office, shown to every member.
    const roleRows = await db
      .select({ role: schema.chapterRoles, name: schema.users.name })
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
    const board = roleRows.map(r => ({
      ...r.role,
      memberName: r.name ?? "Member",
    }));
    const myRoles = board
      .filter(b => b.memberId === member.id)
      .map(b => b.role);
    // Chapter learnings — resources officers share with the whole chapter.
    const posts = await db
      .select({ post: schema.chapterPosts, name: schema.users.name })
      .from(schema.chapterPosts)
      .leftJoin(
        schema.members,
        eq(schema.members.id, schema.chapterPosts.authorMemberId)
      )
      .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
      .where(eq(schema.chapterPosts.chapterId, chapter.id))
      .orderBy(desc(schema.chapterPosts.createdAt))
      .limit(30);
    const learnings = posts.map(p => ({
      ...p.post,
      authorName: p.name ?? "Officer",
    }));
    return {
      chapter,
      memberCount,
      elections: electionOut,
      motions: motionOut,
      budgets,
      board,
      myRoles,
      learnings,
    };
  }),

  standForElection: authedQuery
    .input(
      z.object({
        electionId: z.number(),
        statement: z.string().max(1000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      const db = getDb();
      const e = (
        await db
          .select()
          .from(schema.elections)
          .where(eq(schema.elections.id, input.electionId))
          .limit(1)
      ).at(0);
      if (!e || e.status !== "open")
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Nominations are closed",
        });
      if (member.homeChapterId !== e.chapterId)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Not your home chapter",
        });
      if (
        member.status !== "active" ||
        (member.dormancyStage ?? "active") !== "active"
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only Active members can stand for election",
        });
      const dup = await db
        .select()
        .from(schema.candidates)
        .where(
          and(
            eq(schema.candidates.electionId, e.id),
            eq(schema.candidates.memberId, member.id)
          )
        )
        .limit(1);
      if (dup.length)
        throw new TRPCError({ code: "CONFLICT", message: "Already nominated" });
      await db.insert(schema.candidates).values({
        electionId: e.id,
        memberId: member.id,
        statement: input.statement,
      });
      return { ok: true };
    }),

  castVote: authedQuery
    .input(z.object({ electionId: z.number(), candidateId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      const db = getDb();
      const e = (
        await db
          .select()
          .from(schema.elections)
          .where(eq(schema.elections.id, input.electionId))
          .limit(1)
      ).at(0);
      if (!e || e.status !== "voting")
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Voting is not open",
        });
      if (e.opensAt && Date.now() < new Date(e.opensAt).getTime())
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Voting hasn't opened yet.",
        });
      if (e.closesAt && Date.now() > new Date(e.closesAt).getTime())
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Voting has closed.",
        });
      if (member.homeChapterId !== e.chapterId)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Not your home chapter",
        });
      const cand = (
        await db
          .select()
          .from(schema.candidates)
          .where(
            and(
              eq(schema.candidates.id, input.candidateId),
              eq(schema.candidates.electionId, e.id)
            )
          )
          .limit(1)
      ).at(0);
      if (!cand)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Candidate not found",
        });
      const voted = await db
        .select()
        .from(schema.ballotRoll)
        .where(
          and(
            eq(schema.ballotRoll.electionId, e.id),
            eq(schema.ballotRoll.memberId, member.id)
          )
        )
        .limit(1);
      if (voted.length)
        throw new TRPCError({
          code: "CONFLICT",
          message: "Ballot already cast",
        });
      // secret ballot: choice without identity; participation recorded separately
      await db
        .insert(schema.ballots)
        .values({ electionId: e.id, candidateId: cand.id });
      await db
        .insert(schema.ballotRoll)
        .values({ electionId: e.id, memberId: member.id });
      return { ok: true };
    }),

  voteMotion: authedQuery
    .input(
      z.object({
        motionId: z.number(),
        choice: z.enum(["yes", "no", "abstain"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      const db = getDb();
      const mo = (
        await db
          .select()
          .from(schema.motions)
          .where(eq(schema.motions.id, input.motionId))
          .limit(1)
      ).at(0);
      if (!mo || mo.status !== "open")
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Motion is closed",
        });
      if (mo.closesAt && Date.now() > new Date(mo.closesAt).getTime())
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Voting on this motion has closed.",
        });
      if (member.homeChapterId !== mo.chapterId)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Not your home chapter",
        });
      const dup = await db
        .select()
        .from(schema.motionVotes)
        .where(
          and(
            eq(schema.motionVotes.motionId, mo.id),
            eq(schema.motionVotes.memberId, member.id)
          )
        )
        .limit(1);
      if (dup.length)
        throw new TRPCError({
          code: "CONFLICT",
          message: "One member, one vote",
        });
      await db
        .insert(schema.motionVotes)
        .values({ motionId: mo.id, memberId: member.id, choice: input.choice });
      return { ok: true };
    }),
});
