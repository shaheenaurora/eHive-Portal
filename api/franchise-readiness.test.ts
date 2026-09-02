import { describe, it, expect } from "vitest";
import {
  evaluateFranchiseReadiness,
  readinessScore,
  franchiseRequiredRoleKeys,
} from "./lib/franchise-readiness";

describe("evaluateFranchiseReadiness", () => {
  const base = {
    status: "chartered" as const,
    charterDate: new Date("2026-01-15"),
    zoneId: 3,
    memberCount: 14,
    activeRoleKeys: ["president", "treasurer", "vp_membership"],
    approvedBudgetAed: 5000,
    activeCadenceCount: 2,
  };

  it("passes every item for a fully prepared chapter", () => {
    const items = evaluateFranchiseReadiness(base);
    for (const item of items) expect(item.ok).toBe(true);
    expect(readinessScore(items)).toEqual({
      passed: items.filter(i => i.required).length,
      total: items.filter(i => i.required).length,
      ready: true,
      percent: 100,
    });
  });

  it("allows provisional chapters to qualify for charter", () => {
    const items = evaluateFranchiseReadiness({
      ...base,
      status: "provisional",
    });
    const chartered = items.find(i => i.key === "chartered");
    expect(chartered?.ok).toBe(true);
  });

  it("fails when the chapter is too early (seed) or distressed (at_risk)", () => {
    const seed = evaluateFranchiseReadiness({ ...base, status: "seed" });
    expect(seed.find(i => i.key === "chartered")?.ok).toBe(false);
    const atRisk = evaluateFranchiseReadiness({ ...base, status: "at_risk" });
    expect(atRisk.find(i => i.key === "chartered")?.ok).toBe(false);
  });

  it("fails when required officers are missing", () => {
    const items = evaluateFranchiseReadiness({
      ...base,
      activeRoleKeys: ["vp_membership"],
    });
    expect(items.find(i => i.key === "role_president")?.ok).toBe(false);
    expect(items.find(i => i.key === "role_treasurer")?.ok).toBe(false);
    expect(items.find(i => i.key === "role_president")?.detail).toContain(
      "President"
    );
  });

  it("fails when membership is below the chartered minimum", () => {
    const items = evaluateFranchiseReadiness({ ...base, memberCount: 5 });
    const members = items.find(i => i.key === "member_count");
    expect(members?.ok).toBe(false);
    expect(members?.detail).toContain("5 members");
  });

  it("fails without an approved budget", () => {
    const items = evaluateFranchiseReadiness({ ...base, approvedBudgetAed: 0 });
    expect(items.find(i => i.key === "approved_budget")?.ok).toBe(false);
  });

  it("fails without active cadences", () => {
    const items = evaluateFranchiseReadiness({
      ...base,
      activeCadenceCount: 0,
    });
    expect(items.find(i => i.key === "cadence")?.ok).toBe(false);
  });

  it("fails without a zone assignment", () => {
    const items = evaluateFranchiseReadiness({ ...base, zoneId: null });
    expect(items.find(i => i.key === "zone_assigned")?.ok).toBe(false);
  });

  it("fails without a charter date", () => {
    const items = evaluateFranchiseReadiness({ ...base, charterDate: null });
    expect(items.find(i => i.key === "charter_date")?.ok).toBe(false);
  });
});

describe("readinessScore", () => {
  it("returns ready only when every required item passes", () => {
    const allPass = evaluateFranchiseReadiness({
      status: "mature",
      charterDate: new Date(),
      zoneId: 1,
      memberCount: 20,
      activeRoleKeys: ["president", "treasurer"],
      approvedBudgetAed: 1000,
      activeCadenceCount: 1,
    });
    expect(readinessScore(allPass).ready).toBe(true);
    expect(readinessScore(allPass).percent).toBe(100);

    const oneFail = evaluateFranchiseReadiness({
      status: "mature",
      charterDate: new Date(),
      zoneId: 1,
      memberCount: 20,
      activeRoleKeys: ["president", "treasurer"],
      approvedBudgetAed: 0,
      activeCadenceCount: 1,
    });
    expect(readinessScore(oneFail).ready).toBe(false);
    expect(readinessScore(oneFail).percent).toBeLessThan(100);
  });
});

describe("franchiseRequiredRoleKeys", () => {
  it("lists president and treasurer as required", () => {
    expect(franchiseRequiredRoleKeys()).toEqual(["president", "treasurer"]);
  });
});
