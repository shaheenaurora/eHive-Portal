import { describe, it, expect } from "vitest";
import { hasScope, isFullAdmin } from "./middleware";

const owner = { role: "admin", adminScopes: "*" };
const legacyFull = { role: "admin", adminScopes: "" };
const membershipHead = { role: "admin", adminScopes: "membership" };
const multiHead = { role: "admin", adminScopes: "events,community" };
const member = { role: "user", adminScopes: "" };

describe("admin capability scopes (segregation of duties)", () => {
  it("owner (*) and legacy full ('') hold every capability", () => {
    for (const scope of ["membership", "finance", "conduct", "chapters"]) {
      expect(hasScope(owner, scope)).toBe(true);
      expect(hasScope(legacyFull, scope)).toBe(true);
    }
    expect(isFullAdmin(owner)).toBe(true);
    expect(isFullAdmin(legacyFull)).toBe(true);
  });

  it("a single-scope head only holds their own capability", () => {
    expect(hasScope(membershipHead, "membership")).toBe(true);
    expect(hasScope(membershipHead, "finance")).toBe(false);
    expect(hasScope(membershipHead, "conduct")).toBe(false);
    expect(hasScope(membershipHead, "events")).toBe(false);
    expect(isFullAdmin(membershipHead)).toBe(false);
  });

  it("a multi-scope admin holds each listed capability but no others", () => {
    expect(hasScope(multiHead, "events")).toBe(true);
    expect(hasScope(multiHead, "community")).toBe(true);
    expect(hasScope(multiHead, "membership")).toBe(false);
    expect(isFullAdmin(multiHead)).toBe(false);
  });

  it("a non-admin holds no capability regardless of scope string", () => {
    expect(hasScope(member, "membership")).toBe(false);
    expect(hasScope({ role: "user", adminScopes: "*" }, "membership")).toBe(
      false
    );
    expect(isFullAdmin(member)).toBe(false);
  });

  it("ignores surrounding whitespace in the scope list", () => {
    const spaced = { role: "admin", adminScopes: " membership , finance " };
    expect(hasScope(spaced, "membership")).toBe(true);
    expect(hasScope(spaced, "finance")).toBe(true);
    expect(hasScope(spaced, "events")).toBe(false);
  });
});
