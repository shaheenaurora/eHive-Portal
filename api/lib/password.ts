import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Password hashing with Node's built-in scrypt — no third-party dependency and
 * no native build step, so it works in any container. Format: "salt:hash" (hex).
 */
const KEYLEN = 64;

export interface PasswordValidationResult {
  ok: boolean;
  error?: string;
}

/** Enforce a reasonable baseline policy: 8–200 chars with mixed case, a digit,
 *  and a symbol. Returns a structured result so callers can return a clear
 *  field-level error instead of a generic failure. */
export function validatePassword(password: string): PasswordValidationResult {
  if (password.length < 8)
    return { ok: false, error: "Password must be at least 8 characters." };
  if (password.length > 200)
    return { ok: false, error: "Password must be 200 characters or fewer." };
  if (!/[A-Z]/.test(password))
    return { ok: false, error: "Password must include an uppercase letter." };
  if (!/[a-z]/.test(password))
    return { ok: false, error: "Password must include a lowercase letter." };
  if (!/[0-9]/.test(password))
    return { ok: false, error: "Password must include a number." };
  if (!/[^A-Za-z0-9]/.test(password))
    return { ok: false, error: "Password must include a special character." };
  return { ok: true };
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEYLEN).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(
  password: string,
  stored: string | null
): boolean {
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, KEYLEN);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
