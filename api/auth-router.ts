import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { VERIFY_TOKEN_TTL_MS, RESET_TOKEN_TTL_MS } from "@contracts/constants";
import { createRouter, publicQuery, authedQuery } from "./middleware";
import { hashPassword, verifyPassword } from "./lib/password";
import { sessionSetCookie, sessionClearCookie } from "./lib/session";
import {
  findUserByEmail, findUserById, createUser, touchLastSignIn,
  setUserPassword, markEmailVerified,
} from "./queries/users";
import { createAuthToken, consumeAuthToken } from "./lib/tokens";
import { sendVerifyEmail, sendResetEmail } from "./lib/auth-mail";
import { rateLimit, rateLimitReset } from "./lib/rate-limit";

const credentials = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(200),
});

/** Best-effort client IP from proxy headers (Railway sets x-forwarded-for). */
function clientIp(headers: Headers): string {
  return (headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
}
function originOf(req: Request): string {
  return req.headers.get("origin") ?? new URL(req.url).origin;
}

async function issueVerification(userId: number, email: string, name: string, origin: string) {
  try {
    const raw = await createAuthToken(userId, "verify", VERIFY_TOKEN_TTL_MS);
    await sendVerifyEmail(email, name, `${origin}/verify-email?token=${raw}`);
  } catch (e) { console.error("verification email failed", e); }
}

export const authRouter = createRouter({
  me: authedQuery.query((opts) => opts.ctx.user),

  register: publicQuery
    .input(credentials.extend({ name: z.string().min(1).max(255) }))
    .mutation(async ({ ctx, input }) => {
      const ip = clientIp(ctx.req.headers);
      if (!rateLimit(`register:${ip}`, 5, 60 * 60 * 1000)) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many sign-up attempts. Please try again later." });
      }
      const existing = await findUserByEmail(input.email);
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "An account with this email already exists." });
      }
      const user = await createUser({
        email: input.email,
        passwordHash: hashPassword(input.password),
        name: input.name,
      });
      if (!user) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not create account." });
      }
      await issueVerification(user.id, user.email!, user.name ?? "", originOf(ctx.req));
      ctx.resHeaders.append("set-cookie", await sessionSetCookie(user.unionId, ctx.req.headers));
      return user;
    }),

  login: publicQuery
    .input(credentials)
    .mutation(async ({ ctx, input }) => {
      const ip = clientIp(ctx.req.headers);
      const email = input.email.toLowerCase();
      // Two windows: broad per-IP, tighter per-account, to slow brute force.
      if (!rateLimit(`login:ip:${ip}`, 20, 15 * 60 * 1000) || !rateLimit(`login:acct:${email}`, 8, 15 * 60 * 1000)) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many attempts. Please wait a few minutes and try again." });
      }
      const user = await findUserByEmail(input.email);
      if (!user || !verifyPassword(input.password, user.passwordHash)) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Incorrect email or password." });
      }
      rateLimitReset(`login:acct:${email}`);
      await touchLastSignIn(user.id);
      ctx.resHeaders.append("set-cookie", await sessionSetCookie(user.unionId, ctx.req.headers));
      return user;
    }),

  logout: authedQuery.mutation(async ({ ctx }) => {
    ctx.resHeaders.append("set-cookie", sessionClearCookie(ctx.req.headers));
    return { success: true };
  }),

  /* ---- email verification ---- */
  resendVerification: authedQuery.mutation(async ({ ctx }) => {
    if (ctx.user.emailVerifiedAt) return { ok: true, alreadyVerified: true };
    if (!rateLimit(`verify:${ctx.user.id}`, 3, 60 * 60 * 1000)) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Please wait before requesting another verification email." });
    }
    await issueVerification(ctx.user.id, ctx.user.email!, ctx.user.name ?? "", originOf(ctx.req));
    return { ok: true };
  }),

  verifyEmail: publicQuery
    .input(z.object({ token: z.string().min(10).max(200) }))
    .mutation(async ({ input }) => {
      const userId = await consumeAuthToken(input.token, "verify");
      if (!userId) throw new TRPCError({ code: "BAD_REQUEST", message: "This verification link is invalid or has expired." });
      await markEmailVerified(userId);
      return { ok: true };
    }),

  /* ---- password reset ---- */
  requestPasswordReset: publicQuery
    .input(z.object({ email: z.string().email().max(320) }))
    .mutation(async ({ ctx, input }) => {
      const ip = clientIp(ctx.req.headers);
      // Rate-limited, and always returns ok so we don't leak which emails exist.
      if (rateLimit(`reset:${ip}`, 5, 60 * 60 * 1000) && rateLimit(`reset:acct:${input.email.toLowerCase()}`, 3, 60 * 60 * 1000)) {
        const user = await findUserByEmail(input.email);
        if (user) {
          try {
            const raw = await createAuthToken(user.id, "reset", RESET_TOKEN_TTL_MS);
            await sendResetEmail(user.email!, user.name ?? "", `${originOf(ctx.req)}/reset-password?token=${raw}`);
          } catch (e) { console.error("reset email failed", e); }
        }
      }
      return { ok: true };
    }),

  resetPassword: publicQuery
    .input(z.object({ token: z.string().min(10).max(200), password: z.string().min(8).max(200) }))
    .mutation(async ({ input }) => {
      const userId = await consumeAuthToken(input.token, "reset");
      if (!userId) throw new TRPCError({ code: "BAD_REQUEST", message: "This reset link is invalid or has expired." });
      await setUserPassword(userId, hashPassword(input.password));
      // A password reset also proves control of the mailbox.
      const user = await findUserById(userId);
      if (user && !user.emailVerifiedAt) await markEmailVerified(userId);
      return { ok: true };
    }),
});
