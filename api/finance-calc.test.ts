import { describe, it, expect } from "vitest";
import {
  fmtAed,
  fmtAedWhole,
  isRenewalDue,
  summarizePayments,
  rollupBudgets,
  computeRefund,
  expenseNeedsApproval,
  buildFinanceReport,
  financeReportCsv,
  type PayLite,
  type BudgetLite,
  type ReportPay,
  type ReportExpense,
} from "./lib/finance-calc";

describe("finance formatting", () => {
  it("formats fils as AED, hiding cents when whole", () => {
    expect(fmtAed(599900)).toBe("AED 5,999");
    expect(fmtAed(599950)).toBe("AED 5,999.50");
    expect(fmtAed(0)).toBe("AED 0");
  });
  it("formats whole AED with thousands separators", () => {
    expect(fmtAedWhole(11999)).toBe("AED 11,999");
  });
});

describe("renewal-due window", () => {
  const now = new Date("2026-08-05T00:00:00Z");
  it("is due when overdue or within the window", () => {
    expect(isRenewalDue("2026-07-01T00:00:00Z", now)).toBe(true); // overdue
    expect(isRenewalDue("2026-08-20T00:00:00Z", now)).toBe(true); // within 30d
    expect(isRenewalDue("2026-10-01T00:00:00Z", now)).toBe(false); // far out
    expect(isRenewalDue(null, now)).toBe(false);
  });
});

describe("payment summary", () => {
  const now = new Date("2026-08-15T00:00:00Z");
  const rows: PayLite[] = [
    {
      amount: 599900,
      status: "paid",
      tier: "ascent",
      createdAt: "2026-08-02T00:00:00Z",
    }, // this month
    {
      amount: 99900,
      status: "paid",
      tier: "horizon",
      createdAt: "2026-07-20T00:00:00Z",
    }, // prior month
    {
      amount: 599900,
      status: "refunded",
      tier: "ascent",
      createdAt: "2026-08-03T00:00:00Z",
    },
    {
      amount: 1199900,
      status: "pending",
      tier: "vanguard",
      createdAt: "2026-08-10T00:00:00Z",
    },
  ];
  it("totals paid / this-month / refunded / pending and groups paid by tier", () => {
    const s = summarizePayments(rows, now);
    expect(s.paid).toBe(699800);
    expect(s.paidCount).toBe(2);
    expect(s.thisMonth).toBe(599900);
    expect(s.refunded).toBe(599900);
    expect(s.pending).toBe(1199900);
    expect(s.byTier.ascent).toEqual({ n: 1, amount: 599900 });
    expect(s.byTier.horizon).toEqual({ n: 1, amount: 99900 });
    expect(s.byTier.vanguard).toBeUndefined(); // pending, not counted as revenue
  });
});

describe("budget rollup", () => {
  const lines: BudgetLite[] = [
    { kind: "allocation", amount: 10000, status: "approved" },
    { kind: "sponsorship", amount: 5000, status: "spent" },
    { kind: "spend", amount: 4000, status: "approved" },
    { kind: "spend", amount: 2000, status: "spent" },
    { kind: "allocation", amount: 9999, status: "proposed" }, // not live → pending
    { kind: "spend", amount: 1000, status: "rejected" }, // ignored
  ];
  it("sums live allocations/sponsorships and spend, counts pending, computes remaining", () => {
    const r = rollupBudgets(lines);
    expect(r.allocated).toBe(15000);
    expect(r.spent).toBe(6000);
    expect(r.remaining).toBe(9000);
    expect(r.pendingApprovals).toBe(1);
  });
});

describe("computeRefund", () => {
  const paid = { amount: 100000, refundedAmount: 0, status: "paid" };

  it("full refund when no amount is given", () => {
    expect(computeRefund(paid)).toEqual({
      requestedMinor: 100000,
      newRefundedAmount: 100000,
      newStatus: "refunded",
    });
  });

  it("partial refund flips status to partially_refunded", () => {
    expect(computeRefund(paid, 300)).toEqual({
      requestedMinor: 30000,
      newRefundedAmount: 30000,
      newStatus: "partially_refunded",
    });
  });

  it("a second partial that completes the amount becomes refunded", () => {
    const partial = {
      amount: 100000,
      refundedAmount: 30000,
      status: "partially_refunded",
    };
    expect(computeRefund(partial, 700)).toEqual({
      requestedMinor: 70000,
      newRefundedAmount: 100000,
      newStatus: "refunded",
    });
  });

  it("rejects refunding more than remains", () => {
    expect(() =>
      computeRefund(
        { amount: 100000, refundedAmount: 80000, status: "partially_refunded" },
        300
      )
    ).toThrow(/exceeds/i);
  });

  it("rejects an already fully-refunded payment", () => {
    expect(() =>
      computeRefund({
        amount: 100000,
        refundedAmount: 100000,
        status: "refunded",
      })
    ).toThrow();
  });

  it("rejects refunding a non-paid payment", () => {
    expect(() =>
      computeRefund({ amount: 100000, refundedAmount: 0, status: "pending" })
    ).toThrow(/paid/i);
  });
});

describe("expenseNeedsApproval", () => {
  it("routes spend at or above the threshold (2000 AED) through approval", () => {
    expect(expenseNeedsApproval(2000)).toBe(true);
    expect(expenseNeedsApproval(5000)).toBe(true);
  });
  it("posts small spend directly", () => {
    expect(expenseNeedsApproval(1999)).toBe(false);
    expect(expenseNeedsApproval(1)).toBe(false);
  });
});

describe("buildFinanceReport", () => {
  const pays: ReportPay[] = [
    // June: two paid, one partially refunded
    { amount: 100000, status: "paid", tier: "core", paidAt: "2026-06-05" },
    { amount: 50000, status: "paid", tier: "zenith", paidAt: "2026-06-20" },
    {
      amount: 100000,
      status: "partially_refunded",
      tier: "core",
      paidAt: "2026-06-25",
      refundedAmount: 30000,
    },
    // July: one fully refunded, one pending, one failed
    {
      amount: 40000,
      status: "refunded",
      tier: "core",
      paidAt: "2026-07-02",
    },
    {
      amount: 60000,
      status: "pending",
      tier: "zenith",
      createdAt: "2026-07-03",
    },
    { amount: 99999, status: "failed", tier: "core", createdAt: "2026-07-04" },
  ].map(p => ({ createdAt: p.paidAt ?? "2026-01-01", ...p }) as ReportPay);

  const expenses: ReportExpense[] = [
    {
      amount: 500,
      status: "approved",
      category: "venue",
      createdAt: "2026-06-10",
    },
    {
      amount: 200,
      status: "spent",
      category: "catering",
      createdAt: "2026-06-11",
    },
    {
      amount: 900,
      status: "proposed",
      category: "venue",
      createdAt: "2026-06-12",
    }, // pending → excluded
  ];

  const r = buildFinanceReport(pays, expenses);

  it("recognises settled revenue by month and nets refunds", () => {
    const june = r.revenueByMonth.find(m => m.month === "2026-06")!;
    expect(june.grossAed).toBe(2500); // 1000 + 500 + 1000
    expect(june.refundsAed).toBe(300); // partial 300
    expect(june.netAed).toBe(2200);
    const july = r.revenueByMonth.find(m => m.month === "2026-07")!;
    expect(july.grossAed).toBe(400); // fully-refunded counted then reversed
    expect(july.refundsAed).toBe(400);
    expect(july.netAed).toBe(0);
  });

  it("ignores failed payments and tracks pending separately", () => {
    expect(r.totals.pendingAed).toBe(600);
    // failed 999.99 never enters gross
    expect(r.totals.grossAed).toBe(2900);
  });

  it("only counts live (approved/spent) expenses", () => {
    expect(r.totals.expensesAed).toBe(700); // 500 + 200, proposed excluded
    expect(r.expenseByCategory.map(e => e.category)).toContain("venue");
  });

  it("computes surplus = net revenue − expenses", () => {
    expect(r.totals.refundsAed).toBe(700); // 300 (June partial) + 400 (July full)
    expect(r.totals.netRevenueAed).toBe(2200); // 2900 gross − 700 refunds
    expect(r.totals.surplusAed).toBe(1500); // 2200 − 700 expenses
  });
});

describe("financeReportCsv", () => {
  it("renders sections and escapes cells", () => {
    const csv = financeReportCsv({
      revenueByMonth: [
        { month: "2026-06", grossAed: 1000, refundsAed: 0, netAed: 1000 },
      ],
      byTier: [{ tier: "core", grossAed: 1000, count: 1 }],
      expenseByCategory: [{ category: "venue, hall", aed: 500 }],
      totals: {
        grossAed: 1000,
        refundsAed: 0,
        netRevenueAed: 1000,
        pendingAed: 0,
        expensesAed: 500,
        surplusAed: 500,
      },
    });
    expect(csv).toContain("Revenue by month");
    expect(csv).toContain("2026-06,1000,0,1000");
    expect(csv).toContain('"venue, hall",500'); // comma-containing cell quoted
    expect(csv).toContain("Surplus (AED),500");
  });
});
