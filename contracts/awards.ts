/**
 * Pure award-nomination rules — shared by the server (enforcement) and usable by
 * the client (form validation). No DB or environment access, so they're cheap to
 * unit-test.
 */
import { AWARD_CATEGORIES, AWARD_FAIRNESS_WINDOW_DAYS } from "./constants";

export type AwardSubject = "member" | "chapter";

/** The category definition for a key, or null if the key isn't a real category. */
export function awardCategoryByKey(
  key: string
): { key: string; label: string; subject: AwardSubject } | null {
  const c = AWARD_CATEGORIES.find(x => x.key === key);
  return c ? { key: c.key, label: c.label, subject: c.subject } : null;
}

export type WindowState = "before" | "open" | "after";

/** Where `now` falls relative to a cycle's optional open/close window. Null
 *  bounds mean "no bound on that side", so a cycle with neither bound is always
 *  "open" while its status says so. */
export function nominationWindowState(
  opensAt: Date | string | null | undefined,
  closesAt: Date | string | null | undefined,
  now: Date = new Date()
): WindowState {
  const t = now.getTime();
  if (opensAt != null && t < new Date(opensAt).getTime()) return "before";
  if (closesAt != null && t > new Date(closesAt).getTime()) return "after";
  return "open";
}

export interface NominationValidation {
  ok: boolean;
  error?: string;
}

/**
 * Validate a nominee against a category's subject: a "member" category needs a
 * member nominee (and not a chapter), a "chapter" category needs a chapter
 * nominee (and not a member). Rejects unknown categories and empty/ambiguous
 * nominee selections so a crafted API call can't nominate a member for
 * "Chapter of the Year", or vice-versa.
 */
export function validateNomineeForCategory(
  categoryKey: string,
  nominee: {
    nomineeMemberId?: number | null;
    nomineeChapterId?: number | null;
  }
): NominationValidation {
  const category = awardCategoryByKey(categoryKey);
  if (!category) return { ok: false, error: "Unknown award category." };

  const hasMember = nominee.nomineeMemberId != null;
  const hasChapter = nominee.nomineeChapterId != null;
  if (!hasMember && !hasChapter)
    return { ok: false, error: "Choose who you're nominating." };
  if (hasMember && hasChapter)
    return { ok: false, error: "Nominate a member or a chapter, not both." };

  if (category.subject === "member" && !hasMember)
    return {
      ok: false,
      error: `${category.label} recognises a member — choose a member.`,
    };
  if (category.subject === "chapter" && !hasChapter)
    return {
      ok: false,
      error: `${category.label} recognises a chapter — choose a chapter.`,
    };
  return { ok: true };
}

/** The earliest date a member can be nominated again after a win, based on the
 *  fairness window. Returns null if there is no prior win date. */
export function fairnessEligibilityDate(
  lastWonAt: Date | string | null | undefined
): Date | null {
  if (!lastWonAt) return null;
  const d = new Date(lastWonAt);
  d.setDate(d.getDate() + AWARD_FAIRNESS_WINDOW_DAYS);
  return d;
}

/** Whether a member is currently inside the fairness cooling-off window. */
export function isInFairnessWindow(
  lastWonAt: Date | string | null | undefined,
  now: Date = new Date()
): boolean {
  const eligible = fairnessEligibilityDate(lastWonAt);
  if (!eligible) return false;
  return now.getTime() < eligible.getTime();
}
