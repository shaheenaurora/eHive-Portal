/** Pure (DB-free) governance logic for member change requests, so it can be
 *  unit-tested without pulling in the database layer. */

export type Actor = {
  id: number;
  email: string;
  role: string;
  adminScopes?: string | null;
};
export type ChangeCategory =
  "profile" | "tier" | "status" | "lifecycle" | "chapter";
export type FieldChange = {
  field: string;
  label: string;
  from: string | null;
  to: string | null;
};
export type ChangeSource = "member" | "officer" | "admin";
export type Activity = {
  at: Date;
  kind: string;
  icon: string;
  title: string;
  detail?: string;
  actor?: string;
};

/** High-impact categories always route through approval and require a reason. */
export const HIGH_IMPACT: ReadonlySet<ChangeCategory> = new Set([
  "tier",
  "status",
  "lifecycle",
]);

/** Editable member-profile fields → label + which table the column lives on. */
export const PROFILE_FIELDS: Record<
  string,
  { label: string; table: "users" | "members" }
> = {
  name: { label: "Name", table: "users" },
  email: { label: "Email", table: "users" },
  phone: { label: "Phone", table: "members" },
  title: { label: "Title", table: "members" },
  company: { label: "Company", table: "members" },
  sector: { label: "Sector", table: "members" },
  stage: { label: "Stage", table: "members" },
  goals: { label: "Goals", table: "members" },
};

/** Maker ≠ checker: an approver must never be the person who requested. */
export function violatesFourEyes(
  actorUserId: number,
  requestedByUserId: number
): boolean {
  return actorUserId === requestedByUserId;
}

/** Who may approve a member change request: a full/owner admin, a `membership`
 *  capability holder, or the chapter lead of the member's home chapter. */
export function canApprove(
  actor: Actor,
  opts: { leadsMemberChapter: boolean }
): boolean {
  if (actor.role === "admin") {
    const s = (actor.adminScopes ?? "").trim();
    if (s === "" || s === "*") return true;
    if (
      s
        .split(",")
        .map(x => x.trim())
        .includes("membership")
    )
      return true;
  }
  return opts.leadsMemberChapter;
}

/** Merge many activity sources into one ledger, newest first. Pure over its input. */
export function mergeActivity(streams: Activity[][]): Activity[] {
  return streams
    .flat()
    .filter(a => a.at instanceof Date && !Number.isNaN(a.at.getTime()))
    .sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** Human one-liner for a set of field changes. */
export function summarise(changes: FieldChange[]): string {
  return changes
    .map(c => `${c.label}: ${c.from || "—"} → ${c.to || "—"}`)
    .join("; ");
}

/** Tier-change business rules (BRD 9.1). Returns {ok:true} or {ok:false,reason}.
 *  - active members only
 *  - must have been in the current tier for at least `minTenureDays`
 *  - cannot downgrade within `cooldownDays` of a recent upgrade
 *  - zenith is application-only and cannot be self-served */
import { tierRank } from "@contracts/constants";

export function canChangeTier(
  member: { status: string; tier: string; createdAt: Date },
  toTier: string,
  history: { type: string; toTier: string | null; createdAt: Date }[],
  opts: {
    minTenureDays?: number;
    upgradeCooldownDays?: number;
    isSelfServe?: boolean;
  } = {}
): { ok: true } | { ok: false; reason: string } {
  const minTenureDays = opts.minTenureDays ?? 90;
  const upgradeCooldownDays = opts.upgradeCooldownDays ?? 30;
  const isSelfServe = opts.isSelfServe ?? false;

  if (member.status !== "active") {
    return {
      ok: false,
      reason: "Tier changes are only allowed for active members.",
    };
  }
  if (toTier === member.tier) {
    return { ok: false, reason: "That's already the current tier." };
  }
  if (isSelfServe && toTier === "zenith") {
    return { ok: false, reason: "Zenith membership is by invitation only." };
  }

  // Find when the member entered the current tier.
  const tierEvents = history
    .filter(
      h => ["upgrade", "downgrade", "approved"].includes(h.type) && h.toTier
    )
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const currentTierEvent = tierEvents.find(h => h.toTier === member.tier);
  const tierSince = currentTierEvent?.createdAt ?? member.createdAt;
  const daysInTier = Math.floor(
    (Date.now() - tierSince.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (daysInTier < minTenureDays) {
    return {
      ok: false,
      reason: `You must be in your current tier for at least ${minTenureDays} days before changing.`,
    };
  }

  // Prevent gaming the system by upgrading then immediately downgrading.
  const lastUpgrade = tierEvents.find(
    h =>
      h.type === "upgrade" ||
      (h.type === "approved" && tierRank(h.toTier!) > tierRank(member.tier))
  );
  if (lastUpgrade && tierRank(toTier) < tierRank(member.tier)) {
    const daysSinceUpgrade = Math.floor(
      (Date.now() - lastUpgrade.createdAt.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysSinceUpgrade < upgradeCooldownDays) {
      return {
        ok: false,
        reason: `Downgrades are not allowed within ${upgradeCooldownDays} days of an upgrade.`,
      };
    }
  }

  return { ok: true };
}
