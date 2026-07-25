import { authenticator } from "otplib";

// Allow one step of clock drift either side (±30s).
authenticator.options = { window: 1 };

const ISSUER = "eHive Circle";

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

/** otpauth:// URI for authenticator-app QR codes. */
export function totpKeyUri(secret: string, accountLabel: string): string {
  return authenticator.keyuri(accountLabel, ISSUER, secret);
}

export function verifyTotp(code: string, secret: string): boolean {
  try {
    return authenticator.verify({ token: code.replace(/\s/g, ""), secret });
  } catch {
    return false;
  }
}
