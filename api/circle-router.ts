import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, desc, asc, gte, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { createRouter, authedQuery } from "./middleware";
import { getMemberByUserId, awardPoints, nextSessionForMember, newCheckinCode, promoteWaitlist } from "./queries/circle";
import { paymentsEnabled, getPaymentProvider } from "./lib/payments";
import { tierRank, TIER_PRICE_AED, SELF_SERVE_TIERS, memberCanAccessEvent, eventEligibleTiers } from "@contracts/constants";

async function requireMember(userId: number) {
  const member = await getMemberByUserId(userId);
  if (!member) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No active membership yet" });
  return member;
}

export const circleRouter = createRouter({
  /* ---- self-serve paid join (SRS POR-MEM-03 / INT-01) ---- */
  paymentsEnabled: authedQuery.query(() => ({ enabled: paymentsEnabled() })),

  startCheckout: authedQuery
    .input(z.object({ tier: z.enum(SELF_SERVE_TIERS) }))
    .mutation(async ({ ctx, input }) => {
      if (!paymentsEnabled())
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Online payment isn't enabled yet — please apply instead." });
      const existing = await getMemberByUserId(ctx.user.id);
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "You're already a member." });

      const amount = TIER_PRICE_AED[input.tier] * 100; // AED → fils
      const origin = ctx.req.headers.get("origin") ?? new URL(ctx.req.url).origin;
      const provider = getPaymentProvider();
      const { url, providerRef } = await provider.createCheckoutSession({
        tier: input.tier,
        userId: ctx.user.id,
        email: ctx.user.email ?? "",
        amount,
        currency: "aed",
        successUrl: `${origin}/portal?paid=1`,
        cancelUrl: `${origin}/portal/apply?canceled=1`,
      });
      await getDb().insert(schema.paymentRecords).values({
        userId: ctx.user.id, provider: provider.name, providerRef,
        tier: input.tier, amount, currency: "aed", status: "pending", purpose: "membership",
      });
      return { url };
    }),

  /* ---- identity: user + member + latest application ---- */
  me: authedQuery.query(async ({ ctx }) => {
    const member = await getMemberByUserId(ctx.user.id);
    let application: schema.Application | null = null;
    if (!member) {
      const apps = await getDb()
        .select().from(schema.applications)
        .where(eq(schema.applications.userId, ctx.user.id))
        .orderBy(desc(schema.applications.createdAt)).limit(1);
      application = apps.at(0) ?? null;
    }
    return { user: ctx.user, member, application };
  }),

  /* ---- application (BRD 9.1: public interest -> screening workflow) ---- */
  submitApplication: authedQuery
    .input(z.object({
      name: z.string().min(2),
      company: z.string().optional(),
      stage: z.string().optional(),
      revenue: z.string().optional(),
      why: z.string().max(2000).optional(),
      tierRequested: z.enum(["horizon", "ascent", "vanguard", "zenith"]),
      proofPoint: z.string().max(4000).optional(), // BRD 6.2 — Vanguard proof point
      consent: z.boolean(),                        // BRD 8.4 — PDPL consent capture
    }))
    .mutation(async ({ ctx, input }) => {
      if (!input.consent)
        throw new TRPCError({ code: "BAD_REQUEST", message: "PDPL consent is required to apply" });
      const existing = await getMemberByUserId(ctx.user.id);
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "Already a member" });
      const pending = await getDb().select().from(schema.applications)
        .where(and(eq(schema.applications.userId, ctx.user.id),
                   sql`${schema.applications.status} in ('received','screening','interview')`))
        .limit(1);
      if (pending.length) throw new TRPCError({ code: "CONFLICT", message: "Application already in screening" });
      await getDb().insert(schema.applications).values({
        userId: ctx.user.id,
        name: input.name,
        email: ctx.user.email ?? "",
        company: input.company,
        stage: input.stage,
        revenue: input.revenue,
        why: input.why,
        tierRequested: input.tierRequested,
        proofPoint: input.proofPoint,
        consentAt: new Date(),
      });
      return { ok: true };
    }),

  /* ---- dashboard aggregate ---- */
  dashboard: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    const db = getDb();
    const nextSess = await nextSessionForMember(member.id);
    const openItems = await db.select({ id: schema.actionItems.id })
      .from(schema.actionItems)
      .where(and(eq(schema.actionItems.memberId, member.id), eq(schema.actionItems.status, "open")));
    const myRegs = await db.select({ event: schema.events, reg: schema.eventRegs })
      .from(schema.eventRegs)
      .innerJoin(schema.events, eq(schema.eventRegs.eventId, schema.events.id))
      .where(and(eq(schema.eventRegs.memberId, member.id),
                 sql`${schema.eventRegs.status} in ('registered','attended')`,
                 gte(schema.events.startsAt, new Date())))
      .orderBy(asc(schema.events.startsAt)).limit(4);
    const podCount = await db.select({ n: sql<number>`count(*)` })
      .from(schema.podMembers).where(eq(schema.podMembers.memberId, member.id));

    // Onboarding activation checklist (SRS 5.3 / 13.3).
    const nPods = podCount.at(0)?.n ?? 0;
    const hasBuddy = (await db.select({ id: schema.buddies.id }).from(schema.buddies)
      .where(sql`${schema.buddies.newMemberId} = ${member.id} or ${schema.buddies.buddyMemberId} = ${member.id}`).limit(1)).length > 0;
    const hasEvent = (await db.select({ id: schema.eventRegs.id }).from(schema.eventRegs)
      .where(eq(schema.eventRegs.memberId, member.id)).limit(1)).length > 0;
    const hasOneToOne = (await db.select({ id: schema.oneToOnes.id }).from(schema.oneToOnes)
      .where(sql`${schema.oneToOnes.aMemberId} = ${member.id} or ${schema.oneToOnes.bMemberId} = ${member.id}`).limit(1)).length > 0;
    const onboarding = {
      profile: !!(member.company && member.phone),
      buddy: hasBuddy,
      pod: nPods > 0,
      event: hasEvent,
      oneToOne: hasOneToOne,
    };
    const onboardingDone = Object.values(onboarding).every(Boolean);

    return { member, nextSession: nextSess, openActionItems: openItems.length,
             upcomingEvents: myRegs, podCount: nPods, onboarding, onboardingDone };
  }),

  updateProfile: authedQuery
    .input(z.object({ company: z.string().max(255).optional(), title: z.string().max(255).optional(),
                    phone: z.string().max(64).optional() }))
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      await getDb().update(schema.members).set(input).where(eq(schema.members.id, member.id));
      return { ok: true };
    }),

  /* ---- membership changes (BRD 9.1: upgrade/downgrade/pause/cancel/renew as events) ---- */
  requestMembershipChange: authedQuery
    .input(z.object({
      type: z.enum(["upgrade", "downgrade", "pause", "cancel", "renew"]),
      toTier: z.enum(["horizon", "ascent", "vanguard", "zenith"]).optional(),
      note: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      const db = getDb();

      // Governance: a tier change is a *request* the member submits — management
      // reviews and approves it. The member's tier is NOT changed here; it moves
      // only when an admin approves the pending request (admin.decideTierRequest).
      if (input.type === "upgrade" || input.type === "downgrade") {
        if (!input.toTier) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick a tier to change to." });
        if (input.toTier === member.tier) throw new TRPCError({ code: "BAD_REQUEST", message: "That's already your tier." });
        const existingPending = await db.select().from(schema.membershipEvents)
          .where(and(eq(schema.membershipEvents.memberId, member.id), eq(schema.membershipEvents.status, "pending")))
          .limit(1);
        if (existingPending.length)
          throw new TRPCError({ code: "CONFLICT", message: "You already have a tier change awaiting approval." });
        // Direction is derived server-side so it always matches the tiers.
        const type = tierRank(input.toTier) > tierRank(member.tier) ? "upgrade" : "downgrade";
        await db.insert(schema.membershipEvents).values({
          memberId: member.id, type, fromTier: member.tier, toTier: input.toTier,
          note: input.note, status: "pending",
        });
        return { ok: true, pending: true };
      }

      // Self-serve actions (the member's own right): applied immediately.
      await db.insert(schema.membershipEvents).values({
        memberId: member.id, type: input.type, fromTier: member.tier,
        toTier: member.tier, note: input.note, status: "applied",
      });
      if (input.type === "pause" || input.type === "cancel") {
        await db.update(schema.members)
          .set({ status: input.type === "pause" ? "paused" : "cancelled" })
          .where(eq(schema.members.id, member.id));
      } else if (input.type === "renew") {
        const next = new Date(member.renewalAt ?? new Date());
        next.setFullYear(next.getFullYear() + 1);
        await db.update(schema.members).set({ renewalAt: next, status: "active" })
          .where(eq(schema.members.id, member.id));
      }
      return { ok: true, pending: false };
    }),

  /* Any tier change the member has awaiting management approval (0 or 1). */
  pendingTierRequest: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    const row = (await getDb().select().from(schema.membershipEvents)
      .where(and(eq(schema.membershipEvents.memberId, member.id), eq(schema.membershipEvents.status, "pending")))
      .orderBy(desc(schema.membershipEvents.createdAt)).limit(1)).at(0);
    return row ?? null;
  }),

  membershipHistory: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    return getDb().select().from(schema.membershipEvents)
      .where(eq(schema.membershipEvents.memberId, member.id))
      .orderBy(desc(schema.membershipEvents.createdAt)).limit(30);
  }),

  /* ---- chapter transfers (BRD 6.7): member requests, management approves ---- */
  /* The chapters a member can request to move to (all but their current one). */
  chaptersDirectory: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    const rows = await getDb().select({
      id: schema.chapters.id, name: schema.chapters.name, code: schema.chapters.code,
      country: schema.chapters.country, region: schema.chapters.region,
      state: schema.chapters.state, city: schema.chapters.city, zone: schema.chapters.zone,
      status: schema.chapters.status,
    }).from(schema.chapters)
      .orderBy(asc(schema.chapters.country), asc(schema.chapters.name)).limit(200);
    return { chapters: rows, homeChapterId: member.homeChapterId ?? null };
  }),

  myChapterTransfer: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    return (await getDb().select().from(schema.chapterTransfers)
      .where(and(eq(schema.chapterTransfers.memberId, member.id), eq(schema.chapterTransfers.status, "pending")))
      .orderBy(desc(schema.chapterTransfers.createdAt)).limit(1)).at(0) ?? null;
  }),

  requestChapterTransfer: authedQuery
    .input(z.object({ toChapterId: z.number().int().positive(), note: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      const db = getDb();
      if (member.homeChapterId === input.toChapterId)
        throw new TRPCError({ code: "BAD_REQUEST", message: "That's already your home chapter." });
      const target = (await db.select().from(schema.chapters).where(eq(schema.chapters.id, input.toChapterId)).limit(1)).at(0);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Chapter not found" });
      const existing = await db.select().from(schema.chapterTransfers)
        .where(and(eq(schema.chapterTransfers.memberId, member.id), eq(schema.chapterTransfers.status, "pending"))).limit(1);
      if (existing.length)
        throw new TRPCError({ code: "CONFLICT", message: "You already have a transfer request awaiting approval." });
      await db.insert(schema.chapterTransfers).values({
        memberId: member.id, fromChapterId: member.homeChapterId ?? null,
        toChapterId: input.toChapterId, note: input.note, status: "pending",
      });
      return { ok: true };
    }),

  /* ---- pods & masterminds (BRD 9.2) ---- */
  myPods: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    const rows = await getDb()
      .select({ pod: schema.pods, role: schema.podMembers.role })
      .from(schema.podMembers)
      .innerJoin(schema.pods, eq(schema.podMembers.podId, schema.pods.id))
      .where(eq(schema.podMembers.memberId, member.id));
    // Batch the per-pod member counts into one grouped query (was N+1), and
    // fetch the member's next session once (it's the same regardless of pod).
    const podIds = rows.map((r) => r.pod.id);
    const counts = podIds.length
      ? await getDb()
          .select({ podId: schema.podMembers.podId, n: sql<number>`count(*)` })
          .from(schema.podMembers)
          .where(sql`${schema.podMembers.podId} in (${sql.join(podIds.map((i) => sql`${i}`), sql`, `)})`)
          .groupBy(schema.podMembers.podId)
      : [];
    const countMap = new Map(counts.map((c) => [c.podId, Number(c.n)]));
    const next = await nextSessionForMember(member.id);
    return rows.map((r) => ({
      ...r,
      memberCount: countMap.get(r.pod.id) ?? 0,
      nextSession: next && next.pod.id === r.pod.id ? next.session : null,
    }));
  }),

  podDetail: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      const db = getDb();
      const inRoster = await db.select().from(schema.podMembers)
        .where(and(eq(schema.podMembers.podId, input.id), eq(schema.podMembers.memberId, member.id))).limit(1);
      if (!inRoster.length) throw new TRPCError({ code: "FORBIDDEN", message: "Not in this pod" });
      const pod = (await db.select().from(schema.pods).where(eq(schema.pods.id, input.id)).limit(1)).at(0);
      if (!pod) throw new TRPCError({ code: "NOT_FOUND" });
      const roster = await db
        .select({ role: schema.podMembers.role, member: schema.members, user: schema.users })
        .from(schema.podMembers)
        .innerJoin(schema.members, eq(schema.podMembers.memberId, schema.members.id))
        .innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
        .where(eq(schema.podMembers.podId, input.id));
      const sess = await db.select().from(schema.sessions)
        .where(eq(schema.sessions.podId, input.id))
        .orderBy(desc(schema.sessions.startsAt)).limit(12);
      const sessIds = sess.map(s => s.id);
      const notes = sessIds.length
        ? await db.select().from(schema.sessionNotes).where(sql`${schema.sessionNotes.sessionId} in (${sql.join(sessIds.map(i => sql`${i}`), sql`, `)})`)
        : [];
      const myAttendance = sessIds.length
        ? await db.select().from(schema.attendance)
            .where(and(eq(schema.attendance.memberId, member.id),
                       sql`${schema.attendance.sessionId} in (${sql.join(sessIds.map(i => sql`${i}`), sql`, `)})`))
        : [];
      const items = await db
        .select({ item: schema.actionItems, user: schema.users })
        .from(schema.actionItems)
        .innerJoin(schema.members, eq(schema.actionItems.memberId, schema.members.id))
        .innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
        .where(eq(schema.actionItems.podId, input.id))
        .orderBy(desc(schema.actionItems.createdAt)).limit(40);
      return { pod, roster, sessions: sess, notes, myAttendance, actionItems: items, me: member };
    }),

  completeActionItem: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      const db = getDb();
      const item = (await db.select().from(schema.actionItems)
        .where(eq(schema.actionItems.id, input.id)).limit(1)).at(0);
      if (!item || item.memberId !== member.id) throw new TRPCError({ code: "FORBIDDEN" });
      if (item.status === "done") return { ok: true, score: member.hiveScore };
      await db.update(schema.actionItems)
        .set({ status: "done", doneAt: new Date() })
        .where(eq(schema.actionItems.id, item.id));
      const score = await awardPoints(member.id, "action_items", 5, "Action item completed");
      return { ok: true, score };
    }),

  /* ---- events (BRD 9.6) ---- */
  events: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    const db = getDb();
    const upcoming = await db.select().from(schema.events)
      .where(gte(schema.events.startsAt, new Date()))
      .orderBy(asc(schema.events.startsAt)).limit(24);
    const regs = await db.select().from(schema.eventRegs)
      .where(and(eq(schema.eventRegs.memberId, member.id),
                 sql`${schema.eventRegs.status} in ('registered','waitlisted','attended')`));
    const regMap = new Map(regs.map(r => [r.eventId, r]));
    // Batch seat counts for all upcoming events into one grouped query (was N+1).
    const evIds = upcoming.map((e) => e.id);
    const counts = evIds.length
      ? await db.select({ eventId: schema.eventRegs.eventId, n: sql<number>`count(*)` })
          .from(schema.eventRegs)
          .where(and(
            sql`${schema.eventRegs.eventId} in (${sql.join(evIds.map((i) => sql`${i}`), sql`, `)})`,
            sql`${schema.eventRegs.status} in ('registered','attended')`,
          ))
          .groupBy(schema.eventRegs.eventId)
      : [];
    const countMap = new Map(counts.map((c) => [c.eventId, Number(c.n)]));
    return upcoming.map((e) => {
      const reg = regMap.get(e.id);
      return {
        ...e,
        registered: !!reg,
        regStatus: reg?.status ?? null,
        checkinCode: reg?.status === "registered" ? reg.checkinCode : null,
        seatsLeft: e.capacity - (countMap.get(e.id) ?? 0),
        // Eligibility now follows the activity's audience settings, not just a
        // single tier floor. `eligibleTiers` lets the client explain the gate.
        allowed: memberCanAccessEvent(member.tier, e),
        eligibleTiers: eventEligibleTiers(e),
      };
    });
  }),

  registerEvent: authedQuery
    .input(z.object({ eventId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      const db = getDb();
      const ev = (await db.select().from(schema.events).where(eq(schema.events.id, input.eventId)).limit(1)).at(0);
      if (!ev) throw new TRPCError({ code: "NOT_FOUND" });
      // Temporal integrity: can't register for an event that has already started.
      if (new Date(ev.startsAt).getTime() <= Date.now())
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This event has already started — registration is closed." });
      if (!memberCanAccessEvent(member.tier, ev))
        throw new TRPCError({ code: "FORBIDDEN", message: "This activity isn't open to your tier." });
      const existing = await db.select().from(schema.eventRegs)
        .where(and(eq(schema.eventRegs.eventId, ev.id), eq(schema.eventRegs.memberId, member.id))).limit(1);
      if (existing.length && existing[0].status !== "cancelled")
        throw new TRPCError({ code: "CONFLICT", message: "Already registered" });
      const count = await db.select({ n: sql<number>`count(*)` }).from(schema.eventRegs)
        .where(and(eq(schema.eventRegs.eventId, ev.id),
                   sql`${schema.eventRegs.status} in ('registered','attended')`));
      // BRD 6.4 — at capacity: join the waitlist instead of hard-failing
      const full = (count.at(0)?.n ?? 0) >= ev.capacity;
      if (full) {
        if (existing.length) {
          await db.update(schema.eventRegs).set({ status: "waitlisted" })
            .where(eq(schema.eventRegs.id, existing[0].id));
        } else {
          await db.insert(schema.eventRegs).values({ eventId: ev.id, memberId: member.id, status: "waitlisted" });
        }
        return { ok: true, waitlisted: true };
      }
      // points are written at QR check-in (BRD 6.4), not at registration
      if (existing.length) {
        await db.update(schema.eventRegs).set({ status: "registered", checkinCode: newCheckinCode() })
          .where(eq(schema.eventRegs.id, existing[0].id));
      } else {
        await db.insert(schema.eventRegs)
          .values({ eventId: ev.id, memberId: member.id, checkinCode: newCheckinCode() });
      }
      return { ok: true, waitlisted: false };
    }),

  cancelEventReg: authedQuery
    .input(z.object({ eventId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      const db = getDb();
      const reg = (await db.select().from(schema.eventRegs)
        .where(and(eq(schema.eventRegs.eventId, input.eventId),
                   eq(schema.eventRegs.memberId, member.id))).limit(1)).at(0);
      const wasRegistered = reg?.status === "registered";
      await db.update(schema.eventRegs).set({ status: "cancelled" })
        .where(and(eq(schema.eventRegs.eventId, input.eventId),
                   eq(schema.eventRegs.memberId, member.id)));
      // BRD 6.4 — freed seat auto-promotes the waitlist
      if (wasRegistered) await promoteWaitlist(input.eventId);
      return { ok: true };
    }),

  /* ---- hive score (BRD 9.3) ---- */
  myScore: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    const db = getDb();
    const config = await db.select().from(schema.hiveScoreConfig);
    const sums = await db.select({ factor: schema.scoreEvents.factor,
        total: sql<number>`coalesce(sum(${schema.scoreEvents.points}),0)` })
      .from(schema.scoreEvents)
      .where(eq(schema.scoreEvents.memberId, member.id))
      .groupBy(schema.scoreEvents.factor);
    const history = await db.select().from(schema.hiveScoreHistory)
      .where(eq(schema.hiveScoreHistory.memberId, member.id))
      .orderBy(desc(schema.hiveScoreHistory.computedAt)).limit(12);
    const recent = await db.select().from(schema.scoreEvents)
      .where(eq(schema.scoreEvents.memberId, member.id))
      .orderBy(desc(schema.scoreEvents.createdAt)).limit(10);
    return { member, config, sums, history, recent };
  }),

  /* ---- FRP (BRD 9.4) ---- */
  frpCohorts: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    const db = getDb();
    const cohorts = await db.select().from(schema.frpCohorts)
      .where(sql`${schema.frpCohorts.status} != 'closed'`)
      .orderBy(asc(schema.frpCohorts.startsAt));
    const mine = await db.select().from(schema.frpEnrolments)
      .where(and(eq(schema.frpEnrolments.memberId, member.id),
                 sql`${schema.frpEnrolments.status} != 'withdrawn'`));
    const mineMap = new Map(mine.map(m => [m.cohortId, m]));
    return cohorts.map(c => ({
      ...c,
      enrolled: mineMap.has(c.id),
      allowed: tierRank(member.tier) >= tierRank(c.tierGate),
    }));
  }),

  frpEnrol: authedQuery
    .input(z.object({ cohortId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      const db = getDb();
      const cohort = (await db.select().from(schema.frpCohorts)
        .where(eq(schema.frpCohorts.id, input.cohortId)).limit(1)).at(0);
      if (!cohort) throw new TRPCError({ code: "NOT_FOUND" });
      if (tierRank(member.tier) < tierRank(cohort.tierGate))
        throw new TRPCError({ code: "FORBIDDEN", message: "FRP enrolment is gated to " + cohort.tierGate + " and above" });
      const dup = await db.select().from(schema.frpEnrolments)
        .where(and(eq(schema.frpEnrolments.cohortId, cohort.id),
                   eq(schema.frpEnrolments.memberId, member.id),
                   sql`${schema.frpEnrolments.status} != 'withdrawn'`)).limit(1);
      if (dup.length) throw new TRPCError({ code: "CONFLICT", message: "Already enrolled" });
      const res = await db.insert(schema.frpEnrolments).values({ cohortId: cohort.id, memberId: member.id });
      const enrolmentId = Number(res[0].insertId);
      for (const key of ["deck", "model", "dataroom"] as const) {
        await db.insert(schema.frpMilestones).values({ enrolmentId, key });
      }
      await db.insert(schema.readinessAssessments).values({ enrolmentId });
      return { ok: true };
    }),

  myFrp: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    const db = getDb();
    const rows = await db.select({ enr: schema.frpEnrolments, cohort: schema.frpCohorts })
      .from(schema.frpEnrolments)
      .innerJoin(schema.frpCohorts, eq(schema.frpEnrolments.cohortId, schema.frpCohorts.id))
      .where(and(eq(schema.frpEnrolments.memberId, member.id),
                 sql`${schema.frpEnrolments.status} != 'withdrawn'`))
      .orderBy(desc(schema.frpEnrolments.createdAt)).limit(1);
    const cur = rows.at(0);
    if (!cur) return null;
    const milestones = await db.select().from(schema.frpMilestones)
      .where(eq(schema.frpMilestones.enrolmentId, cur.enr.id));
    const assessment = (await db.select().from(schema.readinessAssessments)
      .where(eq(schema.readinessAssessments.enrolmentId, cur.enr.id)).limit(1)).at(0) ?? null;
    return { enrolment: cur.enr, cohort: cur.cohort, milestones, assessment };
  }),

  saveAssessment: authedQuery
    .input(z.object({
      enrolmentId: z.number(),
      team: z.number().min(0).max(5), traction: z.number().min(0).max(5),
      market: z.number().min(0).max(5), financials: z.number().min(0).max(5),
      narrative: z.number().min(0).max(5), legal: z.number().min(0).max(5),
    }))
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      const db = getDb();
      const enr = (await db.select().from(schema.frpEnrolments)
        .where(eq(schema.frpEnrolments.id, input.enrolmentId)).limit(1)).at(0);
      if (!enr || enr.memberId !== member.id) throw new TRPCError({ code: "FORBIDDEN" });
      await db.update(schema.readinessAssessments).set({
        team: input.team, traction: input.traction, market: input.market,
        financials: input.financials, narrative: input.narrative, legal: input.legal,
      }).where(eq(schema.readinessAssessments.enrolmentId, input.enrolmentId));
      return { ok: true };
    }),

  submitMilestone: authedQuery
    .input(z.object({ id: z.number(), note: z.string().max(1000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      const db = getDb();
      const ms = (await db.select().from(schema.frpMilestones)
        .where(eq(schema.frpMilestones.id, input.id)).limit(1)).at(0);
      if (!ms) throw new TRPCError({ code: "NOT_FOUND" });
      const enr = (await db.select().from(schema.frpEnrolments)
        .where(eq(schema.frpEnrolments.id, ms.enrolmentId)).limit(1)).at(0);
      if (!enr || enr.memberId !== member.id) throw new TRPCError({ code: "FORBIDDEN" });
      await db.update(schema.frpMilestones)
        .set({ status: "submitted", note: input.note ?? ms.note })
        .where(eq(schema.frpMilestones.id, ms.id));
      return { ok: true };
    }),

  /* ---- governance (BRD 9.5) ---- */
  governance: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    const db = getDb();
    const bodies = await db.select().from(schema.govBodies).orderBy(asc(schema.govBodies.name));
    const roles = await db.select({ role: schema.govRoles, body: schema.govBodies,
        member: schema.members, user: schema.users })
      .from(schema.govRoles)
      .innerJoin(schema.govBodies, eq(schema.govRoles.bodyId, schema.govBodies.id))
      .innerJoin(schema.members, eq(schema.govRoles.memberId, schema.members.id))
      .innerJoin(schema.users, eq(schema.members.userId, schema.users.id));
    const minutes = await db.select({ minute: schema.govMinutes, body: schema.govBodies })
      .from(schema.govMinutes)
      .innerJoin(schema.govBodies, eq(schema.govMinutes.bodyId, schema.govBodies.id))
      .orderBy(desc(schema.govMinutes.date)).limit(12);
    const pols = await db.select().from(schema.policies).orderBy(desc(schema.policies.createdAt));
    const acks = await db.select().from(schema.policyAcks)
      .where(eq(schema.policyAcks.memberId, member.id));
    return { bodies, roles, minutes,
             policies: pols.map(p => ({ ...p, acknowledged: acks.some(a => a.policyId === p.id) })),
             myRoles: roles.filter(r => r.member.id === member.id) };
  }),

  ackPolicy: authedQuery
    .input(z.object({ policyId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      const db = getDb();
      const dup = await db.select().from(schema.policyAcks)
        .where(and(eq(schema.policyAcks.policyId, input.policyId),
                   eq(schema.policyAcks.memberId, member.id))).limit(1);
      if (dup.length) return { ok: true };
      await db.insert(schema.policyAcks).values({ policyId: input.policyId, memberId: member.id });
      return { ok: true };
    }),

  /* ---- library & offers (BRD 9.6 / 6.7) ---- */
  library: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    const items = await getDb().select().from(schema.libraryItems)
      .orderBy(desc(schema.libraryItems.createdAt));
    return items.map(i => ({ ...i, locked: tierRank(member.tier) < tierRank(i.tierGate) }));
  }),

  offers: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    const items = await getDb().select().from(schema.offers)
      .orderBy(asc(schema.offers.vertical), desc(schema.offers.createdAt));
    return items.filter(i => tierRank(member.tier) >= tierRank(i.tierGate));
  }),
});
