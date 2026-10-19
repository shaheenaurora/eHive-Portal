import { describe, it, expect } from "vitest";
import {
  normalizeReportDims,
  recomputeReportTotal,
  REPORT_DIM_DEFAULT_MAX,
} from "./report-total";

describe("normalizeReportDims", () => {
  it("normalises the scorecard-style {key, raw} shape", () => {
    const dims = normalizeReportDims([
      { key: "Marketing", raw: 6 },
      { key: "Finance", raw: 8 },
    ]);
    expect(dims).toEqual([
      { key: "Marketing", label: null, score: 6, max: 10, pct: 60, weight: 1 },
      { key: "Finance", label: null, score: 8, max: 10, pct: 80, weight: 1 },
    ]);
  });

  it("honours explicit max and weight", () => {
    const dims = normalizeReportDims([
      { key: "a", score: 5, max: 20, weight: 3, label: "Area A" },
    ]);
    expect(dims).toEqual([
      { key: "a", label: "Area A", score: 5, max: 20, pct: 25, weight: 3 },
    ]);
  });

  it("clamps out-of-range scores and bad weights", () => {
    const dims = normalizeReportDims([
      { key: "over", score: 15, max: 10 },
      { key: "under", score: -4, max: 10 },
      { key: "zerow", score: 5, weight: 0 },
    ]);
    expect(dims?.map(d => d.score)).toEqual([10, 0, 5]);
    expect(dims?.map(d => d.pct)).toEqual([100, 0, 50]);
    expect(dims?.map(d => d.weight)).toEqual([1, 1, 1]);
  });

  it("generates keys when missing", () => {
    const dims = normalizeReportDims([{ score: 5 }, { score: 6 }]);
    expect(dims?.map(d => d.key)).toEqual(["dim1", "dim2"]);
  });

  it("rejects unusable input", () => {
    expect(normalizeReportDims(null)).toBeNull();
    expect(normalizeReportDims([])).toBeNull();
    expect(normalizeReportDims("nope")).toBeNull();
    expect(normalizeReportDims([null])).toBeNull();
    expect(normalizeReportDims([{ key: "a" }])).toBeNull();
    expect(normalizeReportDims([{ score: Number.NaN }])).toBeNull();
    expect(normalizeReportDims([{ score: 5, max: 0 }])).toBeNull();
    expect(normalizeReportDims([[{ score: 5 }]])).toBeNull();
  });

  it("defaults to the 0–10 scale", () => {
    expect(REPORT_DIM_DEFAULT_MAX).toBe(10);
  });
});

describe("recomputeReportTotal", () => {
  it("averages pcts with equal weights", () => {
    const dims = normalizeReportDims([
      { key: "a", score: 5 },
      { key: "b", score: 10 },
    ]);
    expect(dims && recomputeReportTotal(dims)).toBe(75);
  });

  it("computes a weighted mean so heavy dims dominate", () => {
    const dims = normalizeReportDims([
      { key: "a", score: 0, weight: 3 },
      { key: "b", score: 10, weight: 1 },
    ]);
    // (0*3 + 100*1) / 4 = 25 — not the unweighted 50.
    expect(dims && recomputeReportTotal(dims)).toBe(25);
  });

  it("clamps the total into 0–100", () => {
    const perfect = normalizeReportDims([{ key: "a", score: 10 }]);
    expect(perfect && recomputeReportTotal(perfect)).toBe(100);
    const zero = normalizeReportDims([{ key: "a", score: 0 }]);
    expect(zero && recomputeReportTotal(zero)).toBe(0);
  });

  it("an empty dim list scores 0", () => {
    expect(recomputeReportTotal([])).toBe(0);
  });
});
