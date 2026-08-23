import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { VERIFY_TOKEN_TTL_MS, RESET_TOKEN_TTL_MS } from "@contracts/constants";
import { createRouter, publicQuery, authedQuery } from "./middleware";
import { hashPassword, verifyPassword, validatePassword } from "./lib/password";
import {
  sessionSetCookie,
  sessionClearCookie,
  sign2faChallenge,
  verify2faChallenge,
} from "./lib/session";
import {
  findUserByEmail,
  findUserById,
  createUser,
  touchLastSignIn,
  setUserPassword,
  markEmailVerified,
  setTotpSecret,
  setTotpEnabled,
  incrementTokenVersion,
} from "./queries/users";
import { env } from "./lib/env";
import { createAuthToken, consumeAuthToken } from "./lib/tokens";
import {
  sendVerifyEmail,
  sendResetEmail,
  sendPasswordChangedEmail,
} from "./lib/auth-mail";
import { rateLimit, rateLimitReset } from "./lib/rate-limit";
import {
  generateTotpSecret,
  totpKeyUri,
  verifyTotp,
  sealTotpSecret,
  unsealTotpSecret,
} from "./lib/totp";
import { mailEnabled } from "./lib/mailer";
import type { User } from "@db/schema";

/** Server-only fields that must never be serialized to the client. */
export type SafeUser = Omit<User, "passwordHash" | "totpSecret">;
export function safeUser(u: User): SafeUser {
  const rest = { ...u } as Partial<User>;
  delete rest.passwordHash;
  delete rest.totpSecret;
  return rest as SafeUser;
}

const credentials = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(200),
});

/** Best-effort client IP from proxy headers (Railway sets x-forwarded-for). */
function clientIp(headers: Headers): string {
  // Use the rightmost untrusted address in X-Forwarded-For so the client can't
  // spoof an arbitrary IP by adding values on the left. Railway/Fly append the
  // actual connecting IP at the end.
  const forwarded = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  return forwarded.at(-1) ?? headers.get("x-real-ip") ?? "unknown";
}

async function issueVerification(userId: number, email: string, name: string) {
  try {
    const raw = await createAuthToken(userId, "verify", VERIFY_TOKEN_TTL_MS);
    await sendVerifyEmail(
      email,
      name,
      `${env.publicUrl}/verify-email?token=${raw}`
    );
  } catch (e) {
    console.error("verification email failed", e);
  }
}

export const authRouter = createRouter({
  me: authedQuery.query(opts => safeUser(opts.ctx.user)),

  /* Public runtime flags for the client (e.g. whether to show the email-verify
     nudge — pointless until SMTP is configured). */
  config: publicQuery.query(() => ({ mailConfigured: mailEnabled() })),

  register: publicQuery
    .input(credentials.extend({ name: z.string().min(1).max(255) }))
    .mutation(async ({ ctx, input }) => {
      const ip = clientIp(ctx.req.headers);
      if (!(await rateLimit(`register:${ip}`, 5, 60 * 60 * 1000))) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many sign-up attempts. Please try again later.",
        });
      }
      const existing = await findUserByEmail(input.email);
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An account with this email already exists.",
        });
      }
      const pwdCheck = validatePassword(input.password);
      if (!pwdCheck.ok) {
        throw new TRPCError({ code: "BAD_REQUEST", message: pwdCheck.error });
      }
      const user = await createUser({
        email: input.email,
        passwordHash: await hashPassword(input.password),
        name: input.name,
      });
      if (!user) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not create account.",
        });
      }
      await issueVerification(user.id, user.email!, user.name ?? "");
      ctx.resHeaders.append(
        "set-cookie",
        await sessionSetCookie(user.unionId, user.tokenVersion, ctx.req.headers)
      );
      return safeUser(user);
    }),

  login: publicQuery.input(credentials).mutation(async ({ ctx, input }) => {
    const ip = clientIp(ctx.req.headers);
    const email = input.email.toLowerCase();
    // Two windows: broad per-IP, tighter per-account, to slow brute force.
    const ipOk = await rateLimit(`login:ip:${ip}`, 20, 15 * 60 * 1000);
    const acctOk = await rateLimit(`login:acct:${email}`, 8, 15 * 60 * 1000);
    if (!ipOk || !acctOk) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Too many attempts. Please wait a few minutes and try again.",
      });
    }
    const user = await findUserByEmail(input.email);
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Incorrect email or password.",
      });
    }
    if (!user.emailVerifiedAt) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message:
          "Please verify your email before signing in. Check your inbox for the verification link.",
      });
    }
    await rateLimitReset(`login:acct:${email}`);
    // Password OK. If 2FA is on, defer the session until a valid code — hand
    // back a short-lived challenge instead of signing in.
    if (user.totpEnabled) {
      return {
        needs2fa: true as const,
        challenge: await sign2faChallenge(user.id, ctx.req.headers),
      };
    }
    await touchLastSignIn(user.id);
    ctx.resHeaders.append(
      "set-cookie",
      await sessionSetCookie(user.unionId, user.tokenVersion, ctx.req.headers)
    );
    return { needs2fa: false as const, user: safeUser(user) };
  }),

  /* Second factor: exchange a login challenge + TOTP code for a session. */
  loginVerify2fa: publicQuery
    .input(
      z.object({
        challenge: z.string().min(10),
        code: z.string().min(6).max(10),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = await verify2faChallenge(input.challenge, ctx.req.headers);
      if (!userId)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Your login session expired — please sign in again.",
        });
      if (!(await rateLimit(`2fa:${userId}`, 6, 15 * 60 * 1000))) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many codes. Please wait a few minutes.",
        });
      }
      const user = await findUserById(userId);
      const rawSecret = user?.totpSecret
        ? unsealTotpSecret(user.totpSecret)
        : "";
      if (
        !user ||
        !user.totpEnabled ||
        !rawSecret ||
        !verifyTotp(input.code, rawSecret)
      ) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message:
            "That code isn't right. Check your authenticator app and try again.",
        });
      }
      await touchLastSignIn(user.id);
      ctx.resHeaders.append(
        "set-cookie",
        await sessionSetCookie(user.unionId, user.tokenVersion, ctx.req.headers)
      );
      return { user: safeUser(user) };
    }),

  logout: authedQuery.mutation(async ({ ctx }) => {
    await incrementTokenVersion(ctx.user.id);
    ctx.resHeaders.append("set-cookie", sessionClearCookie(ctx.req.headers));
    return { success: true };
  }),

  /* ---- email verification ---- */
  resendVerification: authedQuery.mutation(async ({ ctx }) => {
    if (ctx.user.emailVerifiedAt) return { ok: true, alreadyVerified: true };
    if (!(await rateLimit(`verify:${ctx.user.id}`, 3, 60 * 60 * 1000))) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Please wait before requesting another verification email.",
      });
    }
    await issueVerification(ctx.user.id, ctx.user.email!, ctx.user.name ?? "");
    return { ok: true };
  }),

  verifyEmail: publicQuery
    .input(z.object({ token: z.string().min(10).max(200) }))
    .mutation(async ({ input }) => {
      const userId = await consumeAuthToken(input.token, "verify");
      if (!userId)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This verification link is invalid or has expired.",
        });
      await markEmailVerified(userId);
      return { ok: true };
    }),

  /* ---- password reset ---- */
  requestPasswordReset: publicQuery
    .input(z.object({ email: z.string().email().max(320) }))
    .mutation(async ({ ctx, input }) => {
      const ip = clientIp(ctx.req.headers);
      // Rate-limited, and always returns ok so we don't leak which emails exist.
      if (
        (await rateLimit(`reset:${ip}`, 5, 60 * 60 * 1000)) &&
        (await rateLimit(
          `reset:acct:${input.email.toLowerCase()}`,
          3,
          60 * 60 * 1000
        ))
      ) {
        const user = await findUserByEmail(input.email);
        if (user) {
          try {
            const raw = await createAuthToken(
              user.id,
              "reset",
              RESET_TOKEN_TTL_MS
            );
            await sendResetEmail(
              user.email!,
              user.name ?? "",
              `${env.publicUrl}/reset-password?token=${raw}`
            );
          } catch (e) {
            console.error("reset email failed", e);
          }
        }
      }
      return { ok: true };
    }),

  resetPassword: publicQuery
    .input(
      z.object({
        token: z.string().min(10).max(200),
        password: z.string().min(8).max(200),
      })
    )
    .mutation(async ({ input }) => {
      const userId = await consumeAuthToken(input.token, "reset");
      if (!userId)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This reset link is invalid or has expired.",
        });
      const pwdCheck = validatePassword(input.password);
      if (!pwdCheck.ok) {
        throw new TRPCError({ code: "BAD_REQUEST", message: pwdCheck.error });
      }
      await setUserPassword(userId, await hashPassword(input.password));
      // A password reset also proves control of the mailbox.
      const user = await findUserById(userId);
      if (user && !user.emailVerifiedAt) await markEmailVerified(userId);
      if (user) {
        try {
          await sendPasswordChangedEmail({
            email: user.email!,
            name: user.name,
          });
        } catch (e) {
          console.error("password-changed email failed", e);
        }
      }
      return { ok: true };
    }),

  /* ---- two-factor authentication (TOTP) ---- */
  twoFactorStatus: authedQuery.query(({ ctx }) => ({
    enabled: !!ctx.user.totpEnabled,
  })),

  /* Begin enrolment: mint a secret, return the otpauth URI for a QR code.
     Not active until confirmed with a valid code via twoFactorEnable. */
  twoFactorSetup: authedQuery.mutation(async ({ ctx }) => {
    const secret = generateTotpSecret();
    await setTotpSecret(ctx.user.id, sealTotpSecret(secret));
    return {
      otpauthUri: totpKeyUri(secret, ctx.user.email ?? "member"),
    };
  }),

  twoFactorEnable: authedQuery
    .input(z.object({ code: z.string().min(6).max(10) }))
    .mutation(async ({ ctx, input }) => {
      const user = await findUserById(ctx.user.id);
      if (!user?.totpSecret)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Start setup first.",
        });
      const rawSecret = unsealTotpSecret(user.totpSecret);
      if (!verifyTotp(input.code, rawSecret)) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message:
            "That code isn't right — make sure you scanned the QR, then enter a fresh code.",
        });
      }
      await setTotpEnabled(ctx.user.id, true);
      return { ok: true };
    }),

  twoFactorDisable: authedQuery
    .input(z.object({ code: z.string().min(6).max(10) }))
    .mutation(async ({ ctx, input }) => {
      const user = await findUserById(ctx.user.id);
      const rawSecret = user?.totpSecret
        ? unsealTotpSecret(user.totpSecret)
        : "";
      if (!rawSecret || !verifyTotp(input.code, rawSecret)) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Enter a current code to turn off two-factor.",
        });
      }
      await setTotpEnabled(ctx.user.id, false);
      return { ok: true };
    }),
});
