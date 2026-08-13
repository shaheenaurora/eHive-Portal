import * as jose from "jose";
import * as cookie from "cookie";
import { createHash } from "node:crypto";
import { env } from "./env";
import { getSessionCookieOptions } from "./cookies";
import { Session } from "@contracts/constants";
import { Errors } from "@contracts/errors";
import { findUserByUnionId, ensureOwnerRole } from "../queries/users";

const JWT_ALG = "HS256";

type SessionPayload = { uid: string; tv: number };

/** Best-effort client fingerprint for binding short-lived 2FA challenges to the
 *  same connection context. Not a substitute for device trust, but prevents a
 *  stolen challenge token from being redeemed from a wildly different client. */
function clientFingerprint(headers: Headers): string {
  const forwarded = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  const ip = forwarded.at(-1) ?? headers.get("x-real-ip") ?? "";
  const ua = headers.get("user-agent") ?? "";
  return createHash("sha256")
    .update(`${ip}|${ua}`)
    .digest("base64url")
    .slice(0, 32);
}

// 7 days for primary sessions — a bounded lifetime for a stolen cookie while
// still avoiding weekly re-logins for active users. Sliding refresh can be
// added later to extend this transparently.
const SESSION_EXPIRES_IN = "7d";

export async function signSessionToken(
  uid: string,
  tokenVersion: number
): Promise<string> {
  const secret = new TextEncoder().encode(env.appSecret);
  return new jose.SignJWT({ uid, tv: tokenVersion })
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setExpirationTime(SESSION_EXPIRES_IN)
    .sign(secret);
}

async function verifySessionToken(
  token: string
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const secret = new TextEncoder().encode(env.appSecret);
    const { payload } = await jose.jwtVerify(token, secret, {
      algorithms: [JWT_ALG],
    });
    const uid = payload.uid;
    const tv = payload.tv;
    if (typeof uid !== "string" || !uid || typeof tv !== "number") return null;
    return { uid, tv };
  } catch {
    return null;
  }
}

type ChallengePayload = { twofa: number; fp: string };

/** Short-lived signed token that proves a password check passed and a 2FA code
 *  is still required. Carries the userId and a client fingerprint so the
 *  challenge can't be replayed from a different IP/UA. Signed with a dedicated
 *  secret so session-key rotation does not break in-flight 2FA flows.
 */
export async function sign2faChallenge(
  userId: number,
  headers: Headers
): Promise<string> {
  const secret = new TextEncoder().encode(env.totpSecret);
  return new jose.SignJWT({ twofa: userId, fp: clientFingerprint(headers) })
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(secret);
}

export async function verify2faChallenge(
  token: string,
  headers: Headers
): Promise<number | null> {
  if (!token) return null;
  try {
    const secret = new TextEncoder().encode(env.totpSecret);
    const { payload } = await jose.jwtVerify(token, secret, {
      algorithms: [JWT_ALG],
    });
    const p = payload as Partial<ChallengePayload>;
    if (typeof p.twofa !== "number" || p.fp !== clientFingerprint(headers))
      return null;
    return p.twofa;
  } catch {
    return null;
  }
}

/** Resolve the current user from the session cookie, or throw if not signed in. */
export async function authenticateRequest(headers: Headers) {
  const cookies = cookie.parse(headers.get("cookie") || "");
  const token = cookies[Session.cookieName];
  if (!token) throw Errors.forbidden("Not signed in.");
  const claim = await verifySessionToken(token);
  if (!claim) throw Errors.forbidden("Invalid or expired session.");
  const user = await findUserByUnionId(claim.uid);
  if (!user) throw Errors.forbidden("Account not found. Please sign in again.");
  if (user.tokenVersion !== claim.tv) {
    throw Errors.forbidden("Session revoked. Please sign in again.");
  }
  return ensureOwnerRole(user);
}

/** Serialize a Set-Cookie header value that establishes the session. */
export async function sessionSetCookie(
  uid: string,
  tokenVersion: number,
  headers: Headers
): Promise<string> {
  const token = await signSessionToken(uid, tokenVersion);
  const opts = getSessionCookieOptions(headers);
  return cookie.serialize(Session.cookieName, token, {
    httpOnly: opts.httpOnly,
    path: opts.path,
    sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
    secure: opts.secure,
    maxAge: Session.maxAgeMs / 1000,
  });
}

/** Serialize a Set-Cookie header value that clears the session. */
export function sessionClearCookie(headers: Headers): string {
  const opts = getSessionCookieOptions(headers);
  return cookie.serialize(Session.cookieName, "", {
    httpOnly: opts.httpOnly,
    path: opts.path,
    sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
    secure: opts.secure,
    maxAge: 0,
  });
}
