import { describe, it, expect } from "vitest";
import { buildScorecardReport } from "./scorecard";

const domains = (pcts: number[]) =>
  pcts.map((p, i) => ({ key: `D${i}`, raw: p, pct: p }));

describe("buildScorecardReport — weak-point flagging", () => {
  it("flags nothing on a perfect 100/100 (regression: showed all areas as alerts)", () => {
    const r = buildScorecardReport({ total: 100, domains: domains([100, 100, 100, 100, 100, 100, 100, 100]) })!;
    expect(r.weakest).toHaveLength(0);
    expect(r.strongest).toHaveLength(0);
    expect(r.recommendation.product).toBe("Momentum90");
    expect(r.recommendation.why).not.toMatch(/tie|bottom|weak/i);
  });

  it("does not flag a healthy lowest area even when scores differ", () => {
    // lowest is 90% — strong; nothing should be marked as a weak point.
    const r = buildScorecardReport({ total: 95, domains: domains([100, 100, 90, 100]) })!;
    expect(r.weakest).toHaveLength(0);
    expect(r.strongest.length).toBeGreaterThan(0); // there IS a spread → strengths shown
  });

  it("flags the genuine weak area when one lags below the solid band", () => {
    const r = buildScorecardReport({ total: 70, domains: domains([90, 88, 40, 85]) })!;
    expect(r.weakest.map((d) => d.raw)).toEqual([40]);
    expect(r.recommendation.product).toBeTruthy();
  });

  it("recommends a diagnostic when several areas are genuinely weak", () => {
    const r = buildScorecardReport({ total: 40, domains: domains([30, 30, 30, 90]) })!;
    expect(r.weakest.length).toBeGreaterThanOrEqual(3);
    expect(r.recommendation.product).toBe("GapNavigator");
  });
});
