import { describe, it, expect } from "vitest";
import { exportUser } from "./lib/pdpl";
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
