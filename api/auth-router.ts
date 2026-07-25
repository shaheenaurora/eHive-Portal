import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery, authedQuery } from "./middleware";
import { hashPassword, verifyPassword } from "./lib/password";
import { sessionSetCookie, sessionClearCookie } from "./lib/session";
import { findUserByEmail, createUser, touchLastSignIn } from "./queries/users";

const credentials = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(200),
});

export const authRouter = createRouter({
  me: authedQuery.query((opts) => opts.ctx.user),

  register: publicQuery
    .input(credentials.extend({ name: z.string().min(1).max(255) }))
    .mutation(async ({ ctx, input }) => {
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
      ctx.resHeaders.append("set-cookie", await sessionSetCookie(user.unionId, ctx.req.headers));
      return user;
    }),

  login: publicQuery
    .input(credentials)
    .mutation(async ({ ctx, input }) => {
      const user = await findUserByEmail(input.email);
      if (!user || !verifyPassword(input.password, user.passwordHash)) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Incorrect email or password." });
      }
      await touchLastSignIn(user.id);
      ctx.resHeaders.append("set-cookie", await sessionSetCookie(user.unionId, ctx.req.headers));
      return user;
    }),

  logout: authedQuery.mutation(async ({ ctx }) => {
    ctx.resHeaders.append("set-cookie", sessionClearCookie(ctx.req.headers));
    return { success: true };
  }),
});
