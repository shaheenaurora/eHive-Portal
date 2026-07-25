export const Session = {
  cookieName: "eh_sid",
  maxAgeMs: 365 * 24 * 60 * 60 * 1000,
} as const;

export const ErrorMessages = {
  unauthenticated: "Authentication required",
  insufficientRole: "Insufficient permissions",
} as const;

export const Paths = {
  login: "/login",
} as const;

/* ---- eHive Circle domain constants (shared frontend <-> backend) ---- */
export const TIERS = ["horizon", "ascent", "vanguard", "zenith"] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_LABEL: Record<Tier, string> = {
  horizon: "Horizon",
  ascent: "Ascent",
  vanguard: "Vanguard",
  zenith: "Zenith",
};
export const TIER_PRICE: Record<Tier, string> = {
  horizon: "AED 999/yr",
  ascent: "AED 5,999/yr",
  vanguard: "AED 11,999/yr",
  zenith: "AED 29,999/yr",
};
export function tierRank(t: string): number {
  const i = TIERS.indexOf(t as Tier);
  return i === -1 ? 0 : i + 1;
}
/** Annual price per tier in whole AED (used to build a checkout amount). */
export const TIER_PRICE_AED: Record<Tier, number> = {
  horizon: 999, ascent: 5999, vanguard: 11999, zenith: 29999,
};
/** Tiers that can be joined by self-serve online payment. Zenith is application-only. */
export const SELF_SERVE_TIERS = ["horizon", "ascent", "vanguard"] as const;
export type SelfServeTier = (typeof SELF_SERVE_TIERS)[number];

export const MEMBER_STATUSES = ["active", "paused", "cancelled"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const APPLICATION_STATUSES = [
  "received",
  "screening",
  "interview",
  "approved",
  "rejected",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const SCORE_FACTORS = [
  "attendance",
  "action_items",
  "events",
  "contribution",
  "frp",
  "tenure",
] as const;
export type ScoreFactor = (typeof SCORE_FACTORS)[number];
export const SCORE_FACTOR_LABEL: Record<ScoreFactor, string> = {
  attendance: "Session attendance",
  action_items: "Action items completed",
  events: "Event participation",
  contribution: "Contribution & mentoring",
  frp: "FRP progress",
  tenure: "Tenure",
};

export const EVENT_KINDS = ["spark", "meetup", "circle", "retreat", "summit"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const MILESTONE_KEYS = ["deck", "model", "dataroom"] as const;
export type MilestoneKey = (typeof MILESTONE_KEYS)[number];
export const MILESTONE_LABEL: Record<MilestoneKey, string> = {
  deck: "Investor deck",
  model: "Financial model",
  dataroom: "Data room",
};
export const MILESTONE_STATUSES = ["not_started", "in_progress", "submitted", "reviewed"] as const;

export const LIBRARY_KINDS = ["playbook", "template", "recording", "note"] as const;


/* ---- BRD v2: engagement engine, dormancy, chapters ---- */

/** Point-rule keys (admin-tunable point values live in point_rules table).
 *  Each key maps to a fixed Hive Score factor bucket. */
export const POINT_RULE_KEYS = [
  "event_attend",
  "session_attend",
  "one_to_one",
  "mentoring",
  "referral_submitted",
  "referral_converted",
  "no_show",
  "no_show_excused",
] as const;
export type PointRuleKey = (typeof POINT_RULE_KEYS)[number];
export const POINT_RULE_LABEL: Record<PointRuleKey, string> = {
  event_attend: "Event attendance",
  session_attend: "Pod session attendance",
  one_to_one: "1-2-1 completed (confirmed)",
  mentoring: "Mentoring / Give-Back session",
  referral_submitted: "Referral submitted",
  referral_converted: "Referral converted",
  no_show: "No-show (unexcused)",
  no_show_excused: "No-show (excused)",
};
/** Fixed mapping point-rule key -> score factor */
export const POINT_RULE_FACTOR: Record<PointRuleKey, ScoreFactor> = {
  event_attend: "events",
  session_attend: "attendance",
  one_to_one: "contribution",
  mentoring: "contribution",
  referral_submitted: "contribution",
  referral_converted: "contribution",
  no_show: "attendance",
  no_show_excused: "attendance",
};
/** BRD default point values (used for seeding point_rules) */
export const POINT_RULE_DEFAULTS: Record<PointRuleKey, number> = {
  event_attend: 5,
  session_attend: 5,
  one_to_one: 3,
  mentoring: 15,
  referral_submitted: 5,
  referral_converted: 10,
  no_show: -10,
  no_show_excused: -5,
};

export const DORMANCY_STAGES = ["active", "at_risk", "dormant", "non_renewal"] as const;
export type DormancyStage = (typeof DORMANCY_STAGES)[number];
export const DORMANCY_LABEL: Record<DormancyStage, string> = {
  active: "Active",
  at_risk: "At Risk",
  dormant: "Dormant",
  non_renewal: "Non-Renewal",
};

export const ONE_TO_ONE_KINDS = ["one_to_one", "mentoring"] as const;
export const REFERRAL_STATUSES = ["submitted", "converted", "rejected"] as const;

export const ZENITH_APP_STATUSES = ["nominated", "endorsing", "review", "approved", "rejected"] as const;
export type ZenithAppStatus = (typeof ZENITH_APP_STATUSES)[number];
export const ZENITH_CAP = 50;

export const CHAPTER_STATUSES = ["seed", "provisional", "chartered", "mature", "at_risk"] as const;
export type ChapterStatus = (typeof CHAPTER_STATUSES)[number];
export const CHAPTER_STATUS_LABEL: Record<ChapterStatus, string> = {
  seed: "Seed",
  provisional: "Provisional",
  chartered: "Chartered",
  mature: "Mature",
  at_risk: "At Risk",
};
export const ELECTION_STATUSES = ["open", "voting", "closed"] as const;
export const MOTION_STATUSES = ["open", "passed", "rejected"] as const;
export const BUDGET_KINDS = ["allocation", "sponsorship", "spend"] as const;
export const BUDGET_STATUSES = ["proposed", "approved", "spent", "rejected"] as const;

export const DATA_REQUEST_KINDS = ["export", "deletion"] as const;

/** Cool-down days before the same investor can be introduced to the same member again */
export const INVESTOR_COOLDOWN_DAYS = 90;
/** Push-notification categories (per-category opt-out; UX-10). Keys align with
 *  the notify() `kind` values so an in-app notification pushes to the matching
 *  category. */
export const PUSH_CATEGORIES = [
  { key: "event", label: "Event reminders & waitlist" },
  { key: "connect", label: "Community, buddy & 1-2-1s" },
  { key: "score", label: "Hive Score & engagement nudges" },
  { key: "membership", label: "Membership & renewals" },
  { key: "governance", label: "Governance & chapters" },
] as const;
export const PUSH_CATEGORY_KEYS = PUSH_CATEGORIES.map((c) => c.key);

/* ---- Admin capability scopes (segregation of duties). Modelled on the eHive
   Circle pillar's org roles so a staff member's portal access matches their
   actual job. An admin whose adminScopes is "" has full access (back-compat);
   "*" is explicit full access (Director eHive Circle / COO / CEO). Otherwise
   the admin may only perform actions whose scope is in their list. ---- */
export const ADMIN_SCOPES = [
  { key: "membership", label: "Membership Growth — applications, admissions, tiers & status" },
  { key: "community", label: "Community Manager — pods, buddies, 1-2-1s & referrals" },
  { key: "events", label: "Programming & Events — events, sessions & check-in" },
  { key: "chapters", label: "Chapter Development — chapters, governance & elections" },
  { key: "member_success", label: "Member Success — Zenith concierge & dormancy" },
  { key: "partnerships", label: "Partnerships & Member Value — offers, deals & investor intros" },
  { key: "content", label: "Content & Editorial — Hive Journal, library & insights" },
  { key: "finance", label: "Finance & Compliance — payments, leads & PDPL data requests" },
] as const;
export type AdminScope = (typeof ADMIN_SCOPES)[number]["key"];
export const ADMIN_SCOPE_KEYS = ADMIN_SCOPES.map((s) => s.key);

/** Leads CRM pipeline. */
export const LEAD_STATUSES = ["new", "contacted", "qualified", "won", "lost"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New", contacted: "Contacted", qualified: "Qualified", won: "Won", lost: "Lost",
};

/** Verification / reset token lifetimes (ms). */
export const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;   // 24h
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;         // 1h

/** Days within which a new member must be paired with a buddy */
export const BUDDY_PAIR_WITHIN_DAYS = 5;
/** Days after pairing for the buddy 30-day check-in */
export const BUDDY_CHECKIN_DAYS = 30;
