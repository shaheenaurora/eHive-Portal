import { and, desc, eq, gte, isNull, like, lte, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import * as schema from "@db/schema";
import { getDb } from "./connection";
import { withTransaction } from "./transaction";
import { audit } from "../lib/audit";
import { notify, renewMembership } from "./circle";
import {
  createInvoiceFromPayment,
  createCreditNoteFromRefund,
} from "./invoicing";
import { sendInvoiceReady } from "../lib/lead-mail";
import { applyLifecycleTransition } from "../lib/lifecycle";
import { paymentsEnabled, getPaymentProvider } from "../lib/payments";
import {
  TIER_PRICE_AED,
  REFUND_WINDOW_DAYS,
  BASE_CURRENCY,
  FX_RATE_SCALE,
  convertToBaseMinor,
} from "@contracts/constants";
import { ratesMap } from "./fx";
import {
  summarizePayments,
  rollupBudgets,
  isRenewalDue,
  computeRefund,
  expenseNeedsApproval,
  buildFinanceReport,
  financeReportCsv,
  fmtAedWhole,
  type PayLite,
  type BudgetLite,
  type ReportPay,
  type ReportExpense,
  type FinanceReport,
} from "../lib/finance-calc";

type Actor = { id: number; email: string };

/** Headline finance figures for the dashboard (payments in fils, budgets in AED). */
export async function financeSummary() {
  const db = getDb();
  const [pays, budgets, activeMembers] = await Promise.all([
    db
      .select({
        amount: schema.paymentRecords.amount,
        status: schema.paymentRecords.status,
        tier: schema.paymentRecords.tier,
        createdAt: schema.paymentRecords.createdAt,
        paidAt: schema.paymentRecords.paidAt,
      })
      .from(schema.paymentRecords),
    db
      .select({
        kind: schema.chapterBudgets.kind,
        amount: schema.chapterBudgets.amount,
        status: schema.chapterBudgets.status,
      })
      .from(schema.chapterBudgets),
    db
      .select({
        tier: schema.members.tier,
        renewalAt: schema.members.renewalAt,
      })
      .from(schema.members)
      .where(eq(schema.members.status, "active")),
  ]);

  const pay = summarizePayments(pays as PayLite[]);
  const budget = rollupBudgets(budgets as BudgetLite[]);

  // Renewals due in the next 30 days (or overdue): count + value at contract price.
  let renewalsCount = 0,
    renewalsValueAed = 0;
  for (const m of activeMembers) {
    if (isRenewalDue(m.renewalAt)) {
      renewalsCount++;
      renewalsValueAed += TIER_PRICE_AED[m.tier] ?? 0;
    }
  }

  return {
    revenuePaid: pay.paid,
    paidCount: pay.paidCount,
    revenueThisMonth: pay.thisMonth,
    refundedTotal: pay.refunded,
    pendingTotal: pay.pending,
    byTier: pay.byTier,
    renewals: { count: renewalsCount, valueAed: renewalsValueAed },
    budgets: budget,
  };
}

export type FinanceReportRange = { from?: Date | null; to?: Date | null };

/** Build the finance report (revenue by month/tier, expenses by category,
 *  totals) from payment records and chapter spend lines, optionally restricted
 *  to a date range. Payments are dated by settlement (paidAt, falling back to
 *  createdAt); expenses by createdAt. */
export async function financeReport(
  range?: FinanceReportRange
): Promise<FinanceReport> {
  const db = getDb();
  const payDate = sql`coalesce(${schema.paymentRecords.paidAt}, ${schema.paymentRecords.createdAt})`;
  const payConds = [];
  if (range?.from) payConds.push(gte(payDate, range.from));
  if (range?.to) payConds.push(lte(payDate, range.to));
  const expConds = [eq(schema.chapterBudgets.kind, "spend")];
  if (range?.from)
    expConds.push(gte(schema.chapterBudgets.createdAt, range.from));
  if (range?.to) expConds.push(lte(schema.chapterBudgets.createdAt, range.to));
  const [rawPays, expenses, rates] = await Promise.all([
    db
      .select({
        amount: schema.paymentRecords.amount,
        currency: schema.paymentRecords.currency,
        status: schema.paymentRecords.status,
        tier: schema.paymentRecords.tier,
        paidAt: schema.paymentRecords.paidAt,
        createdAt: schema.paymentRecords.createdAt,
        refundedAmount: schema.paymentRecords.refundedAmount,
      })
      .from(schema.paymentRecords)
      .where(payConds.length ? and(...payConds) : undefined),
    db
      .select({
        amount: schema.chapterBudgets.amount,
        category: schema.chapterBudgets.category,
        status: schema.chapterBudgets.status,
        createdAt: schema.chapterBudgets.createdAt,
      })
      .from(schema.chapterBudgets)
      .where(and(...expConds)),
    ratesMap(),
  ]);
  // FX-normalise every payment to the base currency before aggregating, so a
  // mixed-currency ledger reports in one number (chapter expenses are AED-only).
  const pays = rawPays.map(p => {
    const rate = rates.get((p.currency ?? BASE_CURRENCY).toLowerCase());
    if (rate == null || rate === FX_RATE_SCALE) return p;
    return {
      ...p,
      amount: convertToBaseMinor(p.amount, rate),
      refundedAmount: convertToBaseMinor(p.refundedAmount ?? 0, rate),
    };
  });
  return buildFinanceReport(pays as ReportPay[], expenses as ReportExpense[]);
}

/** The finance report rendered as a downloadable CSV (filename + contents). */
export async function financeReportCsvString(
  range?: FinanceReportRange
): Promise<{
  filename: string;
  csv: string;
}> {
  const report = await financeReport(range);
  const stamp = new Date().toISOString().slice(0, 10);
  return {
    filename: `ehive-finance-report-${stamp}.csv`,
    csv: financeReportCsv(report),
  };
}

export type PaymentRow = {
  id: number;
  userId: number;
  payerName: string | null;
  payerEmail: string | null;
  provider: string;
  providerRef: string | null;
  purpose: string;
  tier: string | null;
  amount: number;
  currency: string;
  status: string;
  note: string | null;
  refundReason: string | null;
  refundedAmount: number;
  refundedAt: Date | null;
  createdAt: Date;
};

/** The payments ledger, joined to the payer, newest first. */
export async function listPayments(
  opts: { status?: string; q?: string; limit?: number } = {}
): Promise<PaymentRow[]> {
  const db = getDb();
  const wheres = [];
  if (opts.status)
    wheres.push(eq(schema.paymentRecords.status, opts.status as never));
  if (opts.q) {
    const term = `%${opts.q}%`;
    wheres.push(
      or(
        like(schema.users.name, term),
        like(schema.users.email, term),
        like(schema.paymentRecords.providerRef, term)
      )
    );
  }
  const rows = await db
    .select({
      id: schema.paymentRecords.id,
      userId: schema.paymentRecords.userId,
      payerName: schema.users.name,
      payerEmail: schema.users.email,
      provider: schema.paymentRecords.provider,
      providerRef: schema.paymentRecords.providerRef,
      purpose: schema.paymentRecords.purpose,
      tier: schema.paymentRecords.tier,
      amount: schema.paymentRecords.amount,
      currency: schema.paymentRecords.currency,
      status: schema.paymentRecords.status,
      note: schema.paymentRecords.note,
      refundReason: schema.paymentRecords.refundReason,
      refundedAmount: schema.paymentRecords.refundedAmount,
      refundedAt: schema.paymentRecords.refundedAt,
      createdAt: schema.paymentRecords.createdAt,
    })
    .from(schema.paymentRecords)
    .leftJoin(schema.users, eq(schema.users.id, schema.paymentRecords.userId))
    .where(wheres.length ? and(...wheres) : undefined)
    .orderBy(desc(schema.paymentRecords.createdAt))
    .limit(opts.limit ?? 200);
  return rows as PaymentRow[];
}

/** A single payment plus payer details, for a printable receipt. */
export async function paymentReceipt(id: number) {
  const row =
    (await listPayments({ limit: 1 })).find(r => r.id === id) ??
    (
      await getDb()
        .select({
          id: schema.paymentRecords.id,
          userId: schema.paymentRecords.userId,
          payerName: schema.users.name,
          payerEmail: schema.users.email,
          provider: schema.paymentRecords.provider,
          providerRef: schema.paymentRecords.providerRef,
          purpose: schema.paymentRecords.purpose,
          tier: schema.paymentRecords.tier,
          amount: schema.paymentRecords.amount,
          currency: schema.paymentRecords.currency,
          status: schema.paymentRecords.status,
          note: schema.paymentRecords.note,
          refundReason: schema.paymentRecords.refundReason,
          refundedAt: schema.paymentRecords.refundedAt,
          createdAt: schema.paymentRecords.createdAt,
        })
        .from(schema.paymentRecords)
        .leftJoin(
          schema.users,
          eq(schema.users.id, schema.paymentRecords.userId)
        )
        .where(eq(schema.paymentRecords.id, id))
        .limit(1)
    ).at(0);
  if (!row)
    throw new TRPCError({ code: "NOT_FOUND", message: "Payment not found." });
  return row as PaymentRow;
}

/** Record an offline / manual payment (bank transfer, cash) as paid revenue.
 *  Also issues a paid invoice atomically so the books stay in sync. */
export async function recordManualPayment(
  actor: Actor,
  input: {
    userId: number;
    purpose: string;
    tier?: string | null;
    amount: number;
    note?: string;
    extendRenewal?: boolean;
    /** Currency the amount is denominated in (default base/AED). */
    currency?: string;
  }
) {
  const currency = (input.currency ?? BASE_CURRENCY).toLowerCase();
  const db = getDb();
  const user = (
    await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, input.userId))
      .limit(1)
  ).at(0);
  if (!user)
    throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });

  // Validate up-front so "extend renewal" can't silently do nothing when the
  // payer isn't actually a member (previously the renewal roll-forward was
  // skipped without any signal to the admin).
  if (input.extendRenewal) {
    const isMember = (
      await db
        .select({ id: schema.members.id })
        .from(schema.members)
        .where(eq(schema.members.userId, input.userId))
        .limit(1)
    ).at(0);
    if (!isMember)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Can't extend a renewal — this user isn't a member yet. Record the payment without 'extend renewal', or admit them first.",
      });
  }

  const purpose = input.purpose;
  const tier = input.tier;
  // The tier-price check only makes sense in the base currency; a foreign-
  // currency payment is recorded at face value and normalised in reporting.
  if (
    currency === BASE_CURRENCY &&
    (purpose === "membership" || purpose === "renewal") &&
    tier
  ) {
    const expected = TIER_PRICE_AED[tier as keyof typeof TIER_PRICE_AED];
    if (expected != null && Math.abs(input.amount - expected) > 0.01) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Amount does not match the ${tier} tier price of AED ${expected}.`,
      });
    }
  }

  const amountMinor = Math.round(input.amount * 100); // minor units of the specified currency
  const now = new Date();
  const { paymentId, invoiceNumber } = await withTransaction(async tx => {
    const res = await tx.insert(schema.paymentRecords).values({
      userId: input.userId,
      provider: "manual",
      providerRef: null,
      purpose,
      tier: (tier ?? null) as never,
      amount: amountMinor,
      currency,
      status: "paid",
      paidAt: now,
      note: input.note ?? null,
    });
    const paymentId = Number(
      (res as unknown as { insertId?: number }).insertId ?? 0
    );
    const invoice = await createInvoiceFromPayment(
      tx,
      {
        id: paymentId,
        userId: input.userId,
        purpose,
        tier: tier ?? null,
        amount: amountMinor,
        currency,
        note: input.note ?? null,
        paidAt: now,
      },
      { status: "paid" }
    );
    return { paymentId, invoiceNumber: invoice.invoiceNumber };
  });

  // Optionally roll the member's renewal forward a year when logging a renewal.
  // Route through renewMembership so the CRM lifecycle transition, save-case
  // side effects, event log and member notification all run centrally instead
  // of writing status/lifecycleState directly here (which drifted from the
  // lifecycle executor).
  if (input.extendRenewal) {
    await renewMembership(input.userId, input.note ?? "Membership renewed");
  }
  await audit(actor, "finance.manual_payment", {
    type: "payment",
    id: paymentId,
    detail: `${currency.toUpperCase()} ${input.amount} · ${input.purpose} · ${invoiceNumber}`,
  });
  sendInvoiceReady({
    email: user.email,
    name: user.name,
    invoiceNumber,
    amount: input.amount,
    currency,
  }).catch(() => {
    /* non-fatal */
  });
  return { ok: true, invoiceNumber };
}

/** Refund a payment — full, or a partial amount (AED). Moves the money back
 *  through the gateway first, then records it; supports repeated partial refunds
 *  up to the captured amount. */
export async function refundPayment(
  actor: Actor,
  id: number,
  reason: string,
  amountAed?: number,
  /** Set by the router when a full administrator refunds outside the window. */
  overrideWindow = false
) {
  const db = getDb();
  const p = (
    await db
      .select()
      .from(schema.paymentRecords)
      .where(eq(schema.paymentRecords.id, id))
      .limit(1)
  ).at(0);
  if (!p)
    throw new TRPCError({ code: "NOT_FOUND", message: "Payment not found." });

  // Refund window: a finance admin self-serves within REFUND_WINDOW_DAYS of the
  // charge; an older charge needs a full administrator to override, so a stale
  // membership isn't casually reversed.
  const charged = new Date(p.paidAt ?? p.createdAt).getTime();
  const ageDays = (Date.now() - charged) / (24 * 60 * 60 * 1000);
  if (ageDays > REFUND_WINDOW_DAYS && !overrideWindow)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `This charge is ${Math.floor(ageDays)} days old — past the ${REFUND_WINDOW_DAYS}-day refund window. A full administrator can override.`,
    });

  // Validate + compute the refund (pure, unit-tested).
  let plan: ReturnType<typeof computeRefund>;
  try {
    plan = computeRefund(p, amountAed);
  } catch (err) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: err instanceof Error ? err.message : "Invalid refund.",
    });
  }

  // Move the money back through the gateway BEFORE flipping the record — if the
  // gateway refuses, the books must not say "refunded" while the charge stands.
  // Manual/cash payments (no providerRef) are recorded-only.
  if (p.provider !== "manual" && p.providerRef) {
    if (!paymentsEnabled())
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "The payment gateway isn't configured, so this charge can't be refunded automatically.",
      });
    try {
      await getPaymentProvider().refund(p.providerRef, plan.requestedMinor);
    } catch (err) {
      throw new TRPCError({
        code: "BAD_GATEWAY",
        message:
          "The gateway refused the refund: " +
          (err instanceof Error ? err.message : String(err)),
      });
    }
  }

  const now = new Date();
  const creditNote = await withTransaction(async tx => {
    await tx
      .update(schema.paymentRecords)
      .set({
        status: plan.newStatus,
        refundedAmount: plan.newRefundedAmount,
        refundedByUserId: actor.id,
        refundReason: reason,
        refundedAt: now,
      })
      .where(eq(schema.paymentRecords.id, id));
    return createCreditNoteFromRefund(
      tx,
      {
        id: p.id,
        userId: p.userId,
        amount: p.amount,
        currency: p.currency,
      },
      plan.requestedMinor,
      reason
    );
  });
  const partial = plan.newStatus === "partially_refunded";
  await audit(actor, "finance.refund", {
    type: "payment",
    id,
    detail: `${(plan.requestedMinor / 100).toFixed(2)} ${p.currency}${
      partial ? " (partial)" : ""
    } · ${creditNote.creditNoteNumber} — ${reason}`,
  });
  const m = (
    await db
      .select({ id: schema.members.id })
      .from(schema.members)
      .where(eq(schema.members.userId, p.userId))
      .limit(1)
  ).at(0);
  if (m) {
    try {
      await notify(
        m.id,
        "A payment on your membership has been refunded. Please reach out if you have questions.",
        "membership"
      );
    } catch {
      /* non-fatal */
    }

    // A full refund of a membership or renewal payment reverts the member's
    // entitlement: they lapse immediately so they cannot retain access for a
    // year they did not pay for. Partial refunds leave membership intact but
    // are recorded on the ledger.
    if (
      plan.newStatus === "refunded" &&
      (p.purpose === "membership" || p.purpose === "renewal")
    ) {
      try {
        await applyLifecycleTransition(m.id, "lapsed", {
          actor,
          reason: `Payment #${id} refunded: ${reason}`,
        });
      } catch (e) {
        console.error("refund lifecycle transition failed", e);
      }
    }
  }
  return { ok: true };
}

/** Active members whose renewal is due within the window (or overdue). */
export async function renewalsDue(withinDays = 30) {
  const db = getDb();
  const rows = await db
    .select({
      memberId: schema.members.id,
      tier: schema.members.tier,
      renewalAt: schema.members.renewalAt,
      name: schema.users.name,
      email: schema.users.email,
      chapterName: schema.chapters.name,
    })
    .from(schema.members)
    .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
    .leftJoin(
      schema.chapters,
      eq(schema.chapters.id, schema.members.homeChapterId)
    )
    .where(eq(schema.members.status, "active"))
    .orderBy(schema.members.renewalAt);
  const now = new Date();
  return rows
    .filter(r => isRenewalDue(r.renewalAt, now, withinDays))
    .map(r => ({
      ...r,
      valueAed: TIER_PRICE_AED[r.tier] ?? 0,
      overdue: r.renewalAt
        ? new Date(r.renewalAt).getTime() < now.getTime()
        : false,
    }));
}

/** Chapter budgets rolled up per chapter for the finance view. */
export async function budgetRollup() {
  const db = getDb();
  const rows = await db
    .select({
      chapterId: schema.chapterBudgets.chapterId,
      chapterName: schema.chapters.name,
      kind: schema.chapterBudgets.kind,
      amount: schema.chapterBudgets.amount,
      status: schema.chapterBudgets.status,
    })
    .from(schema.chapterBudgets)
    .leftJoin(
      schema.chapters,
      eq(schema.chapters.id, schema.chapterBudgets.chapterId)
    );
  const byChapter = new Map<
    number,
    { chapterId: number; chapterName: string | null; lines: BudgetLite[] }
  >();
  for (const r of rows) {
    const g = byChapter.get(r.chapterId) ?? {
      chapterId: r.chapterId,
      chapterName: r.chapterName,
      lines: [],
    };
    g.lines.push({ kind: r.kind, amount: r.amount, status: r.status });
    byChapter.set(r.chapterId, g);
  }
  return [...byChapter.values()]
    .map(g => ({
      chapterId: g.chapterId,
      chapterName: g.chapterName,
      ...rollupBudgets(g.lines),
    }))
    .sort((a, b) => b.allocated - a.allocated);
}

/** Members (id + label) for the manual-payment picker. */
export async function payableMembers(q?: string) {
  const db = getDb();
  const term = q ? `%${q}%` : null;
  const rows = await db
    .select({
      userId: schema.members.userId,
      name: schema.users.name,
      email: schema.users.email,
      tier: schema.members.tier,
    })
    .from(schema.members)
    .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
    .where(
      term
        ? or(like(schema.users.name, term), like(schema.users.email, term))
        : undefined
    )
    .orderBy(schema.users.name)
    .limit(20);
  return rows;
}

export type ExpenseRow = {
  id: number;
  chapterId: number;
  chapterName: string | null;
  label: string;
  amount: number;
  category: string | null;
  status: string;
  note: string | null;
  receiptName: string | null;
  createdAt: Date;
};

/** Chapter expenses (spend budget lines), newest first. */
export async function listExpenses(
  opts: { chapterId?: number; limit?: number } = {}
): Promise<ExpenseRow[]> {
  const db = getDb();
  const wheres = [eq(schema.chapterBudgets.kind, "spend")];
  if (opts.chapterId)
    wheres.push(eq(schema.chapterBudgets.chapterId, opts.chapterId));
  const rows = await db
    .select({
      id: schema.chapterBudgets.id,
      chapterId: schema.chapterBudgets.chapterId,
      chapterName: schema.chapters.name,
      label: schema.chapterBudgets.label,
      amount: schema.chapterBudgets.amount,
      category: schema.chapterBudgets.category,
      status: schema.chapterBudgets.status,
      note: schema.chapterBudgets.note,
      receiptName: schema.chapterBudgets.receiptName,
      createdAt: schema.chapterBudgets.createdAt,
    })
    .from(schema.chapterBudgets)
    .leftJoin(
      schema.chapters,
      eq(schema.chapters.id, schema.chapterBudgets.chapterId)
    )
    .where(and(...wheres))
    .orderBy(desc(schema.chapterBudgets.createdAt))
    .limit(opts.limit ?? 200);
  return rows as ExpenseRow[];
}

/** Fetch a spend line's receipt (the data URL + filename), or null if none. */
export async function expenseReceipt(
  id: number
): Promise<{ name: string; data: string } | null> {
  const row = (
    await getDb()
      .select({
        data: schema.chapterBudgets.receiptData,
        name: schema.chapterBudgets.receiptName,
      })
      .from(schema.chapterBudgets)
      .where(eq(schema.chapterBudgets.id, id))
      .limit(1)
  ).at(0);
  if (!row?.data) return null;
  return { name: row.name ?? "receipt", data: row.data };
}

/** Record a chapter expense against its operating budget. */
export async function recordExpense(
  actor: Actor,
  input: {
    chapterId: number;
    label: string;
    amountAed: number;
    category?: string;
    note?: string;
    /** Optional receipt as a base64 data URL, plus its original filename. */
    receiptData?: string;
    receiptName?: string;
  }
) {
  const db = getDb();
  const chapter = (
    await db
      .select()
      .from(schema.chapters)
      .where(
        and(
          eq(schema.chapters.id, input.chapterId),
          isNull(schema.chapters.deletedAt)
        )
      )
      .limit(1)
  ).at(0);
  if (!chapter)
    throw new TRPCError({ code: "NOT_FOUND", message: "Chapter not found." });
  const amount = Math.round(input.amountAed);
  if (amount <= 0)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Amount must be greater than zero.",
    });
  // Spend at or above the approval threshold enters the chapter-budget approval
  // flow as a "proposed" line (decided via decideBudgetLine) rather than being
  // auto-approved — so a finance-scoped admin can't spend chapter money over the
  // threshold without a second set of eyes. Smaller amounts post directly.
  const needsApproval = expenseNeedsApproval(amount);
  const status = needsApproval ? "proposed" : "approved";

  // Enforce budget balance: an approved spend cannot exceed the chapter's
  // remaining operating budget. Proposed spends are allowed because they still
  // require a second approval step, but they too are capped so a finance admin
  // cannot propose an impossible amount.
  const budgetRows = await db
    .select({
      kind: schema.chapterBudgets.kind,
      amount: schema.chapterBudgets.amount,
      status: schema.chapterBudgets.status,
    })
    .from(schema.chapterBudgets)
    .where(eq(schema.chapterBudgets.chapterId, input.chapterId));
  const { remaining } = rollupBudgets(budgetRows as BudgetLite[]);
  if (remaining - amount < 0) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `This spend exceeds the chapter's remaining operating budget (${fmtAedWhole(remaining)} AED). Request an allocation first.`,
    });
  }

  // Receipt is stored in-row as a data URL; cap the size so the DB row stays
  // sane (base64 of ~4 MB ≈ 5.5 MB of text).
  const receiptData = input.receiptData?.trim() || null;
  if (receiptData) {
    if (!/^data:[\w./+-]+;base64,/.test(receiptData))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Receipt must be a base64 data URL.",
      });
    if (receiptData.length > 6_000_000)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Receipt is too large — keep it under about 4 MB.",
      });
  }

  const res = await db.insert(schema.chapterBudgets).values({
    chapterId: input.chapterId,
    label: input.label.slice(0, 255),
    kind: "spend",
    amount,
    category: input.category ?? null,
    status,
    note: input.note ?? null,
    receiptData,
    receiptName: receiptData
      ? (input.receiptName?.slice(0, 255) ?? "receipt")
      : null,
  });
  await audit(actor, "finance.expense", {
    type: "chapterBudget",
    id: Number((res as unknown as { insertId?: number }).insertId ?? 0),
    detail: `${chapter.name}: AED ${amount} · ${input.category ?? "uncategorised"} · ${input.label}${needsApproval ? " · pending approval" : ""}`,
  });
  return { ok: true, pending: needsApproval };
}
