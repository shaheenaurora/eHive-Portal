/** Pure (DB-free) finance math, so it can be unit-tested in isolation.
 *  Payment amounts are stored in MINOR units (fils); 1 AED = 100 fils.
 *  Chapter-budget amounts are stored in WHOLE AED. */

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
