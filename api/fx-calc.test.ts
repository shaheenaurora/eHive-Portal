import { describe, it, expect } from "vitest";
import { convertToBaseMinor, FX_RATE_SCALE } from "@contracts/constants";

describe("convertToBaseMinor", () => {
  it("returns the amount unchanged at the base rate (scale)", () => {
    expect(convertToBaseMinor(10000, FX_RATE_SCALE)).toBe(10000);
  });

  it("converts a foreign amount to base using the scaled rate", () => {
    // 1 USD = 3.67 AED → rateScaled = 3.67 * scale. 100.00 USD (10000 minor)
    // → 367.00 AED (36700 minor).
    const rate = Math.round(3.67 * FX_RATE_SCALE);
    expect(convertToBaseMinor(10000, rate)).toBe(36700);
  });

  it("rounds to the nearest base minor unit", () => {
    // rate 1.005 on 1 minor unit → 1.005 → rounds to 1.
    const rate = Math.round(1.005 * FX_RATE_SCALE);
    expect(convertToBaseMinor(1, rate)).toBe(1);
    // 3 minor units → 3.015 → 3.
    expect(convertToBaseMinor(3, rate)).toBe(3);
    // 100 minor → 100.5 → 101 (round half up).
    expect(convertToBaseMinor(100, rate)).toBe(101);
  });

  it("handles a sub-unit (weak) currency rate", () => {
    // 1 INR = 0.044 AED. 100000 minor (1000.00 INR) → 4400 minor (44.00 AED).
    const rate = Math.round(0.044 * FX_RATE_SCALE);
    expect(convertToBaseMinor(100000, rate)).toBe(4400);
  });
});
