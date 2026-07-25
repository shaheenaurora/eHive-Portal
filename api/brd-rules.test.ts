import { describe, it, expect } from "vitest";
import {
  TIERS,
  TIER_PRICE,
  POINT_RULE_DEFAULTS,
  ZENITH_CAP,
  BUDDY_PAIR_WITHIN_DAYS,
  DORMANCY_STAGES,
} from "@contracts/constants";

/**
 * Guards the consolidated business rules in the eHive Portal BRD §7.
 * These values are approved business rules — a failing assertion here means a
 * code change has drifted from the BRD and needs a change request, not a test edit.
 */
describe("BRD §7.1 — membership tiers", () => {
  it("defines the four tiers in ascending order", () => {
    expect([...TIERS]).toEqual(["horizon", "ascent", "vanguard", "zenith"]);
  });

  it("prices each tier per the BRD (AED / year)", () => {
    expect(TIER_PRICE.horizon).toBe("AED 999/yr");
    expect(TIER_PRICE.ascent).toBe("AED 5,999/yr");
    expect(TIER_PRICE.vanguard).toBe("AED 11,999/yr");
    expect(TIER_PRICE.zenith).toBe("AED 29,999/yr");
  });
});

describe("BRD §7.2 — Hive Score point rules (default values)", () => {
  it("matches the approved default point values", () => {
    expect(POINT_RULE_DEFAULTS).toMatchObject({
      event_attend: 5,
      session_attend: 5,
      one_to_one: 3,
      mentoring: 15,
      referral_submitted: 5,
      referral_converted: 10,
      no_show: -10,
      no_show_excused: -5,
    });
  });
});

describe("BRD §6.3 / §6.6 — engagement & admissions caps", () => {
  it("caps Zenith at 50 members", () => {
    expect(ZENITH_CAP).toBe(50);
  });

  it("pairs new members with a buddy within 5 business days", () => {
    expect(BUDDY_PAIR_WITHIN_DAYS).toBe(5);
  });
});

describe("BRD §7.4 — Dormancy Ladder", () => {
  it("progresses Active → At Risk → Dormant → Non-Renewal", () => {
    expect([...DORMANCY_STAGES]).toEqual(["active", "at_risk", "dormant", "non_renewal"]);
  });
});
