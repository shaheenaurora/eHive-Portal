import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { authenticator } from "otplib";
import { env } from "./env";

// Allow one step of clock drift either side (±30s).
authenticator.options = { window: 1 };

const ISSUER = "eHive Circle";
const SEAL_PREFIX = "eh2:";
const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function deriveKey(): Buffer {
  // Deterministic 32-byte key from the configured TOTP_SECRET. Rotating the
  // env secret invalidates existing sealed secrets; users must re-enrol 2FA.
  return createHash("sha256").update(env.totpSecret).digest();
}

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

/**
 * Encrypt a raw TOTP secret before storing it in the database. Returns a
 * prefixed base64 string (aes-256-gcm). Falls back to the raw secret during
 * decryption so existing plaintext secrets keep working until the user next
 * re-enrols.
 */
export function sealTotpSecret(secret: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, deriveKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, tag, encrypted]);
  return `${SEAL_PREFIX}${combined.toString("base64")}`;
}

/**
 * Decrypt a sealed TOTP secret. If the value is not sealed (legacy plaintext),
 * return it unchanged so existing 2FA keeps working.
 */
export function unsealTotpSecret(sealed: string): string {
  if (!sealed.startsWith(SEAL_PREFIX)) {
    return sealed;
  }
  const raw = Buffer.from(sealed.slice(SEAL_PREFIX.length), "base64");
  if (raw.length < IV_LEN + TAG_LEN) {
    throw new Error("Invalid sealed TOTP secret");
  }
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const encrypted = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, deriveKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8"
  );
}
