/**
 * Chapter profit-and-loss calculation.
 *
 * Treats each calendar year as a fiscal period. Opening balance is the carried-
 * forward surplus from prior years (approved allocations minus approved/spent
 * expenses). Revenue is membership payments settled by members whose home
 * chapter is the target chapter. Expenses are approved/spend chapter-budget
 * rows. Closing balance = opening + net income.
 */

export type ChapterPnlPaymentRow = {
  id: number;
  date: Date;
  payerName: string | null;
  payerEmail: string | null;
  tier: string | null;
  amountAed: number;
  status: string;
};

export type ChapterPnlExpenseRow = {
  id: number;
  date: Date;
  label: string;
  category: string | null;
  amountAed: number;
  status: string;
};

export type ChapterPnl = {
  chapterId: number;
  chapterName: string;
  year: number;
  openingBalanceAed: number;
  revenue: {
    totalAed: number;
    byTier: { tier: string; amountAed: number; count: number }[];
    rows: ChapterPnlPaymentRow[];
  };
  expenses: {
    totalAed: number;
    byCategory: { category: string; amountAed: number }[];
    rows: ChapterPnlExpenseRow[];
  };
  netIncomeAed: number;
  closingBalanceAed: number;
};

export function fiscalYearRange(
  year: number,
  startMonth = 1
): { from: Date; to: Date } {
  const month = Math.max(1, Math.min(12, startMonth));
  return {
    from: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0)),
    to: new Date(Date.UTC(year + 1, month - 1, 1, 0, 0, 0, -1)),
  };
}

/** Group tier counts/amounts and sort by descending amount. */
export function rollRevenueByTier(
  rows: ChapterPnlPaymentRow[]
): { tier: string; amountAed: number; count: number }[] {
  const map = new Map<string, { amountAed: number; count: number }>();
  for (const r of rows) {
    const t = r.tier ?? "other";
    const cur = map.get(t) ?? { amountAed: 0, count: 0 };
    cur.amountAed += r.amountAed;
    cur.count++;
    map.set(t, cur);
  }
  return [...map.entries()]
    .map(([tier, v]) => ({ tier, ...v }))
    .sort((a, b) => b.amountAed - a.amountAed);
}

/** Group expenses by category and sort by descending amount. */
export function rollExpensesByCategory(
  rows: ChapterPnlExpenseRow[]
): { category: string; amountAed: number }[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const c = r.category ?? "uncategorised";
    map.set(c, (map.get(c) ?? 0) + r.amountAed);
  }
  return [...map.entries()]
    .map(([category, amountAed]) => ({ category, amountAed }))
    .sort((a, b) => b.amountAed - a.amountAed);
}

export function buildChapterPnl(
  chapterId: number,
  chapterName: string,
  year: number,
  openingBalanceAed: number,
  payments: ChapterPnlPaymentRow[],
  expenses: ChapterPnlExpenseRow[]
): ChapterPnl {
  const revenueTotal = payments.reduce((s, r) => s + r.amountAed, 0);
  const expensesTotal = expenses.reduce((s, r) => s + r.amountAed, 0);
  const netIncomeAed = revenueTotal - expensesTotal;
  return {
    chapterId,
    chapterName,
    year,
    openingBalanceAed,
    revenue: {
      totalAed: revenueTotal,
      byTier: rollRevenueByTier(payments),
      rows: payments,
    },
    expenses: {
      totalAed: expensesTotal,
      byCategory: rollExpensesByCategory(expenses),
      rows: expenses,
    },
    netIncomeAed,
    closingBalanceAed: openingBalanceAed + netIncomeAed,
  };
}
