import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Paid-report access tokens. The same construction as the booking-manage
 * token (api/lib/booking-token.ts): `reportId.exp.hmac` where the HMAC-SHA256
 * signature covers `reportId.exp` with APP_SECRET — unguessable, tamper-
 * evident, expiring. Reports are a paid deliverable, so the lifetime is a
 * year (REPORT_TOKEN_TTL_MS) rather than the booking window; the token is
 * minted once per report row and never rotated so emailed unlock links keep
 * working.
 */

function signature(payload: string): string {
  return createHmac("sha256", env.appSecret)
    .update(payload)
    .digest("base64url");
}

/** Mint an access token for a report, valid until `expMs` (epoch ms). */
export function signReportToken(reportId: number, expMs: number): string {
  const exp = Math.floor(expMs / 1000);
  const payload = `${reportId}.${exp}`;
  return `${payload}.${signature(payload)}`;
}

/** Constant-time verify: right report, unexpired, correctly signed. */
export function verifyReportToken(token: string, reportId: number): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [idStr, expStr, sig] = parts;
  if (Number(idStr) !== reportId) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const expected = signature(`${idStr}.${expStr}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
