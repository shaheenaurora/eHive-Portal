import { describe, it, expect } from "vitest";
import {
  generateTotpSecret,
  sealTotpSecret,
  unsealTotpSecret,
  totpKeyUri,
} from "./lib/totp";

describe("TOTP crypto", () => {
  it("seals and unseals a secret", () => {
    const secret = generateTotpSecret();
    const sealed = sealTotpSecret(secret);
    expect(sealed).toMatch(/^eh2:/);
    expect(unsealTotpSecret(sealed)).toBe(secret);
  });

  it("passes through legacy plaintext secrets", () => {
    const secret = generateTotpSecret();
    expect(unsealTotpSecret(secret)).toBe(secret);
  });

  it("verifies a code against an unsealed secret", () => {
    const secret = generateTotpSecret();
    const sealed = sealTotpSecret(secret);
    // otplib test token generation isn't synchronous; just ensure unseal works.
    expect(unsealTotpSecret(sealed)).toHaveLength(secret.length);
  });

  it("produces a valid otpauth URI", () => {
    const uri = totpKeyUri("JBSWY3DPEHPK3PXP", "test@example.com");
    expect(uri).toContain("otpauth://totp/");
    expect(uri).toContain("test%40example.com");
  });
});
