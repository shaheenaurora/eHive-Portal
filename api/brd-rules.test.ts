import { describe, it, expect } from "vitest";
import {
  TIERS,
  TIER_PRICE,
  POINT_RULE_DEFAULTS,
  ZENITH_CAP,
  BUDDY_PAIR_WITHIN_DAYS,
  DORMANCY_STAGES,
  eventEligibleTiers,
  memberCanAccessEvent,
  EVENT_CHECKIN_OPENS_BEFORE_MS,
  EVENT_CHECKIN_CLOSES_AFTER_MS,
  renewalStage,
  memberBadges,
  MEMBER_LIFECYCLE,
  MEMBER_LIFECYCLE_TRANSITIONS,
  HEALTH_COMPONENTS,
  HEALTH_BAR,
  healthBand,
  SAVE_PLAYBOOK_STEPS,
} from "@contracts/constants";
import { periodKey, recentPeriodKeys, shiftPeriods, CADENCE_TEMPLATES } from "@contracts/cadence";

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

describe("Activity audience governance", () => {
  it("opens 'members'/'public' activities to every tier at or above the gate", () => {
    expect(eventEligibleTiers({ audience: "members", tierGate: "horizon" })).toEqual([...TIERS]);
    expect(eventEligibleTiers({ audience: "public", tierGate: "horizon" })).toEqual([...TIERS]);
    expect(eventEligibleTiers({ audience: "members", tierGate: "vanguard" })).toEqual(["vanguard", "zenith"]);
  });

  it("restricts 'tiers' activities to exactly the named set", () => {
    const ev = { audience: "tiers", audienceTiers: "vanguard,zenith", tierGate: "vanguard" };
    expect(eventEligibleTiers(ev)).toEqual(["vanguard", "zenith"]);
    expect(memberCanAccessEvent("horizon", ev)).toBe(false);
    expect(memberCanAccessEvent("ascent", ev)).toBe(false);
    expect(memberCanAccessEvent("vanguard", ev)).toBe(true);
    expect(memberCanAccessEvent("zenith", ev)).toBe(true);
  });
});

describe("Member Lifecycle — the CRM state machine (M1)", () => {
  const keys = new Set<string>(MEMBER_LIFECYCLE.map((s) => s.key));

  it("covers the ten lifecycle states from the operations manual", () => {
    expect([...keys]).toEqual([
      "prospect", "guest", "applicant", "onboarding", "active",
      "at_risk", "renewal", "lapsed", "alumni", "suspended",
    ]);
  });

  it("only allows transitions to real states", () => {
    for (const [from, arrows] of Object.entries(MEMBER_LIFECYCLE_TRANSITIONS)) {
      expect(keys.has(from)).toBe(true);
      for (const a of arrows) expect(keys.has(a.to)).toBe(true);
    }
  });

  it("routes admission and the save/renewal arrows correctly", () => {
    expect(MEMBER_LIFECYCLE_TRANSITIONS.applicant.map((a) => a.to)).toContain("onboarding");
    expect(MEMBER_LIFECYCLE_TRANSITIONS.at_risk.map((a) => a.to)).toContain("active"); // saved
    expect(MEMBER_LIFECYCLE_TRANSITIONS.renewal.map((a) => a.to)).toEqual(["active", "lapsed"]);
    expect(MEMBER_LIFECYCLE_TRANSITIONS.lapsed.map((a) => a.to)).toContain("alumni");
  });
});

describe("Chapter Health Index (M7 / CH-06)", () => {
  it("blends the six manual measures with weights summing to 100", () => {
    expect(HEALTH_COMPONENTS.map((c) => c.key)).toEqual([
      "retention", "engagement", "growth", "programme", "leadership", "governance",
    ]);
    expect(HEALTH_COMPONENTS.reduce((s, c) => s + c.weight, 0)).toBe(100);
  });

  it("bands the index — below the bar triggers remediation", () => {
    expect(healthBand(82)).toBe("healthy");
    expect(healthBand(HEALTH_BAR)).toBe("watch");
    expect(healthBand(HEALTH_BAR - 1)).toBe("below");
  });
});

describe("Operating rhythm — cadence period math (§A2)", () => {
  it("keys each frequency to a distinct, stable period", () => {
    const d = new Date("2026-07-15T12:00:00Z");
    expect(periodKey("monthly", d)).toBe("2026-07");
    expect(periodKey("quarterly", d)).toBe("2026-Q3");
    expect(periodKey("annually", d)).toBe("2026");
    expect(periodKey("weekly", d)).toMatch(/^2026-W\d\d$/);
    expect(periodKey("biweekly", d)).toMatch(/^2026-B\d\d$/);
  });

  it("shifting one period changes the key; the same period keeps it", () => {
    const d = new Date("2026-07-15T12:00:00Z");
    expect(periodKey("monthly", shiftPeriods("monthly", d, -1))).toBe("2026-06");
    expect(periodKey("quarterly", shiftPeriods("quarterly", d, -1))).toBe("2026-Q2");
    expect(periodKey("weekly", shiftPeriods("weekly", d, 0))).toBe(periodKey("weekly", d));
  });

  it("recentPeriodKeys returns the current plus N distinct past periods", () => {
    const { current, history } = recentPeriodKeys("monthly", new Date("2026-07-15T12:00:00Z"), 8);
    expect(current).toBe("2026-07");
    expect(history).toHaveLength(8);
    expect(new Set(history).size).toBe(8);           // all distinct
    expect(history).not.toContain(current);          // history excludes current
  });

  it("ships the standard chapter cadences with valid frequencies", () => {
    expect(CADENCE_TEMPLATES.length).toBeGreaterThanOrEqual(6);
    expect(CADENCE_TEMPLATES.map((t) => t.type)).toContain("chapter_meeting");
    for (const t of CADENCE_TEMPLATES)
      expect(["weekly", "biweekly", "monthly", "quarterly", "annually"]).toContain(t.freq);
  });
});

describe("Event check-in temporal integrity", () => {
  // Regression: a member could mark ATTENDED on an event that hadn't happened.
  const start = Date.parse("2026-07-26T17:30:00Z");
  const withinWindow = (now: number) =>
    now >= start - EVENT_CHECKIN_OPENS_BEFORE_MS && now <= start + EVENT_CHECKIN_CLOSES_AFTER_MS;

  it("rejects check-in well before the event starts", () => {
    expect(withinWindow(start - 5 * 60 * 60 * 1000)).toBe(false); // 5h early
  });
  it("allows check-in at the door (from 2h before to during)", () => {
    expect(withinWindow(start - 30 * 60 * 1000)).toBe(true); // 30m before
    expect(withinWindow(start + 60 * 60 * 1000)).toBe(true); // 1h in
  });
  it("closes check-in after the event window ends", () => {
    expect(withinWindow(start + 24 * 60 * 60 * 1000)).toBe(false); // next day
  });
});

describe("ML-05 renewal window (renewalStage)", () => {
  const now = new Date("2026-07-29T00:00:00Z");
  const days = (n: number) => new Date(now.getTime() + n * 86_400_000);
  it("is 'none' well before the window", () => {
    expect(renewalStage(days(60), now)).toBe("none"); // 60d out, window is 30
  });
  it("opens the window inside 30 days", () => {
    expect(renewalStage(days(20), now)).toBe("window");
    expect(renewalStage(days(0), now)).toBe("window"); // due today
  });
  it("stays 'window' during the grace period after the due date", () => {
    expect(renewalStage(days(-10), now)).toBe("window"); // 10d overdue, grace 14
  });
  it("lapses past the grace period", () => {
    expect(renewalStage(days(-15), now)).toBe("lapse"); // beyond 14d grace
  });
});

describe("M10 recognition badges (memberBadges)", () => {
  const now = new Date("2026-07-29T00:00:00Z");
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
  it("awards a tenure badge and a contribution badge from real data", () => {
    expect(memberBadges({ createdAt: ago(365 * 2 + 30), hiveScore: 85 }, now)).toEqual(["2 Years", "Top Contributor"]);
  });
  it("flags a newcomer with a modest score as just Newcomer", () => {
    expect(memberBadges({ createdAt: ago(20), hiveScore: 40 }, now)).toEqual(["Newcomer"]);
  });
  it("gives no tenure badge between 90 days and a year", () => {
    expect(memberBadges({ createdAt: ago(200), hiveScore: 65 }, now)).toEqual(["Active Contributor"]);
  });
});

describe("ML-04b — Save Playbook (at-risk intervention)", () => {
  it("defines the five ordered save steps from the operations manual", () => {
    expect(SAVE_PLAYBOOK_STEPS.map((s) => s.key)).toEqual([
      "reach_out", "diagnose", "remap_value", "next_step", "confirm",
    ]);
  });
  it("makes re-engagement the final step — a save is only real once they come back", () => {
    expect(SAVE_PLAYBOOK_STEPS.at(-1)?.key).toBe("confirm");
  });
  it("a full step bitmask marks every step complete", () => {
    const full = (1 << SAVE_PLAYBOOK_STEPS.length) - 1;
    const done = SAVE_PLAYBOOK_STEPS.filter((_, i) => (full & (1 << i)) !== 0).length;
    expect(done).toBe(SAVE_PLAYBOOK_STEPS.length);
  });
});
