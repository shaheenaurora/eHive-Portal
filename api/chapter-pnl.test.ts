import { describe, it, expect } from "vitest";
import {
  fiscalYearRange,
  rollRevenueByTier,
  rollExpensesByCategory,
  buildChapterPnl,
} from "./lib/chapter-pnl";

describe("fiscalYearRange", () => {
  it("returns the calendar-year bounds by default", () => {
    const r = fiscalYearRange(2026);
    expect(r.from.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-12-31T23:59:59.999Z");
  });

  it("shifts the fiscal year when startMonth is not January", () => {
    const r = fiscalYearRange(2026, 4);
    expect(r.from.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(r.to.toISOString()).toBe("2027-03-31T23:59:59.999Z");
  });
});

describe("rollRevenueByTier", () => {
  it("groups, counts and sorts revenue by tier", () => {
    const rows = [
      { tier: "founder", amountAed: 1000 },
      { tier: "regular", amountAed: 500 },
      { tier: "founder", amountAed: 2000 },
      { tier: null, amountAed: 300 },
    ] as never[];
    const result = rollRevenueByTier(rows);
    expect(result).toEqual([
      { tier: "founder", amountAed: 3000, count: 2 },
      { tier: "regular", amountAed: 500, count: 1 },
      { tier: "other", amountAed: 300, count: 1 },
    ]);
  });
});

describe("rollExpensesByCategory", () => {
  it("groups expenses by category and sorts by amount", () => {
    const rows = [
      { category: "venue", amountAed: 400 },
      { category: "catering", amountAed: 800 },
      { category: "venue", amountAed: 200 },
      { category: null, amountAed: 100 },
    ] as never[];
    const result = rollExpensesByCategory(rows);
    expect(result).toEqual([
      { category: "catering", amountAed: 800 },
      { category: "venue", amountAed: 600 },
      { category: "uncategorised", amountAed: 100 },
    ]);
  });
});

describe("buildChapterPnl", () => {
  it("computes opening, revenue, expenses, net income and closing balance", () => {
    const pnl = buildChapterPnl(
      1,
      "Dubai",
      2026,
      1000,
      [
        {
          id: 1,
          date: new Date("2026-03-01"),
          payerName: "A",
          payerEmail: "a@x.com",
          tier: "founder",
          amountAed: 2000,
          status: "paid",
        },
        {
          id: 2,
          date: new Date("2026-04-01"),
          payerName: "B",
          payerEmail: "b@x.com",
          tier: "founder",
          amountAed: 1000,
          status: "paid",
        },
      ],
      [
        {
          id: 3,
          date: new Date("2026-05-01"),
          label: "Venue",
          category: "venue",
          amountAed: 500,
          status: "spent",
        },
        {
          id: 4,
          date: new Date("2026-06-01"),
          label: "Catering",
          category: "catering",
          amountAed: 800,
          status: "approved",
        },
      ]
    );
    expect(pnl.chapterId).toBe(1);
    expect(pnl.chapterName).toBe("Dubai");
    expect(pnl.year).toBe(2026);
    expect(pnl.openingBalanceAed).toBe(1000);
    expect(pnl.revenue.totalAed).toBe(3000);
    expect(pnl.expenses.totalAed).toBe(1300);
    expect(pnl.netIncomeAed).toBe(1700);
    expect(pnl.closingBalanceAed).toBe(2700);
    expect(pnl.revenue.byTier).toEqual([
      { tier: "founder", amountAed: 3000, count: 2 },
    ]);
    expect(pnl.expenses.byCategory).toEqual([
      { category: "catering", amountAed: 800 },
      { category: "venue", amountAed: 500 },
    ]);
  });
});
