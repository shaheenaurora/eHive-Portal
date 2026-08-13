import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import {
  MEMBER_LIFECYCLE_TRANSITIONS,
  type MemberLifecycle,
} from "@contracts/constants";
import { audit } from "./audit";
import { notify } from "../queries/circle";
import type { User } from "@db/schema";

/** Auto-driven transitions that are valid but not exposed as admin buttons.
 *  These supplement MEMBER_LIFECYCLE_TRANSITIONS (the UI button list) to form
 *  the complete lifecycle matrix enforced by canTransitionLifecycle(). */
const AUTO_TRANSITIONS: Record<string, string[]> = {
  active: ["lapsed"], // scheduler can lapse a member who never entered renewal
  lapsed: ["active"], // paid win-back renewal
  alumni: ["active"], // paid win-back renewal
};

/**
 * Whether a lifecycle state change is valid. Combines the admin-driven
 * transition map with the small set of auto-only transitions.
 */
export function canTransitionLifecycle(
  from: string | null | undefined,
  to: string
): boolean {
  if (!from) return true; // new records / admissions have no prior state
  if (from === to) return true; // no-op is always allowed
  const adminArrows = MEMBER_LIFECYCLE_TRANSITIONS[from] ?? [];
  if (adminArrows.some(a => a.to === to)) return true;
  const autoArrows = AUTO_TRANSITIONS[from] ?? [];
  return autoArrows.includes(to);
}

/**
 * The access/billing status that must accompany a given lifecycle state.
 * Keeping these coherent prevents a suspended member from still showing
 * "active" billing, or an alumni from retaining live access.
 */
export function statusForLifecycle(
  state: string
): (typeof schema.members.status.enumValues)[number] {
  if (["active", "onboarding", "renewal", "at_risk"].includes(state))
    return "active";
  if (state === "suspended") return "paused";
  return "cancelled";
}

/** Human notification copy for member-facing lifecycle transitions. */
const LIFECYCLE_NOTE: Record<string, string> = {
  active: "Welcome to Active membership — you're all set.",
  at_risk: "We've missed you lately — your chapter would love to see you back.",
  renewal: "Your renewal window is open. Here's your year in review.",
  suspended: "Your membership is under review.",
  alumni: "You're now an eHive Alumnus — the door stays open.",
  onboarding: "Welcome to eHive Circle. Your onboarding journey starts now.",
  lapsed: "Your membership has lapsed. You can renew any time to rejoin.",
};

export type LifecycleTransitionOptions = {
  /** The admin/member driving the change. Optional for automated transitions. */
  actor?: Pick<User, "id" | "email">;
  /** Freeform reason shown in audit log and save cases. */
  reason?: string;
  /** Set false for automated jobs that should not audit as a person. */
  audit?: boolean;
  /** Set false to skip the member notification (e.g. bulk jobs). */
  notify?: boolean;
  /** Set false to skip Save Playbook side effects. */
  manageSaveCase?: boolean;
};

/**
 * Central lifecycle transition executor (Operations Manual M1).
 * Validates the transition, keeps access/billing status coherent, opens/closes
 * Save Playbook cases for at-risk moves, notifies the member, and audits.
 * Throws TRPCError.BAD_REQUEST for invalid transitions.
 */
export async function applyLifecycleTransition(
  memberId: number,
  to: MemberLifecycle,
  options: LifecycleTransitionOptions = {}
): Promise<{
  ok: true;
  from: string | null;
  to: MemberLifecycle;
  changed: boolean;
}> {
  const db = getDb();
  const m = (
    await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.id, memberId))
      .limit(1)
  ).at(0);
  if (!m)
    throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });

  const from = (m as { lifecycleState?: string }).lifecycleState ?? null;
  if (from === to) return { ok: true, from, to, changed: false };

  if (!canTransitionLifecycle(from, to)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Invalid lifecycle transition: ${from ?? "(new)"} → ${to}`,
    });
  }

  const patch: Record<string, unknown> = {
    lifecycleState: to,
    status: statusForLifecycle(to),
  };
  await db
    .update(schema.members)
    .set(patch)
    .where(eq(schema.members.id, memberId));

  // ML-04b — a manual/system at-risk flag opens a tracked Save case;
  // recovery from at_risk closes it.
  if (options.manageSaveCase !== false) {
    if (to === "at_risk" && from !== "at_risk") {
      const { openSaveCase } = await import("../queries/saves");
      await openSaveCase(
        memberId,
        options.reason || "Flagged at-risk.",
        m.homeChapterId
      );
    } else if (to === "active" && from === "at_risk") {
      const { autoCloseSaveOnRecovery } = await import("../queries/saves");
      await autoCloseSaveOnRecovery(
        memberId,
        options.reason || "Returned to Active."
      );
    }
  }

  if (options.notify !== false && LIFECYCLE_NOTE[to]) {
    try {
      await notify(memberId, LIFECYCLE_NOTE[to], "membership");
    } catch {
      /* non-fatal */
    }
  }

  if (options.audit !== false && options.actor) {
    await audit(options.actor, "member.lifecycle", {
      type: "member",
      id: memberId,
      detail: `${from ?? "(new)"} → ${to}${options.reason ? ` (${options.reason})` : ""}`,
    });
  }

  return { ok: true, from, to, changed: true };
}

/**
 * Validate-and-apply wrapper for automated transitions. Instead of throwing,
 * it returns { ok: false, reason } so a scheduler job can log and continue.
 */
export async function tryLifecycleTransition(
  memberId: number,
  to: MemberLifecycle,
  options: LifecycleTransitionOptions = {}
): Promise<
  | { ok: true; from: string | null; to: MemberLifecycle }
  | { ok: false; reason: string }
> {
  try {
    const r = await applyLifecycleTransition(memberId, to, options);
    return { ok: true, from: r.from, to: r.to };
  } catch (e) {
    if (e instanceof TRPCError && e.code === "BAD_REQUEST") {
      return { ok: false, reason: e.message };
    }
    return { ok: false, reason: String(e) };
  }
}
