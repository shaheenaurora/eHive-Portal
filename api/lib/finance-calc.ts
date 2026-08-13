/** Pure (DB-free) finance math, so it can be unit-tested in isolation.
 *  Payment amounts are stored in MINOR units (fils); 1 AED = 100 fils.
 *  Chapter-budget amounts are stored in WHOLE AED. */
import { SPEND_APPROVAL_THRESHOLD_AED } from "@contracts/constants";

/** Format minor units (fils) as an AED string. */
export function fmtAed(fils: number): string {
  const aed = fils / 100;
  return (
    "AED " +
    aed.toLocaleString("en-AE", {
      minimumFractionDigits: Number.isInteger(aed) ? 0 : 2,
      maximumFractionDigits: 2,
    })
  );
}

/** Format whole AED (e.g. chapter budgets) as an AED string. */
export function fmtAedWhole(aed: number): string {
  return "AED " + aed.toLocaleString("en-AE");
}

/** Is a membership renewal due within the window (or already overdue)? */
export function isRenewalDue(
  renewalAt: Date | string | null,
  now: Date = new Date(),
  withinDays = 30
): boolean {
  if (!renewalAt) return false;
  return (
    new Date(renewalAt).getTime() <= now.getTime() + withinDays * 86_400_000
  );
}

export type PayLite = {
  amount: number;
  status: string;
  tier: string | null;
  createdAt: Date | string;
  paidAt?: Date | string | null;
};

/** Roll a list of payment records into headline finance figures (all in fils). */
export function summarizePayments(rows: PayLite[], now: Date = new Date()) {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  let paid = 0,
    thisMonth = 0,
    refunded = 0,
    pending = 0,
    paidCount = 0;
  const byTier: Record<string, { n: number; amount: number }> = {};
  for (const r of rows) {
    if (r.status === "paid") {
      paid += r.amount;
      paidCount++;
      // Revenue is recognised on settlement (paidAt), not checkout creation.
      // Fallback to createdAt for records that pre-date the paidAt column.
      const recognisedAt = r.paidAt ?? r.createdAt;
      if (new Date(recognisedAt).getTime() >= monthStart) thisMonth += r.amount;
      const t = r.tier ?? "other";
      byTier[t] ??= { n: 0, amount: 0 };
      byTier[t].n++;
      byTier[t].amount += r.amount;
    } else if (r.status === "refunded") refunded += r.amount;
    else if (r.status === "pending") pending += r.amount;
  }
  return { paid, paidCount, thisMonth, refunded, pending, byTier };
}

export type BudgetLite = { kind: string; amount: number; status: string };

/** Roll chapter budgets into allocated / spent / pending-approval totals (AED). */
export function rollupBudgets(rows: BudgetLite[]) {
  let allocated = 0,
    spent = 0,
    pendingApprovals = 0;
  for (const b of rows) {
    const live = b.status === "approved" || b.status === "spent";
    if (live && (b.kind === "allocation" || b.kind === "sponsorship"))
      allocated += b.amount;
    if (live && b.kind === "spend") spent += b.amount;
    if (b.status === "proposed") pendingApprovals++;
  }
  return { allocated, spent, pendingApprovals, remaining: allocated - spent };
}

/** Validate and compute a refund (full or partial) against a payment record.
 *  All amounts are minor units (fils). Throws a plain Error with a
 *  user-safe message on any invalid request; the caller maps it to a 400. */
export function computeRefund(
  p: { amount: number; refundedAmount?: number | null; status: string },
  requestedAed?: number
): {
  requestedMinor: number;
  newRefundedAmount: number;
  newStatus: "refunded" | "partially_refunded";
} {
  if (p.status !== "paid" && p.status !== "partially_refunded")
    throw new Error("Only a paid payment can be refunded.");
  const already = p.refundedAmount ?? 0;
  const remaining = p.amount - already;
  if (remaining <= 0)
    throw new Error("This payment is already fully refunded.");
  const requestedMinor =
    requestedAed != null ? Math.round(requestedAed * 100) : remaining;
  if (requestedMinor <= 0)
    throw new Error("Refund amount must be greater than zero.");
  if (requestedMinor > remaining)
    throw new Error(
      "Refund exceeds the remaining refundable amount (AED " +
        (remaining / 100).toFixed(2) +
        ")."
    );
  const newRefundedAmount = already + requestedMinor;
  return {
    requestedMinor,
    newRefundedAmount,
    newStatus:
      newRefundedAmount >= p.amount ? "refunded" : "partially_refunded",
  };
}

/** A chapter expense at or above the spend-approval threshold must be routed
 *  through the chapter-budget approval flow (recorded as `proposed`) rather than
 *  posting directly (`approved`), so large spend gets a second set of eyes. */
export function expenseNeedsApproval(amountAed: number): boolean {
  return Math.round(amountAed) >= SPEND_APPROVAL_THRESHOLD_AED;
}

/* ---------------------------------------------------------------------------
 * Finance reporting — pure aggregation for the admin Finance → Reports view and
 * CSV export. Payment amounts are minor units (fils); expense amounts are whole
 * AED. Revenue is recognised on settlement (paidAt, fallback createdAt).
 * ------------------------------------------------------------------------- */

export type ReportPay = {
  amount: number; // minor units (fils)
  status: string;
  tier: string | null;
  paidAt?: Date | string | null;
  createdAt: Date | string;
  refundedAmount?: number; // minor units
};
export type ReportExpense = {
  amount: number; // whole AED
  category: string | null;
  status: string;
  createdAt: Date | string;
};

export interface FinanceReport {
  revenueByMonth: {
    month: string;
    grossAed: number;
    refundsAed: number;
    netAed: number;
  }[];
  byTier: { tier: string; grossAed: number; count: number }[];
  expenseByCategory: { category: string; aed: number }[];
  totals: {
    grossAed: number;
    refundsAed: number;
    netRevenueAed: number;
    pendingAed: number;
    expensesAed: number;
    surplusAed: number;
  };
}

function ymKey(d: Date | string): string {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}

/** Aggregate payments + chapter expenses into a finance report (all AED). */
export function buildFinanceReport(
  pays: ReportPay[],
  expenses: ReportExpense[]
): FinanceReport {
  const months = new Map<string, { grossFils: number; refundFils: number }>();
  const tiers = new Map<string, { grossFils: number; count: number }>();
  let grossFils = 0,
    refundFils = 0,
    pendingFils = 0;
  for (const p of pays) {
    if (p.status === "pending") {
      pendingFils += p.amount;
      continue;
    }
    const settled =
      p.status === "paid" ||
      p.status === "partially_refunded" ||
      p.status === "refunded";
    if (!settled) continue; // failed / other → not recognised
    const key = ymKey(p.paidAt ?? p.createdAt);
    const m = months.get(key) ?? { grossFils: 0, refundFils: 0 };
    const refund = p.status === "refunded" ? p.amount : (p.refundedAmount ?? 0);
    m.grossFils += p.amount;
    m.refundFils += refund;
    months.set(key, m);
    grossFils += p.amount;
    refundFils += refund;
    const t = p.tier ?? "other";
    const tt = tiers.get(t) ?? { grossFils: 0, count: 0 };
    tt.grossFils += p.amount;
    tt.count++;
    tiers.set(t, tt);
  }
  const cats = new Map<string, number>();
  let expensesAed = 0;
  for (const e of expenses) {
    if (e.status !== "approved" && e.status !== "spent") continue; // live spend only
    const c = e.category ?? "uncategorised";
    cats.set(c, (cats.get(c) ?? 0) + e.amount);
    expensesAed += e.amount;
  }
  const revenueByMonth = [...months.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, v]) => ({
      month,
      grossAed: v.grossFils / 100,
      refundsAed: v.refundFils / 100,
      netAed: (v.grossFils - v.refundFils) / 100,
    }));
  const byTier = [...tiers.entries()]
    .sort((a, b) => b[1].grossFils - a[1].grossFils)
    .map(([tier, v]) => ({
      tier,
      grossAed: v.grossFils / 100,
      count: v.count,
    }));
  const expenseByCategory = [...cats.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category, aed]) => ({ category, aed }));
  const netRevenueAed = (grossFils - refundFils) / 100;
  return {
    revenueByMonth,
    byTier,
    expenseByCategory,
    totals: {
      grossAed: grossFils / 100,
      refundsAed: refundFils / 100,
      netRevenueAed,
      pendingAed: pendingFils / 100,
      expensesAed,
      surplusAed: netRevenueAed - expensesAed,
    },
  };
}

/** Escape a value for CSV (RFC 4180): wrap in quotes when it contains a comma,
 *  quote or newline, doubling any embedded quotes. */
function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Render a FinanceReport as a multi-section CSV (opens cleanly in Excel). */
export function financeReportCsv(r: FinanceReport): string {
  const rows: string[] = [];
  const line = (...cells: (string | number)[]) =>
    rows.push(cells.map(csvCell).join(","));
  line("Revenue by month");
  line("Month", "Gross (AED)", "Refunds (AED)", "Net (AED)");
  for (const m of r.revenueByMonth)
    line(m.month, m.grossAed, m.refundsAed, m.netAed);
  line("");
  line("Revenue by tier");
  line("Tier", "Gross (AED)", "Payments");
  for (const t of r.byTier) line(t.tier, t.grossAed, t.count);
  line("");
  line("Expenses by category");
  line("Category", "AED");
  for (const e of r.expenseByCategory) line(e.category, e.aed);
  line("");
  line("Totals");
  line("Gross revenue (AED)", r.totals.grossAed);
  line("Refunds (AED)", r.totals.refundsAed);
  line("Net revenue (AED)", r.totals.netRevenueAed);
  line("Pending (AED)", r.totals.pendingAed);
  line("Expenses (AED)", r.totals.expensesAed);
  line("Surplus (AED)", r.totals.surplusAed);
  return rows.join("\n");
}
