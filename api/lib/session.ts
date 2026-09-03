import * as jose from "jose";
import * as cookie from "cookie";
import { createHash } from "node:crypto";
import { env } from "./env";
import { getSessionCookieOptions } from "./cookies";
import { Session } from "@contracts/constants";
import { Errors } from "@contracts/errors";
import { findUserByUnionId, ensureOwnerRole } from "../queries/users";
import {
  createUserSession,
  getUserSessionById,
  isSessionValid,
  revokeUserSession,
} from "../queries/sessions";

const JWT_ALG = "HS256";

type SessionPayload = { uid: string; sid: number; tv: number };

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

const SESSION_EXPIRES_IN = "7d";
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export async function signSessionToken(
  uid: string,
  sid: number,
  tokenVersion: number
): Promise<string> {
  const secret = new TextEncoder().encode(env.appSecret);
  return new jose.SignJWT({ uid, sid, tv: tokenVersion })
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
    const sid = payload.sid;
    const tv = payload.tv;
    if (
      typeof uid !== "string" ||
      !uid ||
      typeof sid !== "number" ||
      typeof tv !== "number"
    )
      return null;
    return { uid, sid, tv };
  } catch {
    return null;
  }
}

type ChallengePayload = { twofa: number; fp: string };

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

export async function authenticateRequest(headers: Headers) {
  const cookies = cookie.parse(headers.get("cookie") || "");
  const token = cookies[Session.cookieName];
  if (!token) throw Errors.forbidden("Not signed in.");
  const claim = await verifySessionToken(token);
  if (!claim) throw Errors.forbidden("Invalid or expired session.");

  const [user, session] = await Promise.all([
    findUserByUnionId(claim.uid),
    getUserSessionById(claim.sid),
  ]);
  if (!user) throw Errors.forbidden("Account not found. Please sign in again.");
  if (!session || !isSessionValid(session, user.tokenVersion)) {
    throw Errors.forbidden("Session revoked. Please sign in again.");
  }
  if (user.tokenVersion !== claim.tv) {
    throw Errors.forbidden("Session revoked. Please sign in again.");
  }
  return ensureOwnerRole(user);
}

export async function sessionSetCookie(
  uid: string,
  userTokenVersion: number,
  headers: Headers,
  userId?: number
): Promise<string> {
  if (!userId) {
    const user = await findUserByUnionId(uid);
    if (!user) throw new Error("User not found");
    userId = user.id;
  }
  const forwarded = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  const ip = forwarded.at(-1) ?? headers.get("x-real-ip") ?? "";
  const ua = headers.get("user-agent") ?? "";
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS);
  const session = await createUserSession({
    userId,
    tokenVersion: userTokenVersion,
    fingerprint: clientFingerprint(headers),
    ip,
    userAgent: ua,
    expiresAt,
  });
  const token = await signSessionToken(uid, session.id, userTokenVersion);
  const opts = getSessionCookieOptions(headers);
  return cookie.serialize(Session.cookieName, token, {
    httpOnly: opts.httpOnly,
    path: opts.path,
    sameSite: opts.sameSite?.toLowerCase() as "lax" | "strict" | "none",
    secure: opts.secure,
    maxAge: SESSION_MAX_AGE_MS / 1000,
  });
}

export async function sessionClearCookie(
  headers: Headers,
  currentToken?: string
): Promise<string> {
  if (currentToken) {
    const claim = await verifySessionToken(currentToken);
    if (claim) await revokeUserSession(claim.sid);
  }
  const opts = getSessionCookieOptions(headers);
  return cookie.serialize(Session.cookieName, "", {
    httpOnly: opts.httpOnly,
    path: opts.path,
    sameSite: opts.sameSite?.toLowerCase() as "lax" | "strict" | "none",
    secure: opts.secure,
    maxAge: 0,
  });
}

export async function revokeSessionFromHeaders(
  headers: Headers
): Promise<void> {
  const cookies = cookie.parse(headers.get("cookie") || "");
  const token = cookies[Session.cookieName];
  if (!token) return;
  const claim = await verifySessionToken(token);
  if (claim) await revokeUserSession(claim.sid);
}
