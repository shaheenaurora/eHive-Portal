import { ErrorMessages } from "@contracts/constants";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { User } from "@db/schema";
import type { TrpcContext } from "./context";
import { rateLimit } from "./lib/rate-limit";
import { env } from "./lib/env";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const createRouter = t.router;
export const mergeRouters = t.mergeRouters;
export const publicQuery = t.procedure;

export function trpcRateLimitKey(
  type: "query" | "mutation" | "subscription",
  userId: number
): string {
  return `trpc:${type}:user:${userId}`;
}

/** Per-user rate limit for authenticated tRPC procedures. Mutations are capped
 *  more tightly than queries because they are the expensive/ destructive path.
 *  A tRPC batch counts as one request, so these limits are request-level, not
 *  procedure-level. */
const rateLimitMiddleware = t.middleware(async opts => {
  const { ctx, type, next } = opts;
  // This middleware is chained after requireAuth, so ctx.user is guaranteed.
  const user = ctx.user;
  if (user) {
    const isMutation = type === "mutation";
    const key = trpcRateLimitKey(type, user.id);
    const max = isMutation ? env.trpcMutationRateLimit : env.trpcQueryRateLimit;
    const windowMs = 60 * 1000;
    const allowed = await rateLimit(key, max, windowMs);
    if (!allowed) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Too many requests. Please slow down.",
      });
    }
  }
  return next({ ctx: ctx as TrpcContext & { user: User } });
});

const requireAuth = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: ErrorMessages.unauthenticated,
    });
  }

  // Narrow the context so downstream procedures see a non-optional user.
  return next({
    ctx: { ...ctx, user: ctx.user } as TrpcContext & { user: User },
  });
});

function requireRole(role: string) {
  return t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== role) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: ErrorMessages.insufficientRole,
      });
    }

    return next({ ctx: { ...ctx, user: ctx.user } });
  });
}

export const authedQuery = t.procedure.use(requireAuth).use(rateLimitMiddleware);
export const adminQuery = authedQuery.use(requireRole("admin"));

/**
 * Whether an admin holds a capability scope. Segregation of duties:
 *  - "*" (owner) or "" (legacy/full admin) → all capabilities
 *  - otherwise the scope must be in the comma-separated adminScopes list
 */
export function hasScope(
  user: { role: string; adminScopes?: string | null },
  scope: string
): boolean {
  if (user.role !== "admin") return false;
  const s = (user.adminScopes ?? "").trim();
  if (s === "" || s === "*") return true;
  return s
    .split(",")
    .map(x => x.trim())
    .includes(scope);
}

/** Admin procedure additionally gated on a capability scope. */
export function scopedAdmin(scope: string) {
  return adminQuery.use(async opts => {
    const { ctx, next } = opts;
    if (!hasScope(ctx.user, scope)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Your admin role doesn't include this action.",
      });
    }
    return next({ ctx });
  });
}

/** Whether an admin holds full/owner access ("*" owner or "" legacy). */
export function isFullAdmin(user: {
  role: string;
  adminScopes?: string | null;
}): boolean {
  if (user.role !== "admin") return false;
  const s = (user.adminScopes ?? "").trim();
  return s === "" || s === "*";
}

/** Admin procedure restricted to a full administrator (owner / director).
 *  Platform configuration and cross-cutting tools live here. */
export const fullAdmin = adminQuery.use(async opts => {
  const { ctx, next } = opts;
  if (!isFullAdmin(ctx.user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only a full administrator can do this.",
    });
  }
  return next({ ctx });
});
