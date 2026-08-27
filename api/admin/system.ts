import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, isNull, like, lte, or, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import { createRouter, adminQuery, fullAdmin, hasScope } from "../middleware";
import { audit, maskEmail } from "../lib/audit";
import { mailStatus, sendTestEmail } from "../lib/mailer";
import { env } from "../lib/env";
import { runDailyJobs } from "../lib/scheduler";
import { removeDemoData, loadFullDemo } from "../queries/demo-data";
import { opsOverview } from "../queries/ops";
import { captureKpiSnapshots, kpiTrends } from "../queries/kpi-snapshots";
import {
  evaluateKpiAlerts,
  listKpiAlerts,
  acknowledgeKpiAlert,
} from "../queries/kpi-alerts";
import { networkKpis } from "../queries/reports";
import { findUserByEmail } from "../queries/users";
import { funnelCounts } from "../queries/analytics";
import { SCOPE_ENUM, isFullAdmin } from "./shared";

/* Shared filter for the audit trail: actor-email + action substrings and a date
   range, reused by the on-screen view and the CSV export. */
const auditFilterInput = z
  .object({
    limit: z.number().min(1).max(1000).optional(),
    actor: z.string().max(320).optional(),
    action: z.string().max(64).optional(),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
  })
  .optional();

function auditWhere(input?: {
  actor?: string;
  action?: string;
  from?: string;
  to?: string;
}) {
  const conds = [];
  if (input?.actor)
    conds.push(like(schema.adminAuditLog.actorEmail, `%${input.actor}%`));
  if (input?.action)
    conds.push(like(schema.adminAuditLog.action, `%${input.action}%`));
  if (input?.from)
    conds.push(
      gte(schema.adminAuditLog.createdAt, new Date(input.from + "T00:00:00Z"))
    );
  if (input?.to)
    conds.push(
      lte(schema.adminAuditLog.createdAt, new Date(input.to + "T23:59:59Z"))
    );
  return conds.length ? and(...conds) : undefined;
}

export const systemRouter = createRouter({
  stats: adminQuery.query(async ({ ctx }) => {
    const db = getDb();
    const canApps = hasScope(ctx.user as never, "membership");
    const canLeads = hasScope(ctx.user as never, "finance");
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
          eq(schema.applications.status, "interview")
        )
      );
    const [act] = await db
      .select({
        n: sql<number>`count(*)`,
        avg: sql<number>`coalesce(avg(hiveScore),0)`,
      })
      .from(schema.members)
      .where(eq(schema.members.status, "active"));
    const [upEv] = await db
      .select({ n: sql<number>`count(*)` })
      .from(schema.events)
      .where(
        and(
          sql`${schema.events.startsAt} >= now()`,
          isNull(schema.events.deletedAt)
        )
      );
    const [leadCount] = await db
      .select({ n: sql<number>`count(*)` })
      .from(schema.leads);
    // Cross-domain previews are only returned to admins who hold the relevant
    // capability — a scoped head never receives another team's data.
    const recentApps = canApps
      ? await db
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
          .limit(6)
      : [];
    const recentLeads = canLeads
      ? await db
          .select()
          .from(schema.leads)
          .orderBy(desc(schema.leads.createdAt))
          .limit(6)
      : [];
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
  mailStatus: fullAdmin.query(({ ctx }) => {
    if (!isFullAdmin(ctx.user as never)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only a full administrator can view email settings.",
      });
    }
    return mailStatus();
  }),

  sendTestEmail: fullAdmin
    .input(z.object({ to: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      if (!isFullAdmin(ctx.user as never)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only a full administrator can send a test email.",
        });
      }
      const res = await sendTestEmail(input.to);
      if (!res.ok)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: res.error ?? "The test email could not be sent.",
        });
      await audit(ctx.user, "mail.test", { detail: maskEmail(input.to) });
      return { ok: true };
    }),

  /* ---------------------- automation scheduler ---------------------- */
  /* Last daily-pass marker + a full-admin manual "run now" so timed jobs can be
     observed and forced without waiting for the next tick. */
  schedulerStatus: fullAdmin.query(async () => {
    const row = (
      await getDb()
        .select()
        .from(schema.appConfig)
        .where(eq(schema.appConfig.key, "scheduler:lastDaily"))
        .limit(1)
    ).at(0);
    return { lastDaily: row?.value ?? null };
  }),

  runScheduler: fullAdmin.mutation(async ({ ctx }) => {
    if (!isFullAdmin(ctx.user as never)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only a full administrator can run the scheduler.",
      });
    }
    // Force a run regardless of the daily guard.
    await getDb()
      .delete(schema.appConfig)
      .where(eq(schema.appConfig.key, "scheduler:lastDaily"));
    const ran = await runDailyJobs();
    await audit(ctx.user, "scheduler.run", { detail: ran ? "ran" : "skipped" });
    return { ran };
  }),

  /* ---------------------- remove seeded demo data ---------------------- */
  /* Full-admin only. Deletes ONLY seed-tagged rows (seed accounts, demo
     chapters/hierarchy, demo pods/events) — never real data. Requires an
     explicit confirm string so it can't fire by accident. */
  removeDemoData: fullAdmin
    .input(z.object({ confirm: z.literal("REMOVE DEMO DATA") }))
    .mutation(async ({ ctx }) => {
      if (!isFullAdmin(ctx.user as never)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only a full administrator can remove demo data.",
        });
      }
      if (env.isProduction) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Demo data operations are disabled in production.",
        });
      }
      const removed = await removeDemoData();
      const total = Object.values(removed).reduce((a, b) => a + b, 0);
      await audit(ctx.user, "demo.remove", {
        detail: `${total} rows: ${JSON.stringify(removed)}`,
      });
      return { removed, total };
    }),

  /* Full-admin only. Generates the complete simulation dataset (hierarchy,
     hundreds of members, officers, leaders, management team). Idempotent. */
  loadFullDemo: fullAdmin
    .input(z.object({ confirm: z.literal("LOAD DEMO") }))
    .mutation(async ({ ctx }) => {
      if (!isFullAdmin(ctx.user as never)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only a full administrator can load demo data.",
        });
      }
      if (env.isProduction) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Demo data operations are disabled in production.",
        });
      }
      const res = await loadFullDemo();
      await audit(ctx.user, "demo.loadFull", {
        detail: res.loaded
          ? `${res.members} members, ${res.chapters} chapters`
          : "already loaded",
      });
      return res;
    }),

  /* ---------------------------- applications ----------------------------- */
  opsOverview: fullAdmin.query(() => opsOverview()),

  /* ---------------- KPI snapshots / trends ---------------- */
  kpiTrends: fullAdmin.query(() => kpiTrends()),
  captureKpiSnapshots: fullAdmin.mutation(async ({ ctx }) => {
    const r = await captureKpiSnapshots();
    await audit(ctx.user, "kpi.snapshot", { detail: `${r.captured} metrics` });
    return r;
  }),

  /* ---------------- KPI threshold alerts ---------------- */
  kpiAlerts: fullAdmin.query(() => listKpiAlerts()),
  evaluateKpiAlerts: fullAdmin.mutation(async ({ ctx }) => {
    const r = await evaluateKpiAlerts();
    await audit(ctx.user, "kpi.alerts.evaluate", {
      detail: `${r.opened} opened, ${r.resolved} resolved`,
    });
    return r;
  }),
  acknowledgeKpiAlert: fullAdmin
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const r = await acknowledgeKpiAlert(ctx.user, input.id);
      await audit(ctx.user, "kpi.alert.ack", {
        type: "kpiAlert",
        id: input.id,
        detail: "acknowledged",
      });
      return r;
    }),

  /* ---------------- Conversion funnel (analytics event stream) ---------------- */
  funnelCounts: fullAdmin
    .input(
      z
        .object({
          from: z.string().date().optional(),
          to: z.string().date().optional(),
        })
        .optional()
    )
    .query(({ input }) =>
      funnelCounts({
        from: input?.from ? new Date(input.from + "T00:00:00Z") : undefined,
        to: input?.to ? new Date(input.to + "T23:59:59Z") : undefined,
      })
    ),

  /* ---------------- Reports & KPIs — role-scoped drill-down ----------------
     The network/board scorecard stays full-admin; each domain report is gated to
     the capability that owns it, so a department head sees their own scorecard. */
  reportsNetworkKpis: fullAdmin.query(() => networkKpis()),
  auditTrail: fullAdmin.input(auditFilterInput).query(({ input }) =>
    getDb()
      .select()
      .from(schema.adminAuditLog)
      .where(auditWhere(input))
      .orderBy(desc(schema.adminAuditLog.createdAt))
      .limit(input?.limit ?? 300)
  ),

  auditTrailCsv: fullAdmin.input(auditFilterInput).query(async ({ input }) => {
    const rows = await getDb()
      .select()
      .from(schema.adminAuditLog)
      .where(auditWhere(input))
      .orderBy(desc(schema.adminAuditLog.createdAt))
      .limit(10000);
    const cell = (v: unknown) => {
      const s =
        v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const headers = [
      "when",
      "actorEmail",
      "action",
      "targetType",
      "targetId",
      "detail",
    ];
    const lines = [
      headers.join(","),
      ...rows.map(r =>
        [
          r.createdAt,
          r.actorEmail,
          r.action,
          r.targetType,
          r.targetId,
          r.detail,
        ]
          .map(cell)
          .join(",")
      ),
    ];
    return {
      filename: `ehive-audit-${new Date().toISOString().slice(0, 10)}.csv`,
      csv: lines.join("\n") + "\n",
    };
  }),

  /* List admins + their capability scopes (management view). */
  adminRoster: adminQuery.query(async () => {
    return getDb()
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        role: schema.users.role,
        adminScopes: schema.users.adminScopes,
      })
      .from(schema.users)
      .where(eq(schema.users.role, "admin"))
      .orderBy(schema.users.email);
  }),

  /* Grant/adjust an admin's role and capability scopes. Only a FULL admin
     (owner "*" or legacy "") may manage access — segregation of duties. */
  setAdminAccess: adminQuery
    .input(
      z.object({
        userId: z.number().int().positive(),
        makeAdmin: z.boolean(),
        scopes: z.array(SCOPE_ENUM).default([]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!isFullAdmin(ctx.user))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only a full administrator can manage admin access.",
        });
      if (input.userId === ctx.user.id && !input.makeAdmin) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You can't remove your own admin access.",
        });
      }
      const db = getDb();
      const target = (
        await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.id, input.userId))
          .limit(1)
      ).at(0);
      if (!target)
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

      // Determine owner by the deployment-controlled email, not just the current
      // scope value, so the owner can never be demoted.
      const ownerEmail = env.ownerEmail.trim().toLowerCase();
      const isOwner =
        !!ownerEmail && (target.email ?? "").toLowerCase() === ownerEmail;
      const targetWasFullAdmin = isFullAdmin(target);
      const newScopes = isOwner
        ? "*"
        : input.makeAdmin
          ? input.scopes.join(",")
          : "";
      const targetStillFullAdmin = isFullAdmin({
        role: input.makeAdmin ? "admin" : "user",
        adminScopes: newScopes,
      });

      // Prevent self-demotion from full admin to scoped admin.
      if (input.userId === ctx.user.id && targetWasFullAdmin && !targetStillFullAdmin) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You can't remove your own full administrator access.",
        });
      }

      // Never leave the platform without at least one full administrator.
      if (targetWasFullAdmin && !targetStillFullAdmin) {
        const fullAdmins = await db
          .select({ id: schema.users.id, adminScopes: schema.users.adminScopes })
          .from(schema.users)
          .where(eq(schema.users.role, "admin"));
        const otherFullAdmins = fullAdmins.filter(u => u.id !== input.userId && isFullAdmin({ role: "admin", adminScopes: u.adminScopes }));
        if (otherFullAdmins.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot remove the last full administrator.",
          });
        }
      }

      await db
        .update(schema.users)
        .set({
          role: input.makeAdmin ? "admin" : "user",
          adminScopes: newScopes,
        })
        .where(eq(schema.users.id, input.userId));
      await audit(ctx.user, "admin.access", {
        type: "user",
        id: input.userId,
        detail: input.makeAdmin
          ? `admin [${input.scopes.join(",") || "full"}]`
          : "revoked",
      });
      return { ok: true };
    }),

  /* Grant admin access to an existing account by email (onboard a staff member). */
  grantAdminByEmail: adminQuery
    .input(
      z.object({
        email: z.string().email(),
        scopes: z.array(SCOPE_ENUM).default([]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!isFullAdmin(ctx.user as never))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only a full administrator can grant access.",
        });
      const user = await findUserByEmail(input.email);
      if (!user)
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "No account with that email. Ask them to register first, then grant access.",
        });
      await getDb()
        .update(schema.users)
        .set({ role: "admin", adminScopes: input.scopes.join(",") })
        .where(eq(schema.users.id, user.id));
      await audit(ctx.user, "admin.grant", {
        type: "user",
        id: user.id,
        detail: `${maskEmail(user.email ?? "")} [${input.scopes.join(",") || "full"}]`,
      });
      return { ok: true, name: user.name ?? user.email };
    }),
});
