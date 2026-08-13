import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./lib/password";

describe("password hashing (scrypt)", () => {
  it("verifies a correct password against its hash", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(
      true
    );
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("s3cret-passw0rd");
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("produces a unique salt per hash (no identical hashes)", async () => {
    expect(await hashPassword("same-input")).not.toBe(
      await hashPassword("same-input")
    );
  });

  it("rejects verification against a null/blank stored hash", async () => {
    expect(await verifyPassword("anything", null)).toBe(false);
    expect(await verifyPassword("anything", "")).toBe(false);
  });
});
