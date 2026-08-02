import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { createRouter, adminQuery, scopedAdmin } from "./middleware";
import { awardPoints, awardRulePoints, promoteWaitlist, recomputeScore, autoPairBuddy, notify } from "./queries/circle";
import { computePodHealth, suggestPods } from "./queries/pods";
import { audit } from "./lib/audit";
import { findUserByEmail } from "./queries/users";
import { mailStatus, sendTestEmail } from "./lib/mailer";
import { runDailyJobs } from "./lib/scheduler";
import { removeDemoData, loadFullDemo } from "./queries/demo-data";
import { tierRank, EVENT_CHECKIN_OPENS_BEFORE_MS } from "@contracts/constants";

const SCOPE_ENUM = z.enum([
  "membership", "community", "events", "chapters",
  "member_success", "partnerships", "content", "finance", "conduct",
]);
function isFullAdmin(user: { adminScopes?: string | null }): boolean {
  const s = (user.adminScopes ?? "").trim();
  return s === "" || s === "*";
}

const TIER = z.enum(["horizon", "ascent", "vanguard", "zenith"]);
const idInput = z.object({ id: z.number().int().positive() });

/* Activity master — full catalogue of activity kinds and audience scopes.
   Keep the kind list in sync with EVENT_KINDS (contracts/constants). */
const EVENT_KIND = z.enum([
  "spark", "meetup", "circle", "retreat", "summit",
  "conference", "conclave", "roundtable", "workshop", "masterclass",
  "breakfast", "lunch", "dinner", "social", "webinar",
]);
const AUDIENCE = z.enum(["public", "members", "tiers"]);

/* Normalise the audience choice into the stored columns. `tierGate` is kept in
   step (lowest eligible tier) so legacy gate checks still behave sensibly. */
function resolveAudience(audience: "public" | "members" | "tiers", tiers?: string[]) {
  if (audience === "tiers") {
    const valid = (tiers ?? []).filter((t) => ["horizon", "ascent", "vanguard", "zenith"].includes(t));
    const set = valid.length ? valid : ["horizon", "ascent", "vanguard", "zenith"];
    const gate = set.reduce((lo, t) => (tierRank(t) < tierRank(lo) ? t : lo), set[0]) as
      "horizon" | "ascent" | "vanguard" | "zenith";
    return { audience, audienceTiers: set.join(","), tierGate: gate };
  }
  return { audience, audienceTiers: null, tierGate: "horizon" as const };
}

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

  /* ------------------------- email (SMTP) config ------------------------- */
  /* Non-secret status of outbound mail + a full-admin-only test send, so SMTP
     can be verified from the portal after setting the Railway variables. */
  mailStatus: adminQuery.query(({ ctx }) => {
    if (!isFullAdmin(ctx.user as never)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only a full administrator can view email settings." });
    }
    return mailStatus();
  }),

  sendTestEmail: adminQuery
    .input(z.object({ to: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      if (!isFullAdmin(ctx.user as never)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only a full administrator can send a test email." });
      }
      const res = await sendTestEmail(input.to);
      if (!res.ok) throw new TRPCError({ code: "BAD_REQUEST", message: res.error ?? "The test email could not be sent." });
      await audit(ctx.user, "mail.test", { detail: input.to });
      return { ok: true };
    }),

  /* ---------------------- automation scheduler ---------------------- */
  /* Last daily-pass marker + a full-admin manual "run now" so timed jobs can be
     observed and forced without waiting for the next tick. */
  schedulerStatus: adminQuery.query(async () => {
    const row = (await getDb().select().from(schema.appConfig)
      .where(eq(schema.appConfig.key, "scheduler:lastDaily")).limit(1)).at(0);
    return { lastDaily: row?.value ?? null };
  }),

  runScheduler: adminQuery.mutation(async ({ ctx }) => {
    if (!isFullAdmin(ctx.user as never)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only a full administrator can run the scheduler." });
    }
    // Force a run regardless of the daily guard.
    await getDb().delete(schema.appConfig).where(eq(schema.appConfig.key, "scheduler:lastDaily"));
    const ran = await runDailyJobs();
    await audit(ctx.user, "scheduler.run", { detail: ran ? "ran" : "skipped" });
    return { ran };
  }),

  /* ---------------------- remove seeded demo data ---------------------- */
  /* Full-admin only. Deletes ONLY seed-tagged rows (seed accounts, demo
     chapters/hierarchy, demo pods/events) — never real data. Requires an
     explicit confirm string so it can't fire by accident. */
  removeDemoData: adminQuery
    .input(z.object({ confirm: z.literal("REMOVE DEMO DATA") }))
    .mutation(async ({ ctx }) => {
      if (!isFullAdmin(ctx.user as never)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only a full administrator can remove demo data." });
      }
      const removed = await removeDemoData();
      const total = Object.values(removed).reduce((a, b) => a + b, 0);
      await audit(ctx.user, "demo.remove", { detail: `${total} rows: ${JSON.stringify(removed)}` });
      return { removed, total };
    }),

  /* Full-admin only. Generates the complete simulation dataset (hierarchy,
     hundreds of members, officers, leaders, management team). Idempotent. */
  loadFullDemo: adminQuery
    .input(z.object({ confirm: z.literal("LOAD DEMO") }))
    .mutation(async ({ ctx }) => {
      if (!isFullAdmin(ctx.user as never)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only a full administrator can load demo data." });
      }
      const res = await loadFullDemo();
      await audit(ctx.user, "demo.loadFull", { detail: res.loaded ? `${res.members} members, ${res.chapters} chapters` : "already loaded" });
      return res;
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

  setApplicationStatus: scopedAdmin("membership")
    .input(
      z.object({
        id: z.number().int().positive(),
        status: z.enum(["received", "screening", "interview", "approved", "rejected"]),
        note: z.string().max(2000).optional(),
        tier: TIER.optional(),
        chapterId: z.number().int().positive().optional(), // home chapter at admission
      }),
    )
    .mutation(async ({ ctx, input }) => {
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
            homeChapterId: input.chapterId ?? null, // admitted into a chapter
            lifecycleState: "onboarding",           // ML-03: first 30/60/90 days
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
          await audit(ctx.user, "application.approve", { type: "application", id: input.id, detail: `→ member #${memberId} (${tier})` });
          return { ok: true, memberId };
        }
      }
      await audit(ctx.user, `application.${input.status}`, { type: "application", id: input.id });
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
          lifecycle: z.string().max(24).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conds = [];
      if (input?.tier) conds.push(eq(schema.members.tier, input.tier));
      if (input?.status) conds.push(eq(schema.members.status, input.status));
      if (input?.lifecycle) conds.push(eq(schema.members.lifecycleState, input.lifecycle as never));
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

  /* Member Lifecycle CRM board — count of members in each state (M1 / Figure 2). */
  lifecycleCounts: adminQuery.query(async () => {
    const rows = await getDb()
      .select({ state: schema.members.lifecycleState, n: sql<number>`count(*)` })
      .from(schema.members)
      .groupBy(schema.members.lifecycleState);
    return Object.fromEntries(rows.map((r) => [r.state, Number(r.n)]));
  }),

  /* Drive a member along the lifecycle state machine. Every transition is an SOP
     with an owner (the acting admin), a trigger and a notification (ML-01–06). */
  setLifecycleState: scopedAdmin("membership")
    .input(z.object({
      memberId: z.number().int().positive(),
      state: z.enum(["prospect", "guest", "applicant", "onboarding", "active", "at_risk", "renewal", "lapsed", "alumni", "suspended"]),
      note: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const m = await mustMember(input.memberId);
      if (m.lifecycleState === input.state) return { ok: true };
      const patch: Record<string, unknown> = { lifecycleState: input.state };
      // Keep access/billing status coherent with the journey state.
      if (input.state === "active" || input.state === "onboarding" || input.state === "renewal" || input.state === "at_risk") patch.status = "active";
      if (input.state === "suspended") patch.status = "paused";
      if (input.state === "alumni" || input.state === "lapsed") patch.status = "cancelled";
      await db.update(schema.members).set(patch).where(eq(schema.members.id, m.id));
      // ML-04b — a manual at-risk flag opens a tracked Save case; recovery closes it.
      if (input.state === "at_risk" && m.lifecycleState !== "at_risk") {
        const { openSaveCase } = await import("./queries/saves");
        await openSaveCase(m.id, input.note || "Flagged at-risk by an admin.", m.homeChapterId);
      } else if (input.state === "active" && m.lifecycleState === "at_risk") {
        const { autoCloseSaveOnRecovery } = await import("./queries/saves");
        await autoCloseSaveOnRecovery(m.id, "Returned to Active by an admin.");
      }
      // Member-facing notification for the transitions that should reach them.
      const NOTE: Record<string, string> = {
        active: "Welcome to Active membership — you're all set.",
        at_risk: "We've missed you lately — your chapter would love to see you back.",
        renewal: "Your renewal window is open. Here's your year in review.",
        suspended: "Your membership is under review.",
        alumni: "You're now an eHive Alumnus — the door stays open.",
      };
      if (NOTE[input.state]) { try { await notify(m.id, NOTE[input.state], "membership"); } catch { /* non-fatal */ } }
      await audit(ctx.user, "member.lifecycle", { type: "member", id: m.id, detail: `${m.lifecycleState} → ${input.state}${input.note ? ` (${input.note})` : ""}` });
      return { ok: true };
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

  setMemberTier: scopedAdmin("membership")
    .input(z.object({ memberId: z.number().int().positive(), tier: TIER, note: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
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
        status: "approved",
        actorEmail: ctx.user.email,
        decidedAt: new Date(),
      });
      await audit(ctx.user, `member.${type}`, { type: "member", id: m.id, detail: `${m.tier} → ${input.tier}` });
      return { ok: true, type };
    }),

  /* Tier-change requests members have submitted, awaiting management approval. */
  pendingTierRequests: scopedAdmin("membership").query(async () => {
    const db = getDb();
    return db
      .select({
        req: schema.membershipEvents,
        member: schema.members,
        userName: schema.users.name,
        userEmail: schema.users.email,
      })
      .from(schema.membershipEvents)
      .innerJoin(schema.members, eq(schema.members.id, schema.membershipEvents.memberId))
      .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
      .where(eq(schema.membershipEvents.status, "pending"))
      .orderBy(desc(schema.membershipEvents.createdAt))
      .limit(100);
  }),

  /* Approve or reject a member's pending tier change. The member's tier moves
     only on approval — this is the sole path a member-requested change applies. */
  decideTierRequest: scopedAdmin("membership")
    .input(z.object({
      id: z.number().int().positive(),
      decision: z.enum(["approve", "reject"]),
      note: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const req = (await db.select().from(schema.membershipEvents)
        .where(eq(schema.membershipEvents.id, input.id)).limit(1)).at(0);
      if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
      if (req.status !== "pending") throw new TRPCError({ code: "CONFLICT", message: "This request was already decided." });
      const m = await mustMember(req.memberId);

      if (input.decision === "approve") {
        // Guard against a stale request whose starting tier has since changed.
        if (req.toTier && tierRank(req.toTier) !== tierRank(m.tier)) {
          await db.update(schema.members).set({ tier: req.toTier as never }).where(eq(schema.members.id, m.id));
        }
      }
      await db.update(schema.membershipEvents).set({
        status: input.decision === "approve" ? "approved" : "rejected",
        actorEmail: ctx.user.email,
        decidedAt: new Date(),
        note: input.note ?? req.note,
      }).where(eq(schema.membershipEvents.id, req.id));
      await audit(ctx.user, `member.tier_request.${input.decision}`,
        { type: "member", id: m.id, detail: `${req.fromTier ?? m.tier} → ${req.toTier ?? "?"}` });
      return { ok: true };
    }),

  setMemberStatus: scopedAdmin("membership")
    .input(
      z.object({
        memberId: z.number().int().positive(),
        status: z.enum(["active", "paused", "cancelled"]),
        note: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
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
      await audit(ctx.user, "member.status", { type: "member", id: m.id, detail: `status → ${input.status}` });
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
    const health = await computePodHealth(input.id);
    return { pod, roster, sessions: sess, notes, attendance: att, actionItems: items, allMembers, health };
  }),

  /* PD-01 matching engine — ranked pod suggestions for placing a member. */
  suggestPodPlacement: adminQuery.input(idInput).query(async ({ input }) => {
    return suggestPods(input.id);
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
      // Temporal integrity: attendance can't be recorded for a session that
      // hasn't happened yet (opens 2h before it starts).
      if (input.status === "attended") {
        const s = (await db.select().from(schema.sessions).where(eq(schema.sessions.id, input.sessionId)).limit(1)).at(0);
        if (s && Date.now() < new Date(s.startsAt).getTime() - EVENT_CHECKIN_OPENS_BEFORE_MS)
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This session hasn't started — you can't mark attendance yet." });
      }
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
    // Batch the per-event registration counts into one grouped query (was N+1).
    const ids = rows.map((e) => e.id);
    const counts = ids.length
      ? await db
          .select({ eventId: schema.eventRegs.eventId, n: sql<number>`count(*)` })
          .from(schema.eventRegs)
          .where(and(
            sql`${schema.eventRegs.eventId} in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`,
            eq(schema.eventRegs.status, "registered"),
          ))
          .groupBy(schema.eventRegs.eventId)
      : [];
    const countMap = new Map(counts.map((c) => [c.eventId, Number(c.n)]));
    return rows.map((e) => ({ ...e, regCount: countMap.get(e.id) ?? 0 }));
  }),

  createEvent: scopedAdmin("events")
    .input(
      z.object({
        title: z.string().min(2).max(255),
        kind: EVENT_KIND.default("meetup"),
        description: z.string().max(4000).optional(),
        startsAt: z.coerce.date(),
        location: z.string().max(255).optional(),
        audience: AUDIENCE.default("members"),
        audienceTiers: z.array(TIER).optional(),
        capacity: z.number().int().min(1).max(2000).default(40),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { audience, audienceTiers, ...rest } = input;
      const scope = resolveAudience(audience, audienceTiers);
      const res = await getDb().insert(schema.events).values({ ...rest, ...scope });
      const id = Number(res[0].insertId);
      await audit(ctx.user, "event.create", { type: "event", id, detail: `${input.kind} · ${audience}` });
      return { ok: true, id };
    }),

  updateEvent: scopedAdmin("events")
    .input(
      z.object({
        id: z.number().int().positive(),
        title: z.string().min(2).max(255).optional(),
        kind: EVENT_KIND.optional(),
        description: z.string().max(4000).optional(),
        startsAt: z.coerce.date().optional(),
        location: z.string().max(255).optional(),
        audience: AUDIENCE.optional(),
        audienceTiers: z.array(TIER).optional(),
        capacity: z.number().int().min(1).max(2000).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, audience, audienceTiers, ...patch } = input;
      const scope = audience ? resolveAudience(audience, audienceTiers) : {};
      await getDb().update(schema.events).set({ ...patch, ...scope }).where(eq(schema.events.id, id));
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
      // Temporal integrity: attendance can't be recorded before the event runs,
      // even by an admin (opens 2h before it starts). Register/cancel/undo are fine.
      if (input.status === "attended") {
        const ev = (await db.select().from(schema.events).where(eq(schema.events.id, input.eventId)).limit(1)).at(0);
        if (ev && Date.now() < new Date(ev.startsAt).getTime() - EVENT_CHECKIN_OPENS_BEFORE_MS)
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This event hasn't started — attendance can't be marked until it begins." });
      }
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
    .input(z.object({
      q: z.string().max(120).optional(),
      status: z.enum(["new", "contacted", "qualified", "won", "lost"]).optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const conds = [];
      if (input?.q) {
        const q = `%${input.q}%`;
        conds.push(or(like(schema.leads.email, q), like(schema.leads.form, q)));
      }
      if (input?.status) conds.push(eq(schema.leads.status, input.status));
      const owner = alias(schema.users, "lead_owner");
      const rows = await db
        .select({ lead: schema.leads, ownerName: owner.name, ownerEmail: owner.email })
        .from(schema.leads)
        .leftJoin(owner, eq(owner.id, schema.leads.ownerUserId))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(schema.leads.createdAt))
        .limit(200);
      return rows.map((r) => ({ ...r.lead, ownerName: r.ownerName, ownerEmail: r.ownerEmail }));
    }),

  /* Lead pipeline counts for the status tabs. */
  leadCounts: adminQuery.query(async () => {
    const rows = await getDb()
      .select({ status: schema.leads.status, n: sql<number>`count(*)` })
      .from(schema.leads).groupBy(schema.leads.status);
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  }),

  /* Update a lead's CRM fields (status / owner / notes). */
  updateLead: adminQuery
    .input(z.object({
      id: z.number().int().positive(),
      status: z.enum(["new", "contacted", "qualified", "won", "lost"]).optional(),
      ownerUserId: z.number().int().positive().nullable().optional(),
      notes: z.string().max(5000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const set: Record<string, unknown> = {};
      if (input.status !== undefined) set.status = input.status;
      if (input.ownerUserId !== undefined) set.ownerUserId = input.ownerUserId;
      if (input.notes !== undefined) set.notes = input.notes;
      if (!Object.keys(set).length) return { ok: true };
      await getDb().update(schema.leads).set(set).where(eq(schema.leads.id, input.id));
      await audit(ctx.user, "lead.update", { type: "lead", id: input.id,
        detail: input.status ? `status → ${input.status}` : "updated" });
      return { ok: true };
    }),

  /* -------------------- admin audit trail + access control ----------------- */
  auditTrail: adminQuery
    .input(z.object({ limit: z.number().min(1).max(500).default(200) }).optional())
    .query(async ({ input }) => {
      return getDb().select().from(schema.adminAuditLog)
        .orderBy(desc(schema.adminAuditLog.createdAt)).limit(input?.limit ?? 200);
    }),

  /* List admins + their capability scopes (management view). */
  adminRoster: adminQuery.query(async () => {
    return getDb()
      .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email,
                role: schema.users.role, adminScopes: schema.users.adminScopes })
      .from(schema.users)
      .where(eq(schema.users.role, "admin"))
      .orderBy(schema.users.email);
  }),

  /* Grant/adjust an admin's role and capability scopes. Only a FULL admin
     (owner "*" or legacy "") may manage access — segregation of duties. */
  setAdminAccess: adminQuery
    .input(z.object({
      userId: z.number().int().positive(),
      makeAdmin: z.boolean(),
      scopes: z.array(SCOPE_ENUM).default([]),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!isFullAdmin(ctx.user as never)) throw new TRPCError({ code: "FORBIDDEN", message: "Only a full administrator can manage admin access." });
      if (input.userId === ctx.user.id && !input.makeAdmin) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You can't remove your own admin access." });
      }
      const db = getDb();
      const target = (await db.select().from(schema.users).where(eq(schema.users.id, input.userId)).limit(1)).at(0);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      // Never demote the platform owner or strip their full scope.
      const isOwner = target.adminScopes === "*";
      await db.update(schema.users)
        .set({
          role: input.makeAdmin ? "admin" : "user",
          adminScopes: isOwner ? "*" : (input.makeAdmin ? input.scopes.join(",") : ""),
        })
        .where(eq(schema.users.id, input.userId));
      await audit(ctx.user, "admin.access", { type: "user", id: input.userId,
        detail: input.makeAdmin ? `admin [${input.scopes.join(",") || "full"}]` : "revoked" });
      return { ok: true };
    }),

  /* Grant admin access to an existing account by email (onboard a staff member). */
  grantAdminByEmail: adminQuery
    .input(z.object({ email: z.string().email(), scopes: z.array(SCOPE_ENUM).default([]) }))
    .mutation(async ({ ctx, input }) => {
      if (!isFullAdmin(ctx.user as never)) throw new TRPCError({ code: "FORBIDDEN", message: "Only a full administrator can grant access." });
      const user = await findUserByEmail(input.email);
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "No account with that email. Ask them to register first, then grant access." });
      await getDb().update(schema.users)
        .set({ role: "admin", adminScopes: input.scopes.join(",") })
        .where(eq(schema.users.id, user.id));
      await audit(ctx.user, "admin.grant", { type: "user", id: user.id, detail: `${user.email} [${input.scopes.join(",") || "full"}]` });
      return { ok: true, name: user.name ?? user.email };
    }),
});
