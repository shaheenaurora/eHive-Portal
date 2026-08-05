/** Pure (DB-free) finance math, so it can be unit-tested in isolation.
 *  Payment amounts are stored in MINOR units (fils); 1 AED = 100 fils.
 *  Chapter-budget amounts are stored in WHOLE AED. */

/** Format minor units (fils) as an AED string. */
export function fmtAed(fils: number): string {
  const aed = fils / 100;
  return "AED " + aed.toLocaleString("en-AE", {
    minimumFractionDigits: Number.isInteger(aed) ? 0 : 2, maximumFractionDigits: 2,
  });
}

/** Format whole AED (e.g. chapter budgets) as an AED string. */
export function fmtAedWhole(aed: number): string {
  return "AED " + aed.toLocaleString("en-AE");
}

/** Is a membership renewal due within the window (or already overdue)? */
export function isRenewalDue(renewalAt: Date | string | null, now: Date = new Date(), withinDays = 30): boolean {
  if (!renewalAt) return false;
  return new Date(renewalAt).getTime() <= now.getTime() + withinDays * 86_400_000;
}

export type PayLite = { amount: number; status: string; tier: string | null; createdAt: Date | string };

/** Roll a list of payment records into headline finance figures (all in fils). */
export function summarizePayments(rows: PayLite[], now: Date = new Date()) {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  let paid = 0, thisMonth = 0, refunded = 0, pending = 0, paidCount = 0;
  const byTier: Record<string, { n: number; amount: number }> = {};
  for (const r of rows) {
    if (r.status === "paid") {
      paid += r.amount; paidCount++;
      if (new Date(r.createdAt).getTime() >= monthStart) thisMonth += r.amount;
      const t = r.tier ?? "other";
      (byTier[t] ??= { n: 0, amount: 0 });
      byTier[t].n++; byTier[t].amount += r.amount;
    } else if (r.status === "refunded") refunded += r.amount;
    else if (r.status === "pending") pending += r.amount;
  }
  return { paid, paidCount, thisMonth, refunded, pending, byTier };
}

export type BudgetLite = { kind: string; amount: number; status: string };

/** Roll chapter budgets into allocated / spent / pending-approval totals (AED). */
export function rollupBudgets(rows: BudgetLite[]) {
  let allocated = 0, spent = 0, pendingApprovals = 0;
  for (const b of rows) {
    const live = b.status === "approved" || b.status === "spent";
    if (live && (b.kind === "allocation" || b.kind === "sponsorship")) allocated += b.amount;
    if (live && b.kind === "spend") spent += b.amount;
    if (b.status === "proposed") pendingApprovals++;
  }
  return { allocated, spent, pendingApprovals, remaining: allocated - spent };
}
