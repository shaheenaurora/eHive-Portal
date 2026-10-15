import { describe, it, expect } from "vitest";
import { exportUser, exportKyc } from "./lib/pdpl";
import { sealIdNumber } from "./lib/id-seal";
import type * as schema from "@db/schema";

function makeUser(partial: Partial<typeof schema.users.$inferSelect> = {}) {
  return {
    id: 1,
    unionId: "EH-U-00001",
    name: "Test User",
    email: "test@example.com",
    passwordHash: "super-secret-hash",
    totpSecret: "super-secret-totp",
    tokenVersion: 3,
    resetToken: "reset-token",
    resetTokenExpiresAt: new Date("2026-01-01"),
    consentAt: new Date("2026-01-01"),
    avatar: null,
    role: "member",
    adminScopes: "",
    emailVerifiedAt: new Date("2026-01-01"),
    totpEnabled: 0,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    lastSignInAt: null,
    ...partial,
  } as typeof schema.users.$inferSelect;
}

describe("exportUser", () => {
  it("preserves identity and safe profile fields", () => {
    const user = makeUser();
    const exported = exportUser(user);
    expect(exported.id).toBe(user.id);
    expect(exported.unionId).toBe(user.unionId);
    expect(exported.name).toBe(user.name);
    expect(exported.email).toBe(user.email);
    expect(exported.consentAt).toEqual(user.consentAt);
    expect(exported.role).toBe(user.role);
    expect(exported.emailVerifiedAt).toEqual(user.emailVerifiedAt);
    expect(exported.createdAt).toEqual(user.createdAt);
  });

  it("strips credential and session fields", () => {
    const user = makeUser();
    const exported = exportUser(user);
    expect("passwordHash" in exported).toBe(false);
    expect("totpSecret" in exported).toBe(false);
    expect("tokenVersion" in exported).toBe(false);
    expect("resetToken" in exported).toBe(false);
    expect("resetTokenExpiresAt" in exported).toBe(false);
  });

  it("does not include sensitive values even if extra keys are present", () => {
    const user = makeUser({ passwordHash: "leaked" });
    const exported = exportUser(user);
    expect(Object.values(exported)).not.toContain("leaked");
    expect(Object.values(exported)).not.toContain("super-secret-totp");
  });
});

function makeKyc(partial: Partial<typeof schema.memberKyc.$inferSelect> = {}) {
  return {
    id: 1,
    memberId: 42,
    idType: "emirates_id",
    idNumber: "784199012345678",
    nationality: "United Arab Emirates",
    idExpiry: null,
    status: "verified",
    submittedAt: new Date("2026-01-01"),
    reviewedByUserId: 7,
    reviewedAt: new Date("2026-01-02"),
    reviewNote: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...partial,
  } as typeof schema.memberKyc.$inferSelect;
}

describe("exportKyc", () => {
  it("decrypts a sealed idNumber so the data subject can read their export", () => {
    const kyc = makeKyc({ idNumber: sealIdNumber("784199012345678") });
    const exported = exportKyc(kyc);
    expect(exported.idNumber).toBe("784199012345678");
  });

  it("passes through legacy plaintext idNumbers", () => {
    const kyc = makeKyc();
    const exported = exportKyc(kyc);
    expect(exported.idNumber).toBe("784199012345678");
  });

  it("exports null rather than raw ciphertext when the seal can't be opened", () => {
    const kyc = makeKyc({
      idNumber: sealIdNumber("784199012345678").slice(0, -4) + "AAAA",
    });
    const exported = exportKyc(kyc);
    expect(exported.idNumber).toBeNull();
  });

  it("keeps the rest of the KYC row intact", () => {
    const kyc = makeKyc();
    const exported = exportKyc(kyc);
    expect(exported.memberId).toBe(42);
    expect(exported.idType).toBe("emirates_id");
    expect(exported.status).toBe("verified");
  });
});
