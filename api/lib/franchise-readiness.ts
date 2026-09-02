import { CHAPTER_ROLE_LABEL } from "@contracts/constants";

export type ChapterStatus =
  "seed" | "provisional" | "chartered" | "mature" | "at_risk";

export type FranchiseChecklistInput = {
  status: ChapterStatus;
  charterDate?: Date | null;
  zoneId?: number | null;
  memberCount: number;
  activeRoleKeys: string[];
  approvedBudgetAed: number;
  activeCadenceCount: number;
};

export type FranchiseChecklistItem = {
  key: string;
  label: string;
  ok: boolean;
  required: boolean;
  detail?: string;
};

const REQUIRED_ROLES = ["president", "treasurer"] as const;
const MIN_CHARTERED_MEMBERS = 10;
const MIN_APPROVED_BUDGET_AED = 1;
const MIN_CADENCES = 1;

/**
 * Evaluate whether a chapter is ready to operate as a franchised unit.
 *
 * This is pure logic over rows the caller already fetched, so it is trivially
 * testable and safe to run in admin, regional, or officer contexts without
 * extra DB coupling.
 */
export function evaluateFranchiseReadiness(
  input: FranchiseChecklistInput
): FranchiseChecklistItem[] {
  const requiredRoleItems: FranchiseChecklistItem[] = REQUIRED_ROLES.map(
    role => ({
      key: `role_${role}`,
      label: `Active ${CHAPTER_ROLE_LABEL[role] ?? role}`,
      ok: input.activeRoleKeys.includes(role),
      required: true,
      detail: input.activeRoleKeys.includes(role)
        ? `${CHAPTER_ROLE_LABEL[role] ?? role} appointed`
        : `No active ${CHAPTER_ROLE_LABEL[role] ?? role} on the chapter board`,
    })
  );

  return [
    {
      key: "chartered",
      label: "Eligible chapter status",
      ok:
        input.status === "provisional" ||
        input.status === "chartered" ||
        input.status === "mature",
      required: true,
      detail:
        input.status === "provisional" ||
        input.status === "chartered" ||
        input.status === "mature"
          ? `Status: ${input.status}`
          : `Status: ${input.status} — must reach provisional/chartered before franchise launch`,
    },
    {
      key: "charter_date",
      label: "Charter date recorded",
      ok: input.charterDate != null,
      required: true,
      detail: input.charterDate
        ? `Chartered ${input.charterDate.toISOString().slice(0, 10)}`
        : "No charter date set",
    },
    {
      key: "zone_assigned",
      label: "Zone / org unit assigned",
      ok: input.zoneId != null,
      required: true,
      detail: input.zoneId
        ? "Zone assigned"
        : "Chapter is not linked to a zone/region",
    },
    {
      key: "member_count",
      label: `Minimum ${MIN_CHARTERED_MEMBERS} members`,
      ok: input.memberCount >= MIN_CHARTERED_MEMBERS,
      required: true,
      detail: `${input.memberCount} member${input.memberCount === 1 ? "" : "s"} (need ${MIN_CHARTERED_MEMBERS})`,
    },
    ...requiredRoleItems,
    {
      key: "approved_budget",
      label: "Approved operating budget",
      ok: input.approvedBudgetAed >= MIN_APPROVED_BUDGET_AED,
      required: true,
      detail:
        input.approvedBudgetAed >= MIN_APPROVED_BUDGET_AED
          ? `AED ${input.approvedBudgetAed} approved`
          : "No approved budget allocation",
    },
    {
      key: "cadence",
      label: "At least one recurring cadence",
      ok: input.activeCadenceCount >= MIN_CADENCES,
      required: true,
      detail:
        input.activeCadenceCount >= MIN_CADENCES
          ? `${input.activeCadenceCount} active cadence${input.activeCadenceCount === 1 ? "" : "s"}`
          : "No active cadences configured",
    },
  ];
}

/** Aggregate score for a checklist. */
export function readinessScore(items: FranchiseChecklistItem[]) {
  const required = items.filter(i => i.required);
  const passed = required.filter(i => i.ok).length;
  return {
    passed,
    total: required.length,
    ready: passed === required.length && required.length > 0,
    percent: required.length ? Math.round((passed / required.length) * 100) : 0,
  };
}

/** All recognised chapter role keys from the canonical role list. */
export function franchiseRequiredRoleKeys(): readonly string[] {
  return REQUIRED_ROLES as unknown as readonly string[];
}
