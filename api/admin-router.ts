import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { createRouter, adminQuery } from "./middleware";
import { awardPoints, awardRulePoints, promoteWaitlist, recomputeScore, autoPairBuddy } from "./queries/circle";
import { tierRank } from "@contracts/constants";

const TIER = z.enum(["horizon", "ascent", "vanguard", "zenith"]);
const idInput = z.object({ id: z.number().int().positive() });

async function mustMember(memberId: number) {
  const rows = await getDb()
    .select()
    .from(schema.members)
    .where(eq(schema.members.id, memberId))
    .limit(1);
  const m = rows.at(0);
  if (!m) throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
  return m;
}

export const adminRouter = createRouter({
  /* ------------------------------ dashboard ------------------------------ */
  stats: adminQuery.query(async () => {
    const db = getDb();
    const byTier = await db
      .select({ tier: schema.members.tier, n: sql<number>`count(*)` })
      .from(schema.members)
      .where(eq(schema.members.status, "active"))
      .groupBy(schema.members.tier);
    const [pend] = await db
      .select({ n: sql<number>`count(*)` })
      .from(schema.applications)
      .where(
        or(
          eq(schema.applications.status, "received"),
          eq(schema.applications.status, "screening"),
          eq(schema.applications.status, "interview"),
        ),
      );
    const [act] = await db
      .select({ n: sql<number>`count(*)`, avg: sql<number>`coalesce(avg(hiveScore),0)` })
      .from(schema.members)
      .where(eq(schema.members.status, "active"));
    const [upEv] = await db
      .select({ n: sql<number>`count(*)` })
      .from(schema.events)
      .where(sql`${schema.events.startsAt} >= now()`);
    const [leadCount] = await db.select({ n: sql<number>`count(*)` }).from(schema.leads);
    const recentApps = await db
      .select({
        id: schema.applications.id,
        name: schema.applications.name,
        company: schema.applications.company,
        tierRequested: schema.applications.tierRequested,
        status: schema.applications.status,
        createdAt: schema.applications.createdAt,
      })
      .from(schema.applications)
      .orderBy(desc(schema.applications.createdAt))
      .limit(6);
    const recentLeads = await db
      .select()
      .from(schema.leads)
      .orderBy(desc(schema.leads.createdAt))
      .limit(6);
    const scoreDist = await db
      .select({
        band: sql<string>`case when hiveScore >= 80 then '80+' when hiveScore >= 60 then '60-79' when hiveScore >= 40 then '40-59' when hiveScore >= 20 then '20-39' else '0-19' end`,
        n: sql<number>`count(*)`,
      })
      .from(schema.members)
      .where(eq(schema.members.status, "active"))
      .groupBy(sql`1`);
    return {
      byTier,
      pendingApplications: pend?.n ?? 0,
      activeMembers: act?.n ?? 0,
      avgScore: Math.round(act?.avg ?? 0),
      upcomingEvents: upEv?.n ?? 0,
      totalLeads: leadCount?.n ?? 0,
      recentApps,
      recentLeads,
      scoreDist,
    };
  }),

  /* ---------------------------- applications ----------------------------- */
  applications: adminQuery
    .input(z.object({ status: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const base = db
        .select({
          app: schema.applications,
          userEmail: schema.users.email,
          userName: schema.users.name,
        })
        .from(schema.applications)
        .leftJoin(schema.users, eq(schema.users.id, schema.applications.userId))
        .orderBy(desc(schema.applications.createdAt))
        .limit(200);
      if (input?.status) {
        base.where(eq(schema.applications.status, input.status as never));
      }
      return base;
    }),

  setApplicationStatus: adminQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        status: z.enum(["received", "screening", "interview", "approved", "rejected"]),
        note: z.string().max(2000).optional(),
        tier: TIER.optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(schema.applications)
        .where(eq(schema.applications.id, input.id))
        .limit(1);
      const app = rows.at(0);
      if (!app) throw new TRPCError({ code: "NOT_FOUND", message: "Application not found" });

      const decided = input.status === "approved" || input.status === "rejected";
      await db
        .update(schema.applications)
        .set({
          status: input.status,
          note: input.note ?? app.note,
          decidedAt: decided ? new Date() : null,
        })
        .where(eq(schema.applications.id, input.id));

      if (input.status === "approved") {
        // Create membership if none exists yet
        const existing = await db
          .select()
          .from(schema.members)
          .where(eq(schema.members.userId, app.userId))
          .limit(1);
        if (existing.length === 0) {
          const tier = input.tier ?? app.tierRequested;
          const renewal = new Date();
          renewal.setFullYear(renewal.getFullYear() + 1);
          const res = await db.insert(schema.members).values({
            userId: app.userId,
            tier,
            status: "active",
            company: app.company,
            renewalAt: renewal,
          });
          const memberId = Number(res[0].insertId);
          await db.insert(schema.membershipEvents).values({
            memberId,
            type: "approved",
            toTier: tier,
            note: input.note ?? "Application approved",
          });
          await awardPoints(memberId, "tenure", 5, "Joined eHive Circle");
          // Onboarding automation: auto-pair a buddy (never block approval on it).
          try { await autoPairBuddy(memberId); } catch (e) { console.error("buddy auto-pair failed", e); }
          return { ok: true, memberId };
        }
      }
      return { ok: true };
    }),

  /* ------------------------------- members -------------------------------- */
  members: adminQuery
    .input(
      z
        .object({
          q: z.string().max(120).optional(),
          tier: TIER.optional(),
          status: z.enum(["active", "paused", "cancelled"]).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conds = [];
      if (input?.tier) conds.push(eq(schema.members.tier, input.tier));
      if (input?.status) conds.push(eq(schema.members.status, input.status));
      if (input?.q) {
        const q = `%${input.q}%`;
        conds.push(
          or(
            like(schema.users.name, q),
            like(schema.users.email, q),
            like(schema.members.company, q),
          ),
        );
      }
      return db
        .select({
          member: schema.members,
          userName: schema.users.name,
          userEmail: schema.users.email,
          userAvatar: schema.users.avatar,
        })
        .from(schema.members)
        .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(schema.members.hiveScore))
        .limit(300);
    }),

  memberDetail: adminQuery.input(idInput).query(async ({ input }) => {
    const db = getDb();
    const rows = await db
      .select({
        member: schema.members,
        userName: schema.users.name,
        userEmail: schema.users.email,
        userAvatar: schema.users.avatar,
      })
      .from(schema.members)
      .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
      .where(eq(schema.members.id, input.id))
      .limit(1);
    const row = rows.at(0);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
    const mid = row.member.id;
    const [hist, podRows, apps, actions, scoreHist, regs] = await Promise.all([
      db
        .select()
        .from(schema.membershipEvents)
        .where(eq(schema.membershipEvents.memberId, mid))
        .orderBy(desc(schema.membershipEvents.createdAt)),
      db
        .select({ pod: schema.pods, role: schema.podMembers.role })
        .from(schema.podMembers)
        .innerJoin(schema.pods, eq(schema.pods.id, schema.podMembers.podId))
        .where(eq(schema.podMembers.memberId, mid)),
      db
        .select()
        .from(schema.applications)
        .where(eq(schema.applications.userId, row.member.userId))
        .orderBy(desc(schema.applications.createdAt)),
      db
        .select()
        .from(schema.actionItems)
        .where(eq(schema.actionItems.memberId, mid))
        .orderBy(desc(schema.actionItems.createdAt))
        .limit(20),
      db
        .select()
        .from(schema.hiveScoreHistory)
        .where(eq(schema.hiveScoreHistory.memberId, mid))
        .orderBy(desc(schema.hiveScoreHistory.computedAt))
        .limit(12),
      db
        .select({ ev: schema.events, status: schema.eventRegs.status })
        .from(schema.eventRegs)
        .innerJoin(schema.events, eq(schema.events.id, schema.eventRegs.eventId))
        .where(eq(schema.eventRegs.memberId, mid))
        .orderBy(desc(schema.events.startsAt))
        .limit(20),
    ]);
    return { ...row, history: hist, pods: podRows, applications: apps, actionItems: actions, scoreHistory: scoreHist, eventRegs: regs };
  }),

  setMemberTier: adminQuery
    .input(z.object({ memberId: z.number().int().positive(), tier: TIER, note: z.string().max(500).optional() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const m = await mustMember(input.memberId);
      if (m.tier === input.tier) return { ok: true };
      const type = tierRank(input.tier) > tierRank(m.tier) ? "upgrade" : "downgrade";
      await db.update(schema.members).set({ tier: input.tier }).where(eq(schema.members.id, m.id));
      await db.insert(schema.membershipEvents).values({
        memberId: m.id,
        type,
        fromTier: m.tier,
        toTier: input.tier,
        note: input.note,
      });
      return { ok: true, type };
    }),

  setMemberStatus: adminQuery
    .input(
      z.object({
        memberId: z.number().int().positive(),
        status: z.enum(["active", "paused", "cancelled"]),
        note: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const m = await mustMember(input.memberId);
      await db.update(schema.members).set({ status: input.status }).where(eq(schema.members.id, m.id));
      if (input.status !== "active") {
        await db.insert(schema.membershipEvents).values({
          memberId: m.id,
          type: input.status === "paused" ? "pause" : "cancel",
          note: input.note,
        });
      }
      return { ok: true };
    }),

  adjustScore: adminQuery
    .input(
      z.object({
        memberId: z.number().int().positive(),
        factor: z.string().max(64),
        points: z.number().int().min(-50).max(50),
        note: z.string().max(255).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      await mustMember(input.memberId);
      await awardPoints(input.memberId, input.factor, input.points, input.note ?? "Admin adjustment");
      return { ok: true };
    }),

  /* --------------------------------- pods --------------------------------- */
  pods: adminQuery.query(async () => {
    const db = getDb();
    const rows = await db.select().from(schema.pods).orderBy(desc(schema.pods.createdAt));
    const out = [];
    for (const p of rows) {
      const [mc] = await db
        .select({ n: sql<number>`count(*)` })
        .from(schema.podMembers)
        .where(eq(schema.podMembers.podId, p.id));
      const next = await db
        .select()
        .from(schema.sessions)
        .where(and(eq(schema.sessions.podId, p.id), eq(schema.sessions.status, "scheduled")))
        .orderBy(schema.sessions.startsAt)
        .limit(1);
      out.push({ ...p, memberCount: mc?.n ?? 0, nextSession: next.at(0) ?? null });
    }
    return out;
  }),

  createPod: adminQuery
    .input(
      z.object({
        name: z.string().min(2).max(255),
        kind: z.enum(["pod", "mastermind"]).default("pod"),
        facilitator: z.string().max(255).optional(),
        capacity: z.number().int().min(2).max(50).default(8),
        cadence: z.string().max(128).optional(),
        tierGate: TIER.default("horizon"),
        description: z.string().max(4000).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const res = await getDb().insert(schema.pods).values(input);
      return { ok: true, id: Number(res[0].insertId) };
    }),

  updatePod: adminQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().min(2).max(255).optional(),
        facilitator: z.string().max(255).optional(),
        capacity: z.number().int().min(2).max(50).optional(),
        cadence: z.string().max(128).optional(),
        tierGate: TIER.optional(),
        description: z.string().max(4000).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, ...patch } = input;
      await getDb().update(schema.pods).set(patch).where(eq(schema.pods.id, id));
      return { ok: true };
    }),

  podAdmin: adminQuery.input(idInput).query(async ({ input }) => {
    const db = getDb();
    const podRows = await db.select().from(schema.pods).where(eq(schema.pods.id, input.id)).limit(1);
    const pod = podRows.at(0);
    if (!pod) throw new TRPCError({ code: "NOT_FOUND", message: "Pod not found" });
    const [roster, sess, allMembers] = await Promise.all([
      db
        .select({
          pm: schema.podMembers,
          member: schema.members,
          userName: schema.users.name,
          userEmail: schema.users.email,
        })
        .from(schema.podMembers)
        .innerJoin(schema.members, eq(schema.members.id, schema.podMembers.memberId))
        .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
        .where(eq(schema.podMembers.podId, input.id)),
      db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.podId, input.id))
        .orderBy(desc(schema.sessions.startsAt))
        .limit(30),
      db
        .select({
          id: schema.members.id,
          tier: schema.members.tier,
          company: schema.members.company,
          userName: schema.users.name,
          userEmail: schema.users.email,
        })
        .from(schema.members)
        .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
        .where(eq(schema.members.status, "active"))
        .orderBy(schema.users.name),
    ]);
    // Attach notes + attendance to sessions
    const sessionIds = sess.map((s) => s.id);
    const notes = sessionIds.length
      ? await db.select().from(schema.sessionNotes).where(sql`${schema.sessionNotes.sessionId} in (${sql.join(sessionIds.map((i) => sql`${i}`), sql`, `)})`)
      : [];
    const att = sessionIds.length
      ? await db.select().from(schema.attendance).where(sql`${schema.attendance.sessionId} in (${sql.join(sessionIds.map((i) => sql`${i}`), sql`, `)})`)
      : [];
    const items = await db
      .select({
        ai: schema.actionItems,
        userName: schema.users.name,
      })
      .from(schema.actionItems)
      .innerJoin(schema.members, eq(schema.members.id, schema.actionItems.memberId))
      .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
      .where(eq(schema.actionItems.podId, input.id))
      .orderBy(desc(schema.actionItems.createdAt))
      .limit(50);
    return { pod, roster, sessions: sess, notes, attendance: att, actionItems: items, allMembers };
  }),

  addToPod: adminQuery
    .input(z.object({ podId: z.number().int().positive(), memberId: z.number().int().positive(), role: z.string().max(32).default("member") }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const dup = await db
        .select()
        .from(schema.podMembers)
        .where(and(eq(schema.podMembers.podId, input.podId), eq(schema.podMembers.memberId, input.memberId)))
        .limit(1);
      if (dup.length) throw new TRPCError({ code: "CONFLICT", message: "Already in pod" });
      await db.insert(schema.podMembers).values(input);
      return { ok: true };
    }),

  removeFromPod: adminQuery
    .input(z.object({ podId: z.number().int().positive(), memberId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await getDb()
        .delete(schema.podMembers)
        .where(and(eq(schema.podMembers.podId, input.podId), eq(schema.podMembers.memberId, input.memberId)));
      return { ok: true };
    }),

  /* ------------------------------- sessions ------------------------------- */
  createSession: adminQuery
    .input(
      z.object({
        podId: z.number().int().positive(),
        startsAt: z.coerce.date(),
        durationMin: z.number().int().min(15).max(480).default(90),
        topic: z.string().max(255).optional(),
        videoLink: z.string().max(512).optional(),
        location: z.string().max(255).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const res = await getDb().insert(schema.sessions).values(input);
      return { ok: true, id: Number(res[0].insertId) };
    }),

  setSessionStatus: adminQuery
    .input(z.object({ id: z.number().int().positive(), status: z.enum(["scheduled", "done", "cancelled"]) }))
    .mutation(async ({ input }) => {
      await getDb().update(schema.sessions).set({ status: input.status }).where(eq(schema.sessions.id, input.id));
      return { ok: true };
    }),

  saveSessionNotes: adminQuery
    .input(z.object({ sessionId: z.number().int().positive(), summary: z.string().max(8000) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const existing = await db
        .select()
        .from(schema.sessionNotes)
        .where(eq(schema.sessionNotes.sessionId, input.sessionId))
        .limit(1);
      if (existing.length) {
        await db.update(schema.sessionNotes).set({ summary: input.summary }).where(eq(schema.sessionNotes.sessionId, input.sessionId));
      } else {
        await db.insert(schema.sessionNotes).values({ sessionId: input.sessionId, summary: input.summary });
      }
      return { ok: true };
    }),

  markAttendance: adminQuery
    .input(
      z.object({
        sessionId: z.number().int().positive(),
        memberId: z.number().int().positive(),
        status: z.enum(["attended", "absent", "excused"]),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const existing = await db
        .select()
        .from(schema.attendance)
        .where(and(eq(schema.attendance.sessionId, input.sessionId), eq(schema.attendance.memberId, input.memberId)))
        .limit(1);
      const prev = existing.at(0);
      if (prev) {
        await db
          .update(schema.attendance)
          .set({ status: input.status, markedAt: new Date() })
          .where(eq(schema.attendance.id, prev.id));
        // award points only on transition to attended
        if (input.status === "attended" && prev.status !== "attended") {
          await awardRulePoints(input.memberId, "session_attend");
        }
      } else {
        await db.insert(schema.attendance).values(input);
        if (input.status === "attended") {
          await awardRulePoints(input.memberId, "session_attend");
        }
      }
      return { ok: true };
    }),

  assignActionItem: adminQuery
    .input(
      z.object({
        podId: z.number().int().positive(),
        memberId: z.number().int().positive(),
        sessionId: z.number().int().positive().optional(),
        text: z.string().min(2).max(512),
        dueAt: z.coerce.date().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const res = await getDb().insert(schema.actionItems).values(input);
      return { ok: true, id: Number(res[0].insertId) };
    }),

  reopenActionItem: adminQuery.input(idInput).mutation(async ({ input }) => {
    await getDb()
      .update(schema.actionItems)
      .set({ status: "open", doneAt: null })
      .where(eq(schema.actionItems.id, input.id));
    return { ok: true };
  }),

  /* -------------------------------- events -------------------------------- */
  eventsAdmin: adminQuery.query(async () => {
    const db = getDb();
    const rows = await db.select().from(schema.events).orderBy(desc(schema.events.startsAt)).limit(100);
    const out = [];
    for (const e of rows) {
      const [rc] = await db
        .select({ n: sql<number>`count(*)` })
        .from(schema.eventRegs)
        .where(and(eq(schema.eventRegs.eventId, e.id), eq(schema.eventRegs.status, "registered")));
      out.push({ ...e, regCount: rc?.n ?? 0 });
    }
    return out;
  }),

  createEvent: adminQuery
    .input(
      z.object({
        title: z.string().min(2).max(255),
        kind: z.enum(["spark", "meetup", "circle", "retreat", "summit"]).default("meetup"),
        description: z.string().max(4000).optional(),
        startsAt: z.coerce.date(),
        location: z.string().max(255).optional(),
        tierGate: TIER.default("horizon"),
        capacity: z.number().int().min(1).max(2000).default(40),
      }),
    )
    .mutation(async ({ input }) => {
      const res = await getDb().insert(schema.events).values(input);
      return { ok: true, id: Number(res[0].insertId) };
    }),

  updateEvent: adminQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        title: z.string().min(2).max(255).optional(),
        kind: z.enum(["spark", "meetup", "circle", "retreat", "summit"]).optional(),
        description: z.string().max(4000).optional(),
        startsAt: z.coerce.date().optional(),
        location: z.string().max(255).optional(),
        tierGate: TIER.optional(),
        capacity: z.number().int().min(1).max(2000).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, ...patch } = input;
      await getDb().update(schema.events).set(patch).where(eq(schema.events.id, id));
      return { ok: true };
    }),

  eventRegs: adminQuery.input(idInput).query(async ({ input }) => {
    return getDb()
      .select({
        reg: schema.eventRegs,
        member: schema.members,
        userName: schema.users.name,
        userEmail: schema.users.email,
      })
      .from(schema.eventRegs)
      .innerJoin(schema.members, eq(schema.members.id, schema.eventRegs.memberId))
      .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
      .where(eq(schema.eventRegs.eventId, input.id))
      .orderBy(desc(schema.eventRegs.createdAt));
  }),

  markEventAttendance: adminQuery
    .input(
      z.object({
        eventId: z.number().int().positive(),
        memberId: z.number().int().positive(),
        status: z.enum(["registered", "attended", "cancelled"]),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(schema.eventRegs)
        .where(and(eq(schema.eventRegs.eventId, input.eventId), eq(schema.eventRegs.memberId, input.memberId)))
        .limit(1);
      const reg = rows.at(0);
      if (!reg) throw new TRPCError({ code: "NOT_FOUND", message: "Registration not found" });
      await db.update(schema.eventRegs).set({ status: input.status }).where(eq(schema.eventRegs.id, reg.id));
      if (input.status === "attended" && reg.status !== "attended") {
        await awardRulePoints(input.memberId, "event_attend", "Event attendance");
      }
      // freed seat auto-promotes the waitlist (BRD 6.4)
      if (input.status === "cancelled" && reg.status === "registered") {
        await promoteWaitlist(input.eventId);
      }
      return { ok: true };
    }),

  /* ----------------------------- hive score ------------------------------- */
  scoreConfig: adminQuery.query(async () => {
    const db = getDb();
    const config = await db.select().from(schema.hiveScoreConfig).orderBy(schema.hiveScoreConfig.factor);
    const top = await db
      .select({
        member: schema.members,
        userName: schema.users.name,
      })
      .from(schema.members)
      .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
      .where(eq(schema.members.status, "active"))
      .orderBy(desc(schema.members.hiveScore))
      .limit(10);
    return { config, top };
  }),

  setScoreWeights: adminQuery
    .input(z.array(z.object({ factor: z.string().max(64), weight: z.number().int().min(0).max(100) })).min(1))
    .mutation(async ({ input }) => {
      const db = getDb();
      for (const c of input) {
        const existing = await db
          .select()
          .from(schema.hiveScoreConfig)
          .where(eq(schema.hiveScoreConfig.factor, c.factor))
          .limit(1);
        if (existing.length) {
          await db.update(schema.hiveScoreConfig).set({ weight: c.weight }).where(eq(schema.hiveScoreConfig.factor, c.factor));
        } else {
          await db.insert(schema.hiveScoreConfig).values(c);
        }
      }
      return { ok: true };
    }),

  recomputeAll: adminQuery.mutation(async () => {
    const db = getDb();
    const rows = await db.select({ id: schema.members.id }).from(schema.members);
    let n = 0;
    for (const r of rows) {
      await recomputeScore(r.id);
      n++;
    }
    return { ok: true, recomputed: n };
  }),

  /* --------------------------------- FRP ---------------------------------- */
  frpCohortsAdmin: adminQuery.query(async () => {
    const db = getDb();
    const cohorts = await db.select().from(schema.frpCohorts).orderBy(desc(schema.frpCohorts.createdAt));
    const out = [];
    for (const c of cohorts) {
      const enrols = await db
        .select({
          en: schema.frpEnrolments,
          member: schema.members,
          userName: schema.users.name,
          userEmail: schema.users.email,
        })
        .from(schema.frpEnrolments)
        .innerJoin(schema.members, eq(schema.members.id, schema.frpEnrolments.memberId))
        .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
        .where(eq(schema.frpEnrolments.cohortId, c.id));
      out.push({ ...c, enrolments: enrols });
    }
    return out;
  }),

  createCohort: adminQuery
    .input(
      z.object({
        name: z.string().min(2).max(255),
        tierGate: TIER.default("vanguard"),
        startsAt: z.coerce.date().optional(),
        status: z.enum(["open", "running", "closed"]).default("open"),
      }),
    )
    .mutation(async ({ input }) => {
      const res = await getDb().insert(schema.frpCohorts).values(input);
      return { ok: true, id: Number(res[0].insertId) };
    }),

  updateCohort: adminQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().min(2).max(255).optional(),
        tierGate: TIER.optional(),
        startsAt: z.coerce.date().optional(),
        status: z.enum(["open", "running", "closed"]).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, ...patch } = input;
      await getDb().update(schema.frpCohorts).set(patch).where(eq(schema.frpCohorts.id, id));
      return { ok: true };
    }),

  setEnrolmentStatus: adminQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        status: z.enum(["enrolled", "active", "completed", "withdrawn"]),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.update(schema.frpEnrolments).set({ status: input.status }).where(eq(schema.frpEnrolments.id, input.id));
      if (input.status === "completed") {
        const rows = await db.select().from(schema.frpEnrolments).where(eq(schema.frpEnrolments.id, input.id)).limit(1);
        const en = rows.at(0);
        if (en) await awardPoints(en.memberId, "frp", 15, "Completed Fundraising Readiness Programme");
      }
      return { ok: true };
    }),

  reviewMilestone: adminQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        status: z.enum(["not_started", "in_progress", "submitted", "reviewed"]),
        note: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const rows = await db.select().from(schema.frpMilestones).where(eq(schema.frpMilestones.id, input.id)).limit(1);
      const ms = rows.at(0);
      if (!ms) throw new TRPCError({ code: "NOT_FOUND", message: "Milestone not found" });
      await db
        .update(schema.frpMilestones)
        .set({ status: input.status, note: input.note ?? ms.note })
        .where(eq(schema.frpMilestones.id, input.id));
      if (input.status === "reviewed" && ms.status !== "reviewed") {
        const en = await db.select().from(schema.frpEnrolments).where(eq(schema.frpEnrolments.id, ms.enrolmentId)).limit(1);
        if (en.at(0)) await awardPoints(en.at(0)!.memberId, "frp", 5, `${ms.key} reviewed`);
      }
      return { ok: true };
    }),

  enrolmentDetail: adminQuery.input(idInput).query(async ({ input }) => {
    const db = getDb();
    const rows = await db
      .select({
        en: schema.frpEnrolments,
        cohort: schema.frpCohorts,
        member: schema.members,
        userName: schema.users.name,
        userEmail: schema.users.email,
      })
      .from(schema.frpEnrolments)
      .innerJoin(schema.frpCohorts, eq(schema.frpCohorts.id, schema.frpEnrolments.cohortId))
      .innerJoin(schema.members, eq(schema.members.id, schema.frpEnrolments.memberId))
      .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
      .where(eq(schema.frpEnrolments.id, input.id))
      .limit(1);
    const row = rows.at(0);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Enrolment not found" });
    const [assessment, milestones] = await Promise.all([
      db.select().from(schema.readinessAssessments).where(eq(schema.readinessAssessments.enrolmentId, input.id)).limit(1),
      db.select().from(schema.frpMilestones).where(eq(schema.frpMilestones.enrolmentId, input.id)),
    ]);
    return { ...row, assessment: assessment.at(0) ?? null, milestones };
  }),

  /* ------------------------------ governance ------------------------------ */
  govAdmin: adminQuery.query(async () => {
    const db = getDb();
    const bodies = await db.select().from(schema.govBodies).orderBy(schema.govBodies.name);
    const out = [];
    for (const b of bodies) {
      const [roles, minutes] = await Promise.all([
        db
          .select({
            role: schema.govRoles,
            userName: schema.users.name,
            memberId: schema.members.id,
          })
          .from(schema.govRoles)
          .innerJoin(schema.members, eq(schema.members.id, schema.govRoles.memberId))
          .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
          .where(eq(schema.govRoles.bodyId, b.id)),
        db
          .select()
          .from(schema.govMinutes)
          .where(eq(schema.govMinutes.bodyId, b.id))
          .orderBy(desc(schema.govMinutes.date)),
      ]);
      out.push({ ...b, roles, minutes });
    }
    const pols = await db.select().from(schema.policies).orderBy(desc(schema.policies.createdAt));
    const polOut = [];
    for (const p of pols) {
      const [acks] = await db
        .select({ n: sql<number>`count(*)` })
        .from(schema.policyAcks)
        .where(eq(schema.policyAcks.policyId, p.id));
      polOut.push({ ...p, ackCount: acks?.n ?? 0 });
    }
    return { bodies: out, policies: polOut };
  }),

  createBody: adminQuery
    .input(z.object({ name: z.string().min(2).max(255), description: z.string().max(4000).optional() }))
    .mutation(async ({ input }) => {
      const res = await getDb().insert(schema.govBodies).values(input);
      return { ok: true, id: Number(res[0].insertId) };
    }),

  assignSeat: adminQuery
    .input(
      z.object({
        bodyId: z.number().int().positive(),
        memberId: z.number().int().positive(),
        seat: z.string().min(2).max(128),
        termStart: z.coerce.date().optional(),
        termEnd: z.coerce.date().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const res = await getDb().insert(schema.govRoles).values(input);
      return { ok: true, id: Number(res[0].insertId) };
    }),

  removeSeat: adminQuery.input(idInput).mutation(async ({ input }) => {
    await getDb().delete(schema.govRoles).where(eq(schema.govRoles.id, input.id));
    return { ok: true };
  }),

  publishMinutes: adminQuery
    .input(
      z.object({
        bodyId: z.number().int().positive(),
        title: z.string().min(2).max(255),
        date: z.coerce.date().optional(),
        text: z.string().max(20000).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const res = await getDb().insert(schema.govMinutes).values(input);
      return { ok: true, id: Number(res[0].insertId) };
    }),

  savePolicy: adminQuery
    .input(
      z.object({
        id: z.number().int().positive().optional(),
        title: z.string().min(2).max(255),
        body: z.string().max(50000),
        version: z.number().int().min(1).max(99).default(1),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      if (input.id) {
        await db
          .update(schema.policies)
          .set({ title: input.title, body: input.body, version: input.version })
          .where(eq(schema.policies.id, input.id));
        return { ok: true, id: input.id };
      }
      const res = await db.insert(schema.policies).values({
        title: input.title,
        body: input.body,
        version: input.version,
      });
      return { ok: true, id: Number(res[0].insertId) };
    }),

  /* ------------------------------- library -------------------------------- */
  libraryAdmin: adminQuery.query(async () => {
    return getDb().select().from(schema.libraryItems).orderBy(desc(schema.libraryItems.createdAt)).limit(200);
  }),

  saveLibraryItem: adminQuery
    .input(
      z.object({
        id: z.number().int().positive().optional(),
        title: z.string().min(2).max(255),
        kind: z.enum(["playbook", "template", "recording", "note"]).default("playbook"),
        tierGate: TIER.default("horizon"),
        url: z.string().max(512).optional(),
        description: z.string().max(4000).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      if (id) {
        await db.update(schema.libraryItems).set(data).where(eq(schema.libraryItems.id, id));
        return { ok: true, id };
      }
      const res = await db.insert(schema.libraryItems).values(data);
      return { ok: true, id: Number(res[0].insertId) };
    }),

  deleteLibraryItem: adminQuery.input(idInput).mutation(async ({ input }) => {
    await getDb().delete(schema.libraryItems).where(eq(schema.libraryItems.id, input.id));
    return { ok: true };
  }),

  /* -------------------------------- offers -------------------------------- */
  offersAdmin: adminQuery.query(async () => {
    return getDb().select().from(schema.offers).orderBy(desc(schema.offers.createdAt)).limit(100);
  }),

  saveOffer: adminQuery
    .input(
      z.object({
        id: z.number().int().positive().optional(),
        vertical: z.enum(["setup", "consulting"]),
        title: z.string().min(2).max(255),
        description: z.string().max(4000).optional(),
        ctaUrl: z.string().max(512).optional(),
        tierGate: TIER.default("horizon"),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      if (id) {
        await db.update(schema.offers).set(data).where(eq(schema.offers.id, id));
        return { ok: true, id };
      }
      const res = await db.insert(schema.offers).values(data);
      return { ok: true, id: Number(res[0].insertId) };
    }),

  deleteOffer: adminQuery.input(idInput).mutation(async ({ input }) => {
    await getDb().delete(schema.offers).where(eq(schema.offers.id, input.id));
    return { ok: true };
  }),

  /* --------------------------------- leads -------------------------------- */
  leads: adminQuery
    .input(z.object({ q: z.string().max(120).optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      if (input?.q) {
        const q = `%${input.q}%`;
        return db
          .select()
          .from(schema.leads)
          .where(or(like(schema.leads.email, q), like(schema.leads.form, q)))
          .orderBy(desc(schema.leads.createdAt))
          .limit(200);
      }
      return db.select().from(schema.leads).orderBy(desc(schema.leads.createdAt)).limit(200);
    }),
});
