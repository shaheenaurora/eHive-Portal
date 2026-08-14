import { describe, it, expect } from "vitest";
import {
  DEFAULT_PANEL_RUBRIC,
  parseRubric,
  validateRubric,
  weightedTotal,
  averageScore,
  type RubricCriterion,
} from "./lib/awards-scoring";

describe("validateRubric", () => {
  it("accepts weights summing to 100 with unique keys", () => {
    expect(validateRubric(DEFAULT_PANEL_RUBRIC).ok).toBe(true);
  });
  it("rejects a non-100 weight sum", () => {
    expect(validateRubric([{ key: "a", label: "A", weight: 60 }]).ok).toBe(
      false
    );
  });
  it("rejects duplicate keys", () => {
    const r: RubricCriterion[] = [
      { key: "a", label: "A", weight: 50 },
      { key: "a", label: "A2", weight: 50 },
    ];
    expect(validateRubric(r).ok).toBe(false);
  });
  it("rejects an empty rubric or negative weights", () => {
    expect(validateRubric([]).ok).toBe(false);
    expect(
      validateRubric([
        { key: "a", label: "A", weight: -10 },
        { key: "b", label: "B", weight: 110 },
      ]).ok
    ).toBe(false);
  });
});

describe("parseRubric", () => {
  it("falls back to the default for null/invalid JSON", () => {
    expect(parseRubric(null)).toEqual(DEFAULT_PANEL_RUBRIC);
    expect(parseRubric("not json")).toEqual(DEFAULT_PANEL_RUBRIC);
    expect(parseRubric("[]")).toEqual(DEFAULT_PANEL_RUBRIC);
    // valid shape but weights don't sum to 100 → fall back
    expect(
      parseRubric(JSON.stringify([{ key: "a", label: "A", weight: 30 }]))
    ).toEqual(DEFAULT_PANEL_RUBRIC);
  });
  it("returns a valid custom rubric", () => {
    const r = [
      { key: "x", label: "X", weight: 70 },
      { key: "y", label: "Y", weight: 30 },
    ];
    expect(parseRubric(JSON.stringify(r))).toEqual(r);
  });
});

describe("weightedTotal", () => {
  const rubric: RubricCriterion[] = [
    { key: "merit", label: "Merit", weight: 40 },
    { key: "impact", label: "Impact", weight: 35 },
    { key: "evidence", label: "Evidence", weight: 25 },
  ];
  it("computes the rubric-weighted total", () => {
    // 90*40 + 80*35 + 60*25 = 3600 + 2800 + 1500 = 7900 / 100 = 79
    expect(
      weightedTotal(
        [
          { key: "merit", value: 90 },
          { key: "impact", value: 80 },
          { key: "evidence", value: 60 },
        ],
        rubric
      )
    ).toBe(79);
  });
  it("treats missing criteria as 0 and clamps out-of-range values", () => {
    // merit 100 (clamped from 120), others 0 → 100*40/100 = 40
    expect(weightedTotal([{ key: "merit", value: 120 }], rubric)).toBe(40);
  });
});

describe("averageScore", () => {
  it("averages judge totals, rounded", () => {
    expect(averageScore([80, 90, 70])).toBe(80);
    expect(averageScore([79, 80])).toBe(80); // 79.5 → 80
    expect(averageScore([])).toBe(0);
  });
});
