import { ErrorMessages } from "@contracts/constants";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const createRouter = t.router;
export const publicQuery = t.procedure;

const requireAuth = t.middleware(async (opts) => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: ErrorMessages.unauthenticated,
    });
  }

  return next({ ctx: { ...ctx, user: ctx.user } });
});

function requireRole(role: string) {
  return t.middleware(async (opts) => {
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

export const authedQuery = t.procedure.use(requireAuth);
export const adminQuery = authedQuery.use(requireRole("admin"));

/**
 * Whether an admin holds a capability scope. Segregation of duties:
 *  - "*" (owner) or "" (legacy/full admin) → all capabilities
 *  - otherwise the scope must be in the comma-separated adminScopes list
 */
export function hasScope(user: { role: string; adminScopes?: string | null }, scope: string): boolean {
  if (user.role !== "admin") return false;
  const s = (user.adminScopes ?? "").trim();
  if (s === "" || s === "*") return true;
  return s.split(",").map((x) => x.trim()).includes(scope);
}

/** Admin procedure additionally gated on a capability scope. */
export function scopedAdmin(scope: string) {
  return adminQuery.use(async (opts) => {
    const { ctx, next } = opts;
    if (!hasScope(ctx.user as never, scope)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Your admin role doesn't include this action.",
      });
    }
    return next({ ctx });
  });
}

/** Whether an admin holds full/owner access ("*" owner or "" legacy). */
export function isFullAdmin(user: { role: string; adminScopes?: string | null }): boolean {
  if (user.role !== "admin") return false;
  const s = (user.adminScopes ?? "").trim();
  return s === "" || s === "*";
}

/** Admin procedure restricted to a full administrator (owner / director).
 *  Platform configuration and cross-cutting tools live here. */
export const fullAdmin = adminQuery.use(async (opts) => {
  const { ctx, next } = opts;
  if (!isFullAdmin(ctx.user as never)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only a full administrator can do this.",
    });
  }
  return next({ ctx });
});
