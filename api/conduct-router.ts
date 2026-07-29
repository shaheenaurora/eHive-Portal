import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { createRouter, authedQuery, scopedAdmin } from "./middleware";
import { getMemberByUserId, notify } from "./queries/circle";
import { audit } from "./lib/audit";
import { CONDUCT_SEVERITIES, CONDUCT_STATUSES } from "@contracts/constants";

const SEVERITY = z.enum(CONDUCT_SEVERITIES);
const STATUS = z.enum(CONDUCT_STATUSES);
const conductAdmin = scopedAdmin("conduct");

/** Attach reporter/subject display names to a case row for the admin views. */
async function withNames(rows: schema.ConductCase[]) {
  const db = getDb();
  const ids = new Set<number>();
  for (const c of rows) { if (c.reporterMemberId) ids.add(c.reporterMemberId); if (c.subjectMemberId) ids.add(c.subjectMemberId); }
  const names = new Map<number, string>();
  if (ids.size) {
    const people = await db
      .select({ id: schema.members.id, name: schema.users.name, email: schema.users.email })
      .from(schema.members)
      .innerJoin(schema.users, eq(schema.members.userId, schema.users.id));
    for (const p of people) if (ids.has(p.id)) names.set(p.id, p.name ?? p.email ?? `Member #${p.id}`);
  }
  return rows.map((c) => ({
    ...c,
    reporterName: c.reporterMemberId ? (names.get(c.reporterMemberId) ?? `Member #${c.reporterMemberId}`) : "Anonymous",
    subjectName: c.subjectMemberId ? (names.get(c.subjectMemberId) ?? `Member #${c.subjectMemberId}`) : null,
  }));
}

export const conductRouter = createRouter({
  /* ---- member: raise a confidential report (XC-04) ---- */
  report: authedQuery
    .input(z.object({
      category: z.string().min(1).max(64),
      severity: SEVERITY.optional(),
      summary: z.string().min(3).max(255),
      detail: z.string().max(5000).optional(),
      subjectMemberId: z.number().int().positive().optional(),
      anonymous: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const me = await getMemberByUserId(ctx.user.id);
      const reporterMemberId = input.anonymous ? null : (me?.id ?? null);
      await db.insert(schema.conductCases).values({
        reporterMemberId,
        subjectMemberId: input.subjectMemberId ?? null,
        chapterId: me?.homeChapterId ?? null,
        category: input.category,
        severity: input.severity ?? "moderate",
        summary: input.summary,
        detail: input.detail ?? null,
      });
      return { ok: true };
    }),

  /* ---- member: my own (non-anonymous) reports ---- */
  myReports: authedQuery.query(async ({ ctx }) => {
    const me = await getMemberByUserId(ctx.user.id);
    if (!me) return [];
    return getDb().select({
      id: schema.conductCases.id, summary: schema.conductCases.summary,
      status: schema.conductCases.status, severity: schema.conductCases.severity,
      createdAt: schema.conductCases.createdAt,
    }).from(schema.conductCases)
      .where(eq(schema.conductCases.reporterMemberId, me.id))
      .orderBy(desc(schema.conductCases.createdAt));
  }),

  /* ---- admin (conduct scope): case queue ---- */
  cases: conductAdmin
    .input(z.object({ status: STATUS.optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const rows = input?.status
        ? await db.select().from(schema.conductCases).where(eq(schema.conductCases.status, input.status)).orderBy(desc(schema.conductCases.createdAt))
        : await db.select().from(schema.conductCases).orderBy(desc(schema.conductCases.createdAt));
      return withNames(rows);
    }),

  caseDetail: conductAdmin
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const row = (await getDb().select().from(schema.conductCases).where(eq(schema.conductCases.id, input.id)).limit(1)).at(0);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
      return (await withNames([row]))[0];
    }),

  updateCase: conductAdmin
    .input(z.object({
      id: z.number().int().positive(),
      status: STATUS.optional(),
      severity: SEVERITY.optional(),
      resolution: z.string().max(5000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const patch: Partial<typeof schema.conductCases.$inferInsert> = { handledByUserId: ctx.user.id };
      if (input.status) patch.status = input.status;
      if (input.severity) patch.severity = input.severity;
      if (input.resolution !== undefined) patch.resolution = input.resolution;
      await getDb().update(schema.conductCases).set(patch).where(eq(schema.conductCases.id, input.id));
      await audit(ctx.user, "conduct.update", { type: "conduct_case", id: input.id, detail: input.status });
      return { ok: true };
    }),

  /* ---- admin (conduct scope): act on the subject member (lifecycle) ---- */
  actionMember: conductAdmin
    .input(z.object({
      caseId: z.number().int().positive(),
      memberId: z.number().int().positive(),
      action: z.enum(["suspend", "reinstate", "remove"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const m = (await db.select().from(schema.members).where(eq(schema.members.id, input.memberId)).limit(1)).at(0);
      if (!m) throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
      const next = input.action === "suspend" ? "suspended" : input.action === "reinstate" ? "active" : "alumni";
      const status = input.action === "remove" ? "cancelled" : m.status;
      await db.update(schema.members).set({ lifecycleState: next, status }).where(eq(schema.members.id, input.memberId));
      // Record on the case + confidential member notice.
      await db.update(schema.conductCases)
        .set({ status: input.action === "reinstate" ? "closed" : "actioned", handledByUserId: ctx.user.id })
        .where(eq(schema.conductCases.id, input.caseId));
      const note = input.action === "suspend"
        ? "Your membership has been suspended pending a conduct review. The Circle team will be in touch."
        : input.action === "reinstate"
        ? "Your membership has been reinstated following a conduct review."
        : "Your membership has been ended following a conduct process.";
      await notify(input.memberId, note, "conduct");
      await audit(ctx.user, `conduct.${input.action}`, { type: "member", id: input.memberId, detail: `case #${input.caseId}` });
      return { ok: true, lifecycleState: next };
    }),

  /* ---- admin: open-case count for the nav badge ---- */
  openCount: conductAdmin.query(async () => {
    const rows = await getDb().select({ status: schema.conductCases.status }).from(schema.conductCases);
    return rows.filter((r) => r.status === "open" || r.status === "escalated").length;
  }),
});
