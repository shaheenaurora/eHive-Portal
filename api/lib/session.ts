import * as jose from "jose";
import * as cookie from "cookie";
import { env } from "./env";
import { getSessionCookieOptions } from "./cookies";
import { Session } from "@contracts/constants";
import { Errors } from "@contracts/errors";
import { findUserByUnionId } from "../queries/users";

const JWT_ALG = "HS256";

type SessionPayload = { uid: string };

export async function signSessionToken(uid: string): Promise<string> {
  const secret = new TextEncoder().encode(env.appSecret);
  return new jose.SignJWT({ uid })
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setExpirationTime("1 year")
    .sign(secret);
}

async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const secret = new TextEncoder().encode(env.appSecret);
    const { payload } = await jose.jwtVerify(token, secret, { algorithms: [JWT_ALG] });
    const uid = payload.uid;
    if (typeof uid !== "string" || !uid) return null;
    return { uid };
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
  return user;
}

/** Serialize a Set-Cookie header value that establishes the session. */
export async function sessionSetCookie(uid: string, headers: Headers): Promise<string> {
  const token = await signSessionToken(uid);
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
