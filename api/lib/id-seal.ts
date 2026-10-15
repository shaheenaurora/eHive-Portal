import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { env } from "./env";

const SEAL_PREFIX = "ehid:";
const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function deriveKey(): Buffer {
  // Deterministic 32-byte key from APP_SECRET (domain-separated from the TOTP
  // seal key, which derives from TOTP_SECRET). Rotating APP_SECRET invalidates
  // existing sealed ID numbers; unopenable rows surface as null (fail closed)
  // until the member re-submits their details.
  return createHash("sha256")
    .update("ehive:kyc-id-number:v1:")
    .update(env.appSecret)
    .digest();
}

/**
 * Encrypt a national ID number (passport / Emirates ID) before storing it in
 * the database. Returns a prefixed base64 string (aes-256-gcm). Decrypt with
 * `unsealIdNumber`.
 */
export function sealIdNumber(idNumber: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, deriveKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(idNumber, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, tag, encrypted]);
  return `${SEAL_PREFIX}${combined.toString("base64")}`;
}

/**
 * Decrypt a sealed ID number. If the value is not sealed (legacy plaintext
 * row), return it unchanged so existing KYC records keep being displayed
 * until the member next re-submits (which stores the sealed form).
 */
export function unsealIdNumber(sealed: string): string {
  if (!sealed.startsWith(SEAL_PREFIX)) {
    return sealed;
  }
  const raw = Buffer.from(sealed.slice(SEAL_PREFIX.length), "base64");
  if (raw.length < IV_LEN + TAG_LEN) {
    throw new Error("Invalid sealed ID number");
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

/**
 * Decrypt a stored idNumber for display. Legacy plaintext rows pass through;
 * rows whose ciphertext can't be opened (corrupt data, rotated APP_SECRET)
 * fail closed as null — no plaintext leak, no throw into the UI.
 */
export function displayIdNumber(stored: string | null): string | null {
  if (stored === null) return null;
  try {
    return unsealIdNumber(stored);
  } catch {
    return null;
  }
}
