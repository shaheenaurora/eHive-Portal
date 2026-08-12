import { describe, it, expect } from "vitest";
import {
  fmtAed,
  fmtAedWhole,
  isRenewalDue,
  summarizePayments,
  rollupBudgets,
  type PayLite,
  type BudgetLite,
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
