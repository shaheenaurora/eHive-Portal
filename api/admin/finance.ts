import { z } from "zod";
import { and, desc, eq, isNull, like, or, sql } from "drizzle-orm";
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

/** Optional {from,to} ISO-date range for the finance report. */
const reportRangeInput = z
  .object({
    from: z.string().date().optional(),
    to: z.string().date().optional(),
  })
  .optional();

/** Turn {from,to} ISO dates into a Date range; `to` is inclusive (end of day). */
function parseReportRange(input?: { from?: string; to?: string }) {
  if (!input) return undefined;
  return {
    from: input.from ? new Date(input.from + "T00:00:00.000Z") : null,
    to: input.to ? new Date(input.to + "T23:59:59.999Z") : null,
  };
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
  financeSummary: scopedAdmin("finance").query(() => financeSummary()),
  financeReport: scopedAdmin("finance")
    .input(reportRangeInput)
    .query(({ input }) => financeReport(parseReportRange(input))),
  financeReportCsv: scopedAdmin("finance")
    .input(reportRangeInput)
    .query(({ input }) => financeReportCsvString(parseReportRange(input))),

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
    .query(({ input }) => listPayments({ status: input?.status, q: input?.q })),

  paymentReceipt: scopedAdmin("finance")
    .input(idInput)
    .query(({ input }) => paymentReceipt(input.id)),

  renewalsDue: scopedAdmin("finance")
    .input(
      z
        .object({ withinDays: z.number().int().min(1).max(120).optional() })
        .optional()
    )
    .query(({ input }) => renewalsDue(input?.withinDays ?? 30)),

  budgetRollup: scopedAdmin("finance").query(() => budgetRollup()),

  payableMembers: scopedAdmin("finance")
    .input(z.object({ q: z.string().max(120).optional() }).optional())
    .query(({ input }) => payableMembers(input?.q)),

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
    .mutation(({ ctx, input }) => recordManualPayment(ctx.user, input)),

  /* ---- multi-currency FX rates (admin-maintained) ---- */
  currencyRates: scopedAdmin("finance").query(() => listRates()),
  setCurrencyRate: scopedAdmin("finance")
    .input(z.object({ code: z.string().min(2).max(8), rate: z.number() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await setRate(ctx.user, input.code.toLowerCase(), input.rate);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Invalid rate.",
        });
      }
    }),
  clearCurrencyRate: scopedAdmin("finance")
    .input(z.object({ code: z.string().min(2).max(8) }))
    .mutation(({ ctx, input }) =>
      clearRate(ctx.user, input.code.toLowerCase())
    ),

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
    .mutation(({ ctx, input }) =>
      refundPayment(
        ctx.user,
        input.id,
        input.reason,
        input.amountAed,
        input.overrideWindow === true && isFullAdmin(ctx.user as never)
      )
    ),

  invoices: scopedAdmin("finance")
    .input(
      z
        .object({
          status: z.enum(["open", "paid", "void"]).optional(),
        })
        .optional()
    )
    .query(({ input }) => listInvoices({ status: input?.status })),

  invoiceById: scopedAdmin("finance")
    .input(idInput)
    .query(({ input }) => getInvoiceById(input.id)),

  creditNotes: scopedAdmin("finance").query(() => listCreditNotes()),

  creditNoteById: scopedAdmin("finance")
    .input(idInput)
    .query(({ input }) => getCreditNoteById(input.id)),

  expenses: scopedAdmin("finance")
    .input(
      z.object({ chapterId: z.number().int().positive().optional() }).optional()
    )
    .query(({ input }) => listExpenses({ chapterId: input?.chapterId })),

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
    .mutation(({ ctx, input }) => recordExpense(ctx.user, input)),

  expenseReceipt: scopedAdmin("finance")
    .input(idInput)
    .query(({ input }) => expenseReceipt(input.id)),

  financeChapters: scopedAdmin("finance").query(async () => {
    return getDb()
      .select({ id: schema.chapters.id, name: schema.chapters.name })
      .from(schema.chapters)
      .where(isNull(schema.chapters.deletedAt))
      .orderBy(schema.chapters.name);
  }),

  /* ---------------- Operations command centre ---------------- */
  reportsRenewals: scopedAdmin("finance").query(() => renewalsReport()),

  /* -------------------- admin audit trail + access control ----------------- */
});
