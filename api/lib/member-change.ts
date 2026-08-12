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
