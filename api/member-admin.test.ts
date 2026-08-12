import { describe, it, expect } from "vitest";
import {
  violatesFourEyes,
  canApprove,
  mergeActivity,
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
