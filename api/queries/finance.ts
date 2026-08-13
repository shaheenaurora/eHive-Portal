import { and, desc, eq, isNull, like, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import * as schema from "@db/schema";
import { getDb } from "./connection";
import { audit } from "../lib/audit";
import { notify } from "./circle";
import { paymentsEnabled, getPaymentProvider } from "../lib/payments";
import { TIER_PRICE_AED } from "@contracts/constants";
import {
  summarizePayments,
  rollupBudgets,
  isRenewalDue,
  type PayLite,
  type BudgetLite,
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

/** Record an offline / manual payment (bank transfer, cash) as paid revenue. */
export async function recordManualPayment(
  actor: Actor,
  input: {
    userId: number;
    purpose: string;
    tier?: string | null;
    amountAed: number;
    note?: string;
    extendRenewal?: boolean;
  }
) {
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
  if ((purpose === "membership" || purpose === "renewal") && tier) {
    const expected = TIER_PRICE_AED[tier as keyof typeof TIER_PRICE_AED];
    if (expected != null && Math.abs(input.amountAed - expected) > 0.01) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Amount does not match the ${tier} tier price of AED ${expected}.`,
      });
    }
  }

  const amount = Math.round(input.amountAed * 100); // AED → fils
  const res = await db.insert(schema.paymentRecords).values({
    userId: input.userId,
    provider: "manual",
    providerRef: null,
    purpose,
    tier: (tier ?? null) as never,
    amount,
    currency: "aed",
    status: "paid",
    note: input.note ?? null,
  });
  // Optionally roll the member's renewal forward a year when logging a renewal.
  if (input.extendRenewal) {
    const m = (
      await db
        .select()
        .from(schema.members)
        .where(eq(schema.members.userId, input.userId))
        .limit(1)
    ).at(0);
    if (m) {
      const base =
        m.renewalAt && new Date(m.renewalAt) > new Date()
          ? new Date(m.renewalAt)
          : new Date();
      base.setFullYear(base.getFullYear() + 1);
      await db
        .update(schema.members)
        .set({ renewalAt: base, status: "active", lifecycleState: "active" })
        .where(eq(schema.members.id, m.id));
      try {
        await notify(
          m.id,
          "Your membership renewal has been recorded — thank you.",
          "membership"
        );
      } catch {
        /* non-fatal */
      }
    }
  }
  await audit(actor, "finance.manual_payment", {
    type: "payment",
    id: Number((res as unknown as { insertId?: number }).insertId ?? 0),
    detail: `AED ${input.amountAed} · ${input.purpose}`,
  });
  return { ok: true };
}

/** Refund a paid payment: mark refunded, log who/why, and notify the member. */
export async function refundPayment(actor: Actor, id: number, reason: string) {
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
  if (p.status !== "paid")
    throw new TRPCError({
      code: "CONFLICT",
      message: "Only a paid payment can be refunded.",
    });
  // Actually move the money back through the gateway before marking the record
  // refunded. If the gateway refund fails we must NOT flip the DB, or the books
  // would say "refunded" while the charge is still captured. Manual/cash
  // payments (no providerRef) are recorded-only — refunded outside the app.
  if (p.provider !== "manual" && p.providerRef) {
    if (!paymentsEnabled())
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "The payment gateway isn't configured, so this charge can't be refunded automatically.",
      });
    try {
      await getPaymentProvider().refund(p.providerRef);
    } catch (err) {
      throw new TRPCError({
        code: "BAD_GATEWAY",
        message:
          "The gateway refused the refund: " +
          (err instanceof Error ? err.message : String(err)),
      });
    }
  }
  await db
    .update(schema.paymentRecords)
    .set({
      status: "refunded",
      refundedByUserId: actor.id,
      refundReason: reason,
      refundedAt: new Date(),
    })
    .where(eq(schema.paymentRecords.id, id));
  await audit(actor, "finance.refund", {
    type: "payment",
    id,
    detail: `${p.amount / 100} ${p.currency} — ${reason}`,
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
  status: string;
  note: string | null;
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
      status: schema.chapterBudgets.status,
      note: schema.chapterBudgets.note,
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

/** Record a chapter expense against its operating budget. */
export async function recordExpense(
  actor: Actor,
  input: { chapterId: number; label: string; amountAed: number; note?: string }
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
  const res = await db.insert(schema.chapterBudgets).values({
    chapterId: input.chapterId,
    label: input.label.slice(0, 255),
    kind: "spend",
    amount,
    status: "approved",
    note: input.note ?? null,
  });
  await audit(actor, "finance.expense", {
    type: "chapterBudget",
    id: Number((res as unknown as { insertId?: number }).insertId ?? 0),
    detail: `${chapter.name}: AED ${amount} · ${input.label}`,
  });
  return { ok: true };
}
