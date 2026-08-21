import { describe, it, expect } from "vitest";
import {
  matchesKey,
  presentedKey,
  hasScope,
  clampLimit,
  toPaymentDto,
  toExpenseDto,
  toMemberDto,
  type IntegrationPaymentRow,
} from "./lib/integration";
import type { IntegrationApiKey } from "./lib/env";

const headers = (h: Record<string, string>) => new Headers(h);

const key = (value: string, scopes: string[] = ["*"]): IntegrationApiKey => ({
  name: "test",
  scopes,
  value,
});

describe("presentedKey", () => {
  it("reads a Bearer token", () => {
    expect(presentedKey(headers({ authorization: "Bearer abc123" }))).toBe(
      "abc123"
    );
  });
  it("reads X-API-Key", () => {
    expect(presentedKey(headers({ "x-api-key": "secret" }))).toBe("secret");
  });
  it("is null when neither is present", () => {
    expect(presentedKey(headers({}))).toBeNull();
  });
});

describe("hasScope", () => {
  it("allows wildcard or matching resource", () => {
    expect(hasScope(["*"], "payments")).toBe(true);
    expect(hasScope(["payments", "members"], "payments")).toBe(true);
    expect(hasScope(["payments"], "expenses")).toBe(false);
  });
});

describe("matchesKey", () => {
  it("matches a configured key and returns its metadata", () => {
    const matched = matchesKey([key("k1"), key("k2")], "k2");
    expect(matched?.value).toBe("k2");
    expect(matched?.scopes).toEqual(["*"]);
  });
  it("rejects an unknown or empty key", () => {
    expect(matchesKey([key("k1")], "nope")).toBeNull();
    expect(matchesKey([key("k1")], "")).toBeNull();
    expect(matchesKey([], "k1")).toBeNull();
  });
});

describe("clampLimit", () => {
  it("defaults and caps", () => {
    expect(clampLimit(undefined)).toBe(100);
    expect(clampLimit("50")).toBe(50);
    expect(clampLimit("9999")).toBe(500);
    expect(clampLimit("-3")).toBe(100);
    expect(clampLimit("abc")).toBe(100);
  });
});

describe("toPaymentDto", () => {
  const row: IntegrationPaymentRow = {
    id: 19,
    userId: 7,
    provider: "stripe",
    providerRef: "cs_123",
    purpose: "membership",
    tier: "ascent",
    amount: 599900,
    currency: "aed",
    status: "partially_refunded",
    refundedAmount: 100000,
    paidAt: "2026-06-01T00:00:00.000Z",
    refundedAt: "2026-06-10T00:00:00.000Z",
    createdAt: "2026-05-31T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
    payerName: "Sam Trader",
    payerEmail: "sam@example.com",
  };
  it("exposes ref codes, AED amounts and net", () => {
    const d = toPaymentDto(row);
    expect(d.ref).toBe("EH-INV-00019");
    expect(d.customer.ref).toBe("EH-U-00007");
    expect(d.amount).toBe(5999);
    expect(d.refundedAmount).toBe(1000);
    expect(d.netAmount).toBe(4999);
    expect(d.currency).toBe("AED");
    expect(d.customer.email).toBe("sam@example.com");
    expect(d.paidAt).toBe("2026-06-01T00:00:00.000Z");
  });
});

describe("toExpenseDto", () => {
  it("maps a chapter spend line", () => {
    const d = toExpenseDto({
      id: 4,
      chapterId: 3,
      label: "Venue hire",
      category: "venue",
      amount: 1500,
      status: "approved",
      note: null,
      createdAt: "2026-06-01T00:00:00.000Z",
    });
    expect(d.chapter.ref).toBe("EH-CH-0003");
    expect(d.amount).toBe(1500);
    expect(d.currency).toBe("AED");
    expect(d.category).toBe("venue");
  });
  it("defaults a null category", () => {
    expect(
      toExpenseDto({
        id: 5,
        chapterId: 1,
        label: "x",
        category: null,
        amount: 10,
        status: "approved",
        note: null,
        createdAt: "2026-06-01",
      }).category
    ).toBe("uncategorised");
  });
});

describe("toMemberDto", () => {
  it("maps a member to a customer record with ref codes", () => {
    const d = toMemberDto({
      id: 19,
      userId: 7,
      name: "Sam Trader",
      email: "sam@example.com",
      tier: "ascent",
      status: "active",
      lifecycleState: "active",
      homeChapterId: 3,
      joinedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    });
    expect(d.ref).toBe("EH-M-00019");
    expect(d.customerRef).toBe("EH-U-00007");
    expect(d.homeChapter?.ref).toBe("EH-CH-0003");
    expect(d.status).toBe("active");
  });
  it("allows a member with no home chapter", () => {
    const d = toMemberDto({
      id: 1,
      userId: 1,
      name: null,
      email: null,
      tier: null,
      status: "onboarding",
      lifecycleState: "onboarding",
      homeChapterId: null,
      joinedAt: null,
      updatedAt: "2026-06-01",
    });
    expect(d.homeChapter).toBeNull();
  });
});
