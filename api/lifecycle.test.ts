import { describe, it, expect } from "vitest";
import { canTransitionLifecycle, statusForLifecycle } from "./lib/lifecycle";
import { MEMBER_LIFECYCLE_TRANSITIONS } from "@contracts/constants";

describe("lifecycle transition matrix", () => {
  it("allows every admin-defined transition", () => {
    for (const [from, arrows] of Object.entries(MEMBER_LIFECYCLE_TRANSITIONS)) {
      for (const { to } of arrows) {
        expect(canTransitionLifecycle(from, to)).toBe(true);
      }
    }
  });

  it("allows auto-only transitions used by schedulers and win-backs", () => {
    expect(canTransitionLifecycle("active", "lapsed")).toBe(true);
    expect(canTransitionLifecycle("lapsed", "active")).toBe(true);
    expect(canTransitionLifecycle("alumni", "active")).toBe(true);
  });

  it("rejects nonsensical jumps", () => {
    expect(canTransitionLifecycle("prospect", "active")).toBe(false);
    expect(canTransitionLifecycle("alumni", "renewal")).toBe(false);
    expect(canTransitionLifecycle("suspended", "lapsed")).toBe(false);
    expect(canTransitionLifecycle("lapsed", "suspended")).toBe(false);
    expect(canTransitionLifecycle("onboarding", "alumni")).toBe(false);
  });

  it("no-op transitions are always allowed", () => {
    expect(canTransitionLifecycle("active", "active")).toBe(true);
    expect(canTransitionLifecycle(null, "active")).toBe(true);
    expect(canTransitionLifecycle(undefined, "active")).toBe(true);
  });
});

describe("status coherency for lifecycle states", () => {
  it("maps active journey states to active billing status", () => {
    expect(statusForLifecycle("active")).toBe("active");
    expect(statusForLifecycle("onboarding")).toBe("active");
    expect(statusForLifecycle("renewal")).toBe("active");
    expect(statusForLifecycle("at_risk")).toBe("active");
  });

  it("maps suspended to paused", () => {
    expect(statusForLifecycle("suspended")).toBe("paused");
  });

  it("maps terminal/exit states to cancelled", () => {
    expect(statusForLifecycle("alumni")).toBe("cancelled");
    expect(statusForLifecycle("lapsed")).toBe("cancelled");
  });
});
