import { describe, it, expect } from "vitest";
import {
  membershipNo,
  cpdTotal,
  membershipValidThrough,
} from "./lib/member-docs";

describe("membershipNo", () => {
  it("uses the unified member reference code (EH-M-XXXXX)", () => {
    expect(membershipNo(19)).toBe("EH-M-00019");
    expect(membershipNo(1)).toBe("EH-M-00001");
    expect(membershipNo(123456)).toBe("EH-M-123456");
  });
  it("never produces a negative id", () => {
    expect(membershipNo(-5)).toBe("EH-M-00000");
  });
});

describe("cpdTotal", () => {
  it("sums CPD credits, treating null/undefined as zero", () => {
    expect(
      cpdTotal([{ cpdCredits: 3 }, { cpdCredits: 2 }, { cpdCredits: null }, {}])
    ).toBe(5);
  });
  it("is zero for no attended events", () => {
    expect(cpdTotal([])).toBe(0);
  });
});

describe("membershipValidThrough", () => {
  it("returns this year's anniversary when it is still ahead", () => {
    const joined = new Date("2020-06-01T00:00:00Z");
    const from = new Date("2026-03-01T00:00:00Z");
    expect(
      membershipValidThrough(joined, from).toISOString().slice(0, 10)
    ).toBe("2026-06-01");
  });
  it("rolls to next year once this year's anniversary has passed", () => {
    const joined = new Date("2020-06-01T00:00:00Z");
    const from = new Date("2026-08-01T00:00:00Z");
    expect(
      membershipValidThrough(joined, from).toISOString().slice(0, 10)
    ).toBe("2027-06-01");
  });
});
