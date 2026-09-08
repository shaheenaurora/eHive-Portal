import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Self-serve booking-management tokens. Lets a booking holder reschedule or
 * cancel via a link in their confirmation email without an account or admin
 * intervention. The token is `id.exp.hmac` where the HMAC-SHA256 signature
 * covers `id.exp` with APP_SECRET — unguessable, tamper-evident, and it
 * expires (we use appointment end + 48h) so old links stop working.
 */

function signature(payload: string): string {
  return createHmac("sha256", env.appSecret)
    .update(payload)
    .digest("base64url");
}

/** Mint a management token for an appointment, valid until `expMs` (epoch ms). */
export function signBookingToken(appointmentId: number, expMs: number): string {
  const exp = Math.floor(expMs / 1000);
  const payload = `${appointmentId}.${exp}`;
  return `${payload}.${signature(payload)}`;
}

/** Constant-time verify: right appointment, unexpired, correctly signed. */
export function verifyBookingToken(
  token: string,
  appointmentId: number
): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [idStr, expStr, sig] = parts;
  if (Number(idStr) !== appointmentId) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const expected = signature(`${idStr}.${expStr}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
