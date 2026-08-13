import { describe, it, expect } from "vitest";
import { canTransitionLifecycle, statusForLifecycle } from "./lib/lifecycle";

describe("canTransitionLifecycle", () => {
  it("allows a member to self-cancel (→ lapsed) from any live state", () => {
    expect(canTransitionLifecycle("onboarding", "lapsed")).toBe(true);
    expect(canTransitionLifecycle("active", "lapsed")).toBe(true);
    expect(canTransitionLifecycle("at_risk", "lapsed")).toBe(true);
    expect(canTransitionLifecycle("renewal", "lapsed")).toBe(true); // admin arrow
  });

  it("allows paid win-back for lapsed and alumni (→ active)", () => {
    expect(canTransitionLifecycle("lapsed", "active")).toBe(true);
    expect(canTransitionLifecycle("alumni", "active")).toBe(true);
  });

  it("does not let a suspended member self-reactivate by lapsing/winning back", () => {
    // Suspended only moves via admin arrows (reinstate / remove-to-alumni).
    expect(canTransitionLifecycle("suspended", "lapsed")).toBe(false);
    expect(canTransitionLifecycle("suspended", "active")).toBe(true); // admin reinstate
    expect(canTransitionLifecycle("suspended", "alumni")).toBe(true); // admin remove
  });

  it("admits an applicant into onboarding", () => {
    expect(canTransitionLifecycle("applicant", "onboarding")).toBe(true);
  });

  it("treats a new record (no prior state) and no-ops as valid", () => {
    expect(canTransitionLifecycle(null, "onboarding")).toBe(true);
    expect(canTransitionLifecycle("active", "active")).toBe(true);
  });
});

describe("statusForLifecycle", () => {
  it("keeps access active through the onboarding → renewal journey", () => {
    for (const s of ["active", "onboarding", "renewal", "at_risk"])
      expect(statusForLifecycle(s)).toBe("active");
  });

  it("pauses a suspended member and cancels lapsed/alumni", () => {
    expect(statusForLifecycle("suspended")).toBe("paused");
    expect(statusForLifecycle("lapsed")).toBe("cancelled");
    expect(statusForLifecycle("alumni")).toBe("cancelled");
  });
});
