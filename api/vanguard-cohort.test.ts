import { describe, it, expect } from "vitest";
import {
  vanguardSetting,
  VANGUARD_FOUNDING_CAP,
  VANGUARD_FOUNDING_PRICE_AED,
} from "@contracts/constants";

describe("vanguard cohort settings", () => {
  it("uses the fallback when no override is set", () => {
    expect(vanguardSetting(null, VANGUARD_FOUNDING_CAP)).toBe(40);
    expect(vanguardSetting(undefined, VANGUARD_FOUNDING_PRICE_AED)).toBe(12000);
  });

  it("accepts a valid override", () => {
    expect(vanguardSetting("50", VANGUARD_FOUNDING_CAP)).toBe(50);
    expect(vanguardSetting("15000", VANGUARD_FOUNDING_PRICE_AED)).toBe(15000);
  });

  it("rejects junk / out-of-range and falls back", () => {
    expect(vanguardSetting("abc", 40)).toBe(40);
    expect(vanguardSetting("0", 40, { min: 1 })).toBe(40);
    expect(vanguardSetting("-5", 40)).toBe(40);
    expect(vanguardSetting("", 40)).toBe(40);
  });

  it("floors fractional overrides", () => {
    expect(vanguardSetting("40.9", 40)).toBe(40);
  });
});
