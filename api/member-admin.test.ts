import { describe, it, expect } from "vitest";
import {
  violatesFourEyes,
  canApprove,
  mergeActivity,
  canChangeTier,
  HIGH_IMPACT,
  type Actor,
  type Activity,
} from "./lib/member-change";

const full: Actor = {
  id: 1,
  email: "owner@ehive.ae",
  role: "admin",
  adminScopes: "*",
};
const legacyFull: Actor = {
  id: 2,
  email: "dir@ehive.ae",
  role: "admin",
  adminScopes: "",
};
const membershipHead: Actor = {
  id: 3,
  email: "mem@ehive.ae",
  role: "admin",
  adminScopes: "membership",
};
const eventsHead: Actor = {
  id: 4,
  email: "ev@ehive.ae",
  role: "admin",
  adminScopes: "events",
};
const chapterLead: Actor = {
  id: 5,
  email: "lead@ehive.ae",
  role: "user",
  adminScopes: "",
};
const plainMember: Actor = {
  id: 6,
  email: "m@ehive.ae",
  role: "user",
  adminScopes: "",
};

describe("member change-request governance", () => {
  it("four-eyes: a person cannot approve their own request", () => {
    expect(violatesFourEyes(5, 5)).toBe(true);
    expect(violatesFourEyes(5, 9)).toBe(false);
  });

  it("high-impact categories are exactly tier/status/lifecycle", () => {
    expect([...HIGH_IMPACT].sort()).toEqual(["lifecycle", "status", "tier"]);
    expect(HIGH_IMPACT.has("tier")).toBe(true);
    expect(HIGH_IMPACT.has("profile" as never)).toBe(false);
    expect(HIGH_IMPACT.has("chapter" as never)).toBe(false);
  });

  it("full and membership admins may approve regardless of chapter", () => {
    expect(canApprove(full, { leadsMemberChapter: false })).toBe(true);
    expect(canApprove(legacyFull, { leadsMemberChapter: false })).toBe(true);
    expect(canApprove(membershipHead, { leadsMemberChapter: false })).toBe(
      true
    );
  });

  it("a non-membership admin may NOT approve unless they lead the member's chapter", () => {
    expect(canApprove(eventsHead, { leadsMemberChapter: false })).toBe(false);
    expect(canApprove(eventsHead, { leadsMemberChapter: true })).toBe(true);
  });

  it("a chapter lead (non-admin) may approve only for their own chapter's member", () => {
    expect(canApprove(chapterLead, { leadsMemberChapter: true })).toBe(true);
    expect(canApprove(chapterLead, { leadsMemberChapter: false })).toBe(false);
  });

  it("a plain member may never approve", () => {
    expect(canApprove(plainMember, { leadsMemberChapter: false })).toBe(false);
  });
});

describe("member activity ledger merge", () => {
  const mk = (t: string, title: string): Activity => ({
    at: new Date(t),
    kind: "x",
    icon: "•",
    title,
  });

  it("merges streams newest-first and drops invalid dates", () => {
    const a = [
      mk("2026-01-01", "old"),
      { at: new Date("not-a-date"), kind: "x", icon: "•", title: "bad" },
    ];
    const b = [mk("2026-06-01", "new"), mk("2026-03-01", "mid")];
    const out = mergeActivity([a, b]);
    expect(out.map(e => e.title)).toEqual(["new", "mid", "old"]);
    expect(out.some(e => e.title === "bad")).toBe(false);
  });

  it("returns an empty array for empty input", () => {
    expect(mergeActivity([])).toEqual([]);
    expect(mergeActivity([[], []])).toEqual([]);
  });
});

describe("tier-change business rules", () => {
  const member = (tier: string, daysAgo: number, status = "active") => ({
    status,
    tier,
    createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
  });

  it("allows a change after the minimum tenure", () => {
    const m = member("horizon", 100);
    expect(canChangeTier(m, "ascent", []).ok).toBe(true);
  });

  it("blocks a change before the minimum tenure", () => {
    const m = member("horizon", 10);
    expect(canChangeTier(m, "ascent", []).ok).toBe(false);
  });

  it("blocks change for non-active members", () => {
    const m = member("horizon", 100, "paused");
    expect(canChangeTier(m, "ascent", []).ok).toBe(false);
  });

  it("blocks self-serve zenith requests", () => {
    const m = member("vanguard", 100);
    expect(canChangeTier(m, "zenith", [], { isSelfServe: true }).ok).toBe(
      false
    );
  });

  it("blocks downgrade within the upgrade cooldown", () => {
    const m = member("ascent", 100);
    const history = [
      {
        type: "upgrade",
        toTier: "ascent" as const,
        createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      },
    ];
    expect(canChangeTier(m, "horizon", history).ok).toBe(false);
  });

  it("allows downgrade after the upgrade cooldown", () => {
    const m = member("ascent", 200);
    const history = [
      {
        type: "upgrade",
        toTier: "ascent" as const,
        createdAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
      },
    ];
    expect(canChangeTier(m, "horizon", history).ok).toBe(true);
  });
});
