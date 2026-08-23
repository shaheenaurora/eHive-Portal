import { z } from "zod";
import { and, desc, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import { createRouter, scopedAdmin } from "../middleware";
import {
  financeSummary,
  financeReport,
  financeReportCsvString,
  listPayments,
  paymentReceipt,
  recordManualPayment,
  refundPayment,
  renewalsDue,
  budgetRollup,
  payableMembers,
  listExpenses,
  recordExpense,
  expenseReceipt,
  chapterIdsForUnit,
  memberChapterForUser,
} from "../queries/finance";
import {
  listInvoices,
  listCreditNotes,
  getInvoiceById,
  getCreditNoteById,
} from "../queries/invoicing";
import { TRPCError } from "@trpc/server";
import { renewalsReport } from "../queries/reports";
import { listRates, setRate, clearRate } from "../queries/fx";
import { audit } from "../lib/audit";
import { EXPENSE_CATEGORY_KEYS, CURRENCY_CODES } from "@contracts/constants";
import { idInput, isFullAdmin } from "./shared";

/** Optional {from,to} ISO-date range + scoping filters for the finance report. */
const reportRangeInput = z
  .object({
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    chapterId: z.number().int().positive().optional(),
    unitId: z.number().int().positive().optional(),
  })
  .optional();

type ReportRangeInput = z.infer<typeof reportRangeInput>;

/** Turn {from,to} ISO dates into a Date range; `to` is inclusive (end of day). */
function parseReportRange(input?: ReportRangeInput) {
  if (!input) return undefined;
  return {
    from: input.from ? new Date(input.from + "T00:00:00.000Z") : null,
    to: input.to ? new Date(input.to + "T23:59:59.999Z") : null,
  };
}

type ResolvedFinanceScope = {
  chapterIds: number[];
  unitIds: number[];
  isFull: boolean;
};

async function resolveFinanceScope(user: {
  id: number;
  adminScopes: string;
}): Promise<ResolvedFinanceScope> {
  if (isFullAdmin(user as never)) {
    return { chapterIds: [], unitIds: [], isFull: true };
  }
  const db = getDb();
  const member = (
    await db
      .select({
        id: schema.members.id,
        homeChapterId: schema.members.homeChapterId,
      })
      .from(schema.members)
      .where(eq(schema.members.userId, user.id))
      .limit(1)
  ).at(0);
  const chapterIds = new Set<number>();
  if (member?.homeChapterId) chapterIds.add(member.homeChapterId);
  const unitIds: number[] = [];
  if (member) {
    const [chRoles, uRoles] = await Promise.all([
      db
        .select({ chapterId: schema.chapterRoles.chapterId })
        .from(schema.chapterRoles)
        .where(
          and(
            eq(schema.chapterRoles.memberId, member.id),
            eq(schema.chapterRoles.status, "active")
          )
        ),
      db
        .select({ unitId: schema.unitRoles.unitId })
        .from(schema.unitRoles)
        .where(eq(schema.unitRoles.memberId, member.id)),
    ]);
    for (const r of chRoles) chapterIds.add(r.chapterId);
    for (const r of uRoles) unitIds.push(r.unitId);
    const unitChapterIds = await Promise.all(unitIds.map(chapterIdsForUnit));
    for (const ids of unitChapterIds)
      for (const cid of ids) chapterIds.add(cid);
  }
  return { chapterIds: [...chapterIds], unitIds, isFull: false };
}

function scopeError(message = "You don't have access to that finance scope.") {
  return new TRPCError({ code: "FORBIDDEN", message });
}

function assertScopeChapter(chapterId: number, scope: ResolvedFinanceScope) {
  if (!scope.isFull && !scope.chapterIds.includes(chapterId))
    throw scopeError();
}

function assertScopeUnit(unitId: number, scope: ResolvedFinanceScope) {
  if (!scope.isFull && !scope.unitIds.includes(unitId)) throw scopeError();
}

function buildReportFilters(
  input: ReportRangeInput | undefined,
  scope: ResolvedFinanceScope
) {
  if (scope.isFull) {
    if (!input?.chapterId && !input?.unitId) return undefined;
    if (input.unitId) return { unitId: input.unitId };
    return { chapterIds: [input!.chapterId!] };
  }
  if (input?.unitId) {
    assertScopeUnit(input.unitId, scope);
    return { unitId: input.unitId };
  }
  if (input?.chapterId) {
    assertScopeChapter(input.chapterId, scope);
    return { chapterIds: [input.chapterId] };
  }
  if (!scope.chapterIds.length) return { chapterIds: [-1] };
  return { chapterIds: scope.chapterIds };
}

async function assertUserInScope(
  userId: number,
  scope: ResolvedFinanceScope,
  label = "member"
) {
  if (scope.isFull) return;
  const chapterId = await memberChapterForUser(userId);
  if (chapterId == null || !scope.chapterIds.includes(chapterId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `That ${label} isn't in your finance scope.`,
    });
  }
}

async function assertPaymentInScope(
  paymentId: number,
  scope: ResolvedFinanceScope
) {
  if (scope.isFull) return;
  const p = (
    await getDb()
      .select({ userId: schema.paymentRecords.userId })
      .from(schema.paymentRecords)
      .where(eq(schema.paymentRecords.id, paymentId))
      .limit(1)
  ).at(0);
  if (!p)
    throw new TRPCError({ code: "NOT_FOUND", message: "Payment not found." });
  await assertUserInScope(p.userId, scope, "payment");
}

export const financeRouter = createRouter({
  leads: scopedAdmin("finance")
    .input(
      z
        .object({
          q: z.string().max(120).optional(),
          status: z
            .enum(["new", "contacted", "qualified", "won", "lost"])
            .optional(),
        })
        .optional()
    )
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
        .select({
          lead: schema.leads,
          ownerName: owner.name,
          ownerEmail: owner.email,
        })
        .from(schema.leads)
        .leftJoin(owner, eq(owner.id, schema.leads.ownerUserId))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(schema.leads.createdAt))
        .limit(200);
      return rows.map(r => ({
        ...r.lead,
        ownerName: r.ownerName,
        ownerEmail: r.ownerEmail,
      }));
    }),

  /* Lead pipeline counts for the status tabs. */
  leadCounts: scopedAdmin("finance").query(async () => {
    const rows = await getDb()
      .select({ status: schema.leads.status, n: sql<number>`count(*)` })
      .from(schema.leads)
      .groupBy(schema.leads.status);
    return Object.fromEntries(rows.map(r => [r.status, Number(r.n)]));
  }),

  /* Update a lead's CRM fields (status / owner / notes). */
  updateLead: scopedAdmin("finance")
    .input(
      z.object({
        id: z.number().int().positive(),
        status: z
          .enum(["new", "contacted", "qualified", "won", "lost"])
          .optional(),
        ownerUserId: z.number().int().positive().nullable().optional(),
        notes: z.string().max(5000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const set: Record<string, unknown> = {};
      if (input.status !== undefined) set.status = input.status;
      if (input.ownerUserId !== undefined) set.ownerUserId = input.ownerUserId;
      if (input.notes !== undefined) set.notes = input.notes;
      if (!Object.keys(set).length) return { ok: true };
      await getDb()
        .update(schema.leads)
        .set(set)
        .where(eq(schema.leads.id, input.id));
      await audit(ctx.user, "lead.update", {
        type: "lead",
        id: input.id,
        detail: input.status ? `status → ${input.status}` : "updated",
      });
      return { ok: true };
    }),

  /* ------------------------------- Finance ------------------------------- */
  financeSummary: scopedAdmin("finance").query(async ({ ctx }) => {
    const scope = await resolveFinanceScope(ctx.user);
    return financeSummary(
      scope.isFull ? undefined : { chapterIds: scope.chapterIds }
    );
  }),

  financeReport: scopedAdmin("finance")
    .input(reportRangeInput)
    .query(async ({ ctx, input }) => {
      const scope = await resolveFinanceScope(ctx.user);
      return financeReport(
        parseReportRange(input),
        buildReportFilters(input, scope)
      );
    }),

  financeReportCsv: scopedAdmin("finance")
    .input(reportRangeInput)
    .query(async ({ ctx, input }) => {
      const scope = await resolveFinanceScope(ctx.user);
      return financeReportCsvString(
        parseReportRange(input),
        buildReportFilters(input, scope)
      );
    }),

  payments: scopedAdmin("finance")
    .input(
      z
        .object({
          status: z
            .enum([
              "pending",
              "paid",
              "failed",
              "refunded",
              "partially_refunded",
            ])
            .optional(),
          q: z.string().max(120).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const scope = await resolveFinanceScope(ctx.user);
      return listPayments({
        status: input?.status,
        q: input?.q,
        scope: scope.isFull ? undefined : { chapterIds: scope.chapterIds },
      });
    }),

  paymentReceipt: scopedAdmin("finance")
    .input(idInput)
    .query(async ({ ctx, input }) => {
      const scope = await resolveFinanceScope(ctx.user);
      return paymentReceipt(
        input.id,
        scope.isFull ? undefined : { chapterIds: scope.chapterIds }
      );
    }),

  renewalsDue: scopedAdmin("finance")
    .input(
      z
        .object({ withinDays: z.number().int().min(1).max(120).optional() })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const scope = await resolveFinanceScope(ctx.user);
      return renewalsDue(
        input?.withinDays ?? 30,
        scope.isFull ? undefined : { chapterIds: scope.chapterIds }
      );
    }),

  budgetRollup: scopedAdmin("finance").query(async ({ ctx }) => {
    const scope = await resolveFinanceScope(ctx.user);
    return budgetRollup(
      scope.isFull ? undefined : { chapterIds: scope.chapterIds }
    );
  }),

  payableMembers: scopedAdmin("finance")
    .input(z.object({ q: z.string().max(120).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const scope = await resolveFinanceScope(ctx.user);
      return payableMembers(
        input?.q,
        scope.isFull ? undefined : { chapterIds: scope.chapterIds }
      );
    }),

  recordManualPayment: scopedAdmin("finance")
    .input(
      z.object({
        userId: z.number().int().positive(),
        purpose: z.enum([
          "membership",
          "renewal",
          "event",
          "donation",
          "other",
        ]),
        tier: z
          .enum(["horizon", "ascent", "vanguard", "zenith"])
          .nullable()
          .optional(),
        amount: z.number().positive().max(1_000_000),
        note: z.string().max(500).optional(),
        extendRenewal: z.boolean().optional(),
        currency: z.enum(CURRENCY_CODES as [string, ...string[]]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await resolveFinanceScope(ctx.user);
      await assertUserInScope(input.userId, scope, "payer");
      return recordManualPayment(ctx.user, input);
    }),

  /* ---- multi-currency FX rates (admin-maintained) ---- */
  currencyRates: scopedAdmin("finance").query(() => listRates()),
  setCurrencyRate: scopedAdmin("finance")
    .input(z.object({ code: z.string().min(2).max(8), rate: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!isFullAdmin(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only a full administrator can set FX rates.",
        });
      }
      try {
        const r = await setRate(ctx.user, input.code.toLowerCase(), input.rate);
        await audit(ctx.user, "finance.fx.set", {
          type: "fxRate",
          id: input.code.toLowerCase(),
          detail: `rate=${input.rate}`,
        });
        return r;
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Invalid rate.",
        });
      }
    }),
  clearCurrencyRate: scopedAdmin("finance")
    .input(z.object({ code: z.string().min(2).max(8) }))
    .mutation(async ({ ctx, input }) => {
      if (!isFullAdmin(ctx.user)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only a full administrator can clear FX rates.",
        });
      }
      const r = await clearRate(ctx.user, input.code.toLowerCase());
      await audit(ctx.user, "finance.fx.clear", {
        type: "fxRate",
        id: input.code.toLowerCase(),
      });
      return r;
    }),

  refundPayment: scopedAdmin("finance")
    .input(
      z.object({
        id: z.number().int().positive(),
        reason: z.string().min(2).max(500),
        // Omit for a full refund; provide a smaller AED amount for a partial one.
        amountAed: z.number().positive().max(1_000_000).optional(),
        // Full administrators may refund a charge past the refund window.
        overrideWindow: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await resolveFinanceScope(ctx.user);
      await assertPaymentInScope(input.id, scope);
      return refundPayment(
        ctx.user,
        input.id,
        input.reason,
        input.amountAed,
        input.overrideWindow === true && isFullAdmin(ctx.user as never)
      );
    }),

  invoices: scopedAdmin("finance")
    .input(
      z
        .object({
          status: z.enum(["open", "paid", "void"]).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const scope = await resolveFinanceScope(ctx.user);
      return listInvoices({
        status: input?.status,
        scope: scope.isFull ? undefined : { chapterIds: scope.chapterIds },
      });
    }),

  invoiceById: scopedAdmin("finance")
    .input(idInput)
    .query(async ({ ctx, input }) => {
      const scope = await resolveFinanceScope(ctx.user);
      return getInvoiceById(
        input.id,
        scope.isFull ? undefined : { chapterIds: scope.chapterIds }
      );
    }),

  creditNotes: scopedAdmin("finance").query(async ({ ctx }) => {
    const scope = await resolveFinanceScope(ctx.user);
    return listCreditNotes({
      scope: scope.isFull ? undefined : { chapterIds: scope.chapterIds },
    });
  }),

  creditNoteById: scopedAdmin("finance")
    .input(idInput)
    .query(async ({ ctx, input }) => {
      const scope = await resolveFinanceScope(ctx.user);
      return getCreditNoteById(
        input.id,
        scope.isFull ? undefined : { chapterIds: scope.chapterIds }
      );
    }),

  expenses: scopedAdmin("finance")
    .input(
      z.object({ chapterId: z.number().int().positive().optional() }).optional()
    )
    .query(async ({ ctx, input }) => {
      const scope = await resolveFinanceScope(ctx.user);
      if (input?.chapterId) assertScopeChapter(input.chapterId, scope);
      return listExpenses({
        chapterId: input?.chapterId,
        scope: scope.isFull ? undefined : { chapterIds: scope.chapterIds },
      });
    }),

  recordExpense: scopedAdmin("finance")
    .input(
      z.object({
        chapterId: z.number().int().positive(),
        label: z.string().min(2).max(255),
        amountAed: z.number().positive().max(1_000_000),
        category: z
          .enum(EXPENSE_CATEGORY_KEYS as [string, ...string[]])
          .optional(),
        note: z.string().max(500).optional(),
        receiptData: z.string().max(6_000_000).optional(),
        receiptName: z.string().max(255).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await resolveFinanceScope(ctx.user);
      assertScopeChapter(input.chapterId, scope);
      return recordExpense(ctx.user, input);
    }),

  expenseReceipt: scopedAdmin("finance")
    .input(idInput)
    .query(async ({ ctx, input }) => {
      const scope = await resolveFinanceScope(ctx.user);
      return expenseReceipt(
        input.id,
        scope.isFull ? undefined : { chapterIds: scope.chapterIds }
      );
    }),

  financeChapters: scopedAdmin("finance").query(async ({ ctx }) => {
    const scope = await resolveFinanceScope(ctx.user);
    const db = getDb();
    if (scope.isFull) {
      return db
        .select({ id: schema.chapters.id, name: schema.chapters.name })
        .from(schema.chapters)
        .where(isNull(schema.chapters.deletedAt))
        .orderBy(schema.chapters.name);
    }
    if (!scope.chapterIds.length) return [];
    return db
      .select({ id: schema.chapters.id, name: schema.chapters.name })
      .from(schema.chapters)
      .where(
        and(
          isNull(schema.chapters.deletedAt),
          inArray(schema.chapters.id, scope.chapterIds)
        )
      )
      .orderBy(schema.chapters.name);
  }),

  financeOrgUnits: scopedAdmin("finance").query(async ({ ctx }) => {
    const scope = await resolveFinanceScope(ctx.user);
    const db = getDb();
    if (scope.isFull) {
      return db
        .select({
          id: schema.orgUnits.id,
          name: schema.orgUnits.name,
          level: schema.orgUnits.level,
          parentId: schema.orgUnits.parentId,
        })
        .from(schema.orgUnits)
        .orderBy(schema.orgUnits.name);
    }
    if (!scope.unitIds.length) return [];
    return db
      .select({
        id: schema.orgUnits.id,
        name: schema.orgUnits.name,
        level: schema.orgUnits.level,
        parentId: schema.orgUnits.parentId,
      })
      .from(schema.orgUnits)
      .where(inArray(schema.orgUnits.id, scope.unitIds))
      .orderBy(schema.orgUnits.name);
  }),

  /* ---------------- Operations command centre ---------------- */
  reportsRenewals: scopedAdmin("finance").query(async ({ ctx }) => {
    const scope = await resolveFinanceScope(ctx.user);
    return renewalsReport(
      scope.isFull ? undefined : { chapterIds: scope.chapterIds }
    );
  }),

  /* -------------------- admin audit trail + access control ----------------- */
});
