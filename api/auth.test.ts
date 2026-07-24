import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./lib/password";

describe("password hashing (scrypt)", () => {
  it("verifies a correct password against its hash", () => {
    const hash = hashPassword("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects an incorrect password", () => {
    const hash = hashPassword("s3cret-passw0rd");
    expect(verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("produces a unique salt per hash (no identical hashes)", () => {
    expect(hashPassword("same-input")).not.toBe(hashPassword("same-input"));
  });

  it("rejects verification against a null/blank stored hash", () => {
    expect(verifyPassword("anything", null)).toBe(false);
    expect(verifyPassword("anything", "")).toBe(false);
  });
});
