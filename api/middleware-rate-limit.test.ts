import { describe, it, expect } from "vitest";
import { trpcRateLimitKey } from "./middleware";
import { parsePositiveInt } from "./lib/env";

describe("tRPC per-user rate limiting helpers", () => {
  it("builds stable keys per type and user", () => {
    expect(trpcRateLimitKey("mutation", 7)).toBe("trpc:mutation:user:7");
    expect(trpcRateLimitKey("query", 42)).toBe("trpc:query:user:42");
    expect(trpcRateLimitKey("subscription", 1)).toBe("trpc:subscription:user:1");
  });

  it("uses distinct namespaces for query vs mutation", () => {
    expect(trpcRateLimitKey("query", 7)).not.toBe(
      trpcRateLimitKey("mutation", 7)
    );
  });
});

describe("parsePositiveInt", () => {
  it("returns the integer when valid", () => {
    expect(parsePositiveInt("120", 60)).toBe(120);
    expect(parsePositiveInt("600", 60)).toBe(600);
  });

  it("falls back for missing, zero, negative or non-numeric values", () => {
    expect(parsePositiveInt(undefined, 120)).toBe(120);
    expect(parsePositiveInt("", 120)).toBe(120);
    expect(parsePositiveInt("0", 120)).toBe(120);
    expect(parsePositiveInt("-5", 120)).toBe(120);
    expect(parsePositiveInt("abc", 120)).toBe(120);
  });

  it("floors decimals", () => {
    expect(parsePositiveInt("120.9", 60)).toBe(120);
  });
});
