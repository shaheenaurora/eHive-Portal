import { describe, it, expect, vi, afterEach } from "vitest";
import { maskIdNumber } from "@contracts/constants";
import {
  sealIdNumber,
  unsealIdNumber,
  displayIdNumber,
} from "./lib/id-seal";

describe("maskIdNumber", () => {
  it("shows only the last 4 characters", () => {
    expect(maskIdNumber("784199012345678")).toBe("•••••••••••5678");
  });
  it("masks a short id entirely", () => {
    expect(maskIdNumber("12")).toBe("••");
    expect(maskIdNumber("1234")).toBe("••••");
  });
  it("is empty for empty/nullish input", () => {
    expect(maskIdNumber("")).toBe("");
    expect(maskIdNumber(null)).toBe("");
    expect(maskIdNumber(undefined)).toBe("");
  });
});

const originalEnv = { ...process.env };

async function loadIdSeal(appSecret: string) {
  vi.resetModules();
  process.env.APP_SECRET = appSecret;
  return import("./lib/id-seal");
}

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("KYC idNumber sealing", () => {
  it("seals to a prefixed ciphertext that opens back to the plaintext", () => {
    const id = "784199012345678";
    const sealed = sealIdNumber(id);
    expect(sealed).toMatch(/^ehid:/);
    expect(sealed).not.toBe(id);
    expect(sealed.length).toBeGreaterThan(id.length);
    expect(unsealIdNumber(sealed)).toBe(id);
  });

  it("stored form never contains the plaintext", () => {
    const id = "P1234567";
    const sealed = sealIdNumber(id);
    expect(sealed).not.toContain(id);
  });

  it("randomises: two seals of the same id produce different ciphertext", () => {
    const id = "784199012345678";
    expect(sealIdNumber(id)).not.toBe(sealIdNumber(id));
  });

  it("handles empty and unicode ids round-trip", () => {
    expect(unsealIdNumber(sealIdNumber(""))).toBe("");
    const unicode = "Ë123-ä456";
    expect(unsealIdNumber(sealIdNumber(unicode))).toBe(unicode);
  });

  it("passes through legacy plaintext rows unchanged", () => {
    expect(unsealIdNumber("784199012345678")).toBe("784199012345678");
    expect(displayIdNumber("784199012345678")).toBe("784199012345678");
    expect(displayIdNumber(null)).toBeNull();
  });

  it("fails closed on corrupt ciphertext: no plaintext leak, no crash", () => {
    const sealed = sealIdNumber("784199012345678");
    const corrupt = sealed.slice(0, -4) + "AAAA";
    expect(() => unsealIdNumber(corrupt)).toThrow();
    expect(displayIdNumber(corrupt)).toBeNull();
  });

  it("fails closed when the sealing key has rotated", async () => {
    const sealer = await loadIdSeal("old-secret-that-is-long-enough-32ch");
    const sealed = sealer.sealIdNumber("784199012345678");

    const rotated = await loadIdSeal("new-secret-that-is-long-enough-32ch");
    expect(() => rotated.unsealIdNumber(sealed)).toThrow();
    expect(rotated.displayIdNumber(sealed)).toBeNull();

    // The original key still opens it (rotation window keeps reads working).
    const original = await loadIdSeal("old-secret-that-is-long-enough-32ch");
    expect(original.unsealIdNumber(sealed)).toBe("784199012345678");
  });
});
