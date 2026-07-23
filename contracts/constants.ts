export const Session = {
  cookieName: "kimi_sid",
  maxAgeMs: 365 * 24 * 60 * 60 * 1000,
} as const;

export const ErrorMessages = {
  unauthenticated: "Authentication required",
  insufficientRole: "Insufficient permissions",
} as const;

export const Paths = {
  login: "/login",
  oauthCallback: "/api/oauth/callback",
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
  zenith: "Invitation",
};
export function tierRank(t: string): number {
  const i = TIERS.indexOf(t as Tier);
  return i === -1 ? 0 : i + 1;
}

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
