import { describe, it, expect } from "vitest";
import { signReportToken, verifyReportToken } from "./report-token";

describe("report access tokens", () => {
  it("round-trips for the right report", () => {
    const token = signReportToken(42, Date.now() + 60_000);
    expect(verifyReportToken(token, 42)).toBe(true);
  });

  it("rejects a token for a different report", () => {
    const token = signReportToken(42, Date.now() + 60_000);
    expect(verifyReportToken(token, 43)).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const token = signReportToken(42, Date.now() + 60_000);
    const parts = token.split(".");
    parts[2] = parts[2].slice(0, -2) + "xx";
    expect(verifyReportToken(parts.join("."), 42)).toBe(false);
  });

  it("rejects a tampered report id", () => {
    const token = signReportToken(42, Date.now() + 60_000);
    const parts = token.split(".");
    parts[0] = "43";
    expect(verifyReportToken(parts.join("."), 43)).toBe(false);
  });

  it("rejects a tampered expiry", () => {
    const token = signReportToken(42, Date.now() + 60_000);
    const parts = token.split(".");
    parts[1] = String(Number(parts[1]) + 3600);
    expect(verifyReportToken(parts.join("."), 42)).toBe(false);
  });

  it("rejects expired tokens", () => {
    const token = signReportToken(42, Date.now() - 1_000);
    expect(verifyReportToken(token, 42)).toBe(false);
  });

  it("accepts a one-year token (the paid-report lifetime)", () => {
    const token = signReportToken(7, Date.now() + 365 * 24 * 60 * 60 * 1000);
    expect(verifyReportToken(token, 7)).toBe(true);
  });

  it("rejects malformed tokens", () => {
    expect(verifyReportToken("", 42)).toBe(false);
    expect(verifyReportToken("abc.def", 42)).toBe(false);
    expect(verifyReportToken("1.2.3.4.5", 42)).toBe(false);
  });
});
