export const Session = {
  cookieName: "eh_sid",
  // Cookie lifetime is kept in step with the signed-token expiry (see
  // SESSION_EXPIRES_IN in api/lib/session.ts) so the cookie doesn't linger long
  // after the JWT it carries has expired.
  maxAgeMs: 7 * 24 * 60 * 60 * 1000,
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
  horizon: 999,
  ascent: 5999,
  vanguard: 11999,
  zenith: 29999,
};
/** Tiers that can be joined by self-serve online payment. Zenith is application-only. */
export const SELF_SERVE_TIERS = ["horizon", "ascent", "vanguard"] as const;
export type SelfServeTier = (typeof SELF_SERVE_TIERS)[number];

export const MEMBER_STATUSES = ["active", "paused", "cancelled"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

/* Onboarding — the first 30/60/90 days (Operations Manual ML-03). The single
   biggest driver of retention: staged milestones the platform tracks and nudges
   against. `auto` milestones are detected from activity; the rest are checked
   off by the member (or confirmed by the VP Membership). */
export const ONBOARDING_STAGES = [
  { stage: 1, label: "Orientation", window: "Days 0–30" },
  { stage: 2, label: "Integration", window: "Days 31–60" },
  { stage: 3, label: "Contribution", window: "Days 61–90" },
] as const;
export const ONBOARDING_MILESTONES = [
  {
    key: "profile_complete",
    stage: 1,
    auto: true,
    label: "Complete your profile",
  },
  {
    key: "first_meeting",
    stage: 1,
    auto: true,
    label: "Attend your first meeting",
  },
  {
    key: "buddy_assigned",
    stage: 1,
    auto: true,
    label: "Get paired with a buddy",
  },
  {
    key: "ask_offer",
    stage: 1,
    auto: false,
    label: "Post your first ask & offer",
  },
  { key: "pod_placed", stage: 2, auto: true, label: "Join a POD" },
  {
    key: "pod_meeting",
    stage: 2,
    auto: true,
    label: "Attend your first POD meeting",
  },
  {
    key: "three_connections",
    stage: 2,
    auto: false,
    label: "Make three connections",
  },
  {
    key: "first_contribution",
    stage: 3,
    auto: false,
    label: "Make your first contribution — a win, an ask or a spotlight",
  },
  { key: "benefit_used", stage: 3, auto: false, label: "Use a member benefit" },
  {
    key: "check_in_90",
    stage: 3,
    auto: false,
    label: "Complete your 90-day check-in",
  },
] as const;
export type OnboardingKey = (typeof ONBOARDING_MILESTONES)[number]["key"];
export const ONBOARDING_MANUAL_KEYS = ONBOARDING_MILESTONES.filter(
  m => !m.auto
).map(m => m.key) as string[];
/** POD placement is due by day 60 (ML-03). */
export const ONBOARDING_POD_BY_DAY = 60;
export const ONBOARDING_DAYS = 90;

/* Member Lifecycle — the CRM state machine (Operations Manual M1 / Figure 2).
   `status` above is access/billing; this is the member's journey state. Each
   transition is an SOP with an owner, a trigger and a notification. */
export const MEMBER_LIFECYCLE = [
  {
    key: "prospect",
    label: "Prospect",
    kind: "top",
    desc: "Captured and nurtured — top of the funnel.",
  },
  {
    key: "guest",
    label: "Guest",
    kind: "top",
    desc: "Attending as a visitor.",
  },
  {
    key: "applicant",
    label: "Applicant",
    kind: "top",
    desc: "Applied to join; in screening.",
  },
  {
    key: "onboarding",
    label: "Onboarding",
    kind: "new",
    desc: "First 30/60/90 days — orientation, POD placement, first contribution.",
  },
  {
    key: "active",
    label: "Active",
    kind: "good",
    desc: "Engaged, in a POD, contributing.",
  },
  {
    key: "at_risk",
    label: "At-Risk",
    kind: "risk",
    desc: "Early-warning flag — disengaging; needs a personal save.",
  },
  {
    key: "renewal",
    label: "Renewal",
    kind: "renew",
    desc: "Annual decision point — value conversation, year in review.",
  },
  { key: "lapsed", label: "Lapsed", kind: "risk", desc: "Did not renew." },
  {
    key: "alumni",
    label: "Alumni",
    kind: "top",
    desc: "Stays in the network; win-back preserved.",
  },
  {
    key: "suspended",
    label: "Suspended",
    kind: "risk",
    desc: "Under a conduct process.",
  },
] as const;
export type MemberLifecycle = (typeof MEMBER_LIFECYCLE)[number]["key"];
export const MEMBER_LIFECYCLE_LABEL: Record<string, string> =
  Object.fromEntries(MEMBER_LIFECYCLE.map(s => [s.key, s.label]));
export const MEMBER_LIFECYCLE_DESC: Record<string, string> = Object.fromEntries(
  MEMBER_LIFECYCLE.map(s => [s.key, s.desc])
);
/** Pill colour per lifecycle state for the CRM board. */
export const MEMBER_LIFECYCLE_COLOR: Record<
  string,
  "grey" | "blue" | "gold" | "green" | "red" | "purple"
> = {
  prospect: "grey",
  guest: "blue",
  applicant: "purple",
  onboarding: "gold",
  active: "green",
  at_risk: "red",
  renewal: "gold",
  lapsed: "red",
  alumni: "grey",
  suspended: "red",
};
/** The transitions an admin may drive from each state (the arrows in Figure 2),
 *  each with the label shown on the button. Auto-transitions (admission,
 *  at-risk detection, renewal window) also exist server-side. */
export const MEMBER_LIFECYCLE_TRANSITIONS: Record<
  string,
  { to: string; label: string }[]
> = {
  prospect: [
    { to: "guest", label: "Invited" },
    { to: "applicant", label: "Applied" },
  ],
  guest: [
    { to: "applicant", label: "Applied" },
    { to: "alumni", label: "Stay in network" },
  ],
  applicant: [{ to: "onboarding", label: "Admit" }],
  onboarding: [
    { to: "active", label: "Activate" },
    { to: "at_risk", label: "Flag at-risk" },
  ],
  active: [
    { to: "at_risk", label: "Flag at-risk" },
    { to: "renewal", label: "Open renewal" },
    { to: "suspended", label: "Suspend (conduct)" },
  ],
  at_risk: [
    { to: "active", label: "Saved" },
    { to: "renewal", label: "Open renewal" },
    { to: "suspended", label: "Suspend (conduct)" },
  ],
  renewal: [
    { to: "active", label: "Renewed" },
    { to: "lapsed", label: "Not renewed" },
  ],
  lapsed: [
    { to: "alumni", label: "Re-home to Alumni" },
    { to: "onboarding", label: "Win-back → re-admit" },
  ],
  alumni: [{ to: "applicant", label: "Win-back → apply" }],
  suspended: [
    { to: "active", label: "Reinstate" },
    { to: "alumni", label: "Remove → Alumni" },
  ],
};

/* ML-04b — the Save Playbook. When a member is flagged At-Risk, Member Success
   works a structured, tracked intervention (owner + steps + outcome) rather
   than a silent state flip. These are the ordered steps of that playbook; a
   case stores which are done as a bitmask over this array. */
export const SAVE_PLAYBOOK_STEPS = [
  {
    key: "reach_out",
    label: "Reach out personally",
    hint: "A real 1:1 message or call within 3 business days — not an automated nudge.",
  },
  {
    key: "diagnose",
    label: "Understand the disengagement",
    hint: "Ask what changed. Time, fit, value, life event? Listen before pitching.",
  },
  {
    key: "remap_value",
    label: "Re-map value to their goals",
    hint: "Connect a specific eHive benefit to what they're actually trying to do now.",
  },
  {
    key: "next_step",
    label: "Offer one concrete next step",
    hint: "A specific session, intro, or 1:1 with a date — low-friction and soon.",
  },
  {
    key: "confirm",
    label: "Confirm re-engagement",
    hint: "They showed up / booked / re-committed. Only then is the save real.",
  },
] as const;
export type SavePlaybookStepKey = (typeof SAVE_PLAYBOOK_STEPS)[number]["key"];
export const SAVE_CASE_STATUSES = ["open", "working", "saved", "lost"] as const;
export type SaveCaseStatus = (typeof SAVE_CASE_STATUSES)[number];

/* Role Onboarding Playbook — the first-90-days checklist a newly-appointed
   chapter officer works to get productive in their role. Stored as a bitmask on
   the chapter_roles appointment. Generic across roles; each officer also has
   their role-specific responsibilities from CHAPTER_ROLES. */
export const ROLE_ONBOARDING_STEPS = [
  {
    key: "charter",
    label: "Read the charter & code of conduct",
    hint: "The chapter charter and the Circle rules you're now a custodian of.",
  },
  {
    key: "role",
    label: "Know your role & success metric",
    hint: "Your responsibilities and how the role is measured — from the role handbook.",
  },
  {
    key: "handover",
    label: "Meet the board & take handover",
    hint: "Sit down with the President and your predecessor; inherit the open threads.",
  },
  {
    key: "access",
    label: "Get your tools & records",
    hint: "Access to the systems, budget, roll, or calendar your role owns.",
  },
  {
    key: "plan",
    label: "Agree your first 90-day priorities",
    hint: "Three things you'll move this term, signed off with the President.",
  },
] as const;
export type RoleOnboardingStepKey =
  (typeof ROLE_ONBOARDING_STEPS)[number]["key"];

/* Member KYC (Know Your Customer) — identity verification for compliance. */
export const KYC_ID_TYPES = [
  { key: "emirates_id", label: "Emirates ID" },
  { key: "passport", label: "Passport" },
  { key: "other", label: "Other government ID" },
] as const;
export type KycIdType = (typeof KYC_ID_TYPES)[number]["key"];
export const KYC_ID_TYPE_KEYS = KYC_ID_TYPES.map(t => t.key) as KycIdType[];
export const KYC_ID_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  KYC_ID_TYPES.map(t => [t.key, t.label])
);
export const KYC_STATUS_LABEL: Record<string, string> = {
  not_submitted: "Not submitted",
  submitted: "Awaiting review",
  verified: "Verified",
  rejected: "Rejected",
};
/** Show only the last 4 characters of an ID number; mask the rest. */
export function maskIdNumber(id?: string | null): string {
  const s = (id ?? "").trim();
  if (!s) return "";
  if (s.length <= 4) return "•".repeat(s.length);
  return "•".repeat(Math.max(0, s.length - 4)) + s.slice(-4);
}

/* Chapter expense categories — so spend can be recorded by type and reported
   as a spend-by-category breakdown, not just a free-text label. */
export const EXPENSE_CATEGORIES = [
  { key: "venue", label: "Venue & facilities" },
  { key: "catering", label: "Catering & F&B" },
  { key: "speaker", label: "Speakers & talent" },
  { key: "marketing", label: "Marketing & content" },
  { key: "travel", label: "Travel & transport" },
  { key: "materials", label: "Materials & printing" },
  { key: "software", label: "Software & tools" },
  { key: "gifts", label: "Gifts & recognition" },
  { key: "admin", label: "Administration" },
  { key: "other", label: "Other" },
] as const;
export type ExpenseCategoryKey = (typeof EXPENSE_CATEGORIES)[number]["key"];
export const EXPENSE_CATEGORY_KEYS = EXPENSE_CATEGORIES.map(
  c => c.key
) as ExpenseCategoryKey[];
export const EXPENSE_CATEGORY_LABEL: Record<string, string> =
  Object.fromEntries(EXPENSE_CATEGORIES.map(c => [c.key, c.label]));

/* NA-03 — Recognition Awards. Members nominate peers (and chapters) across
   these categories within an award cycle; the National body shortlists and
   names winners. `subject` says what's being recognised. */
export const AWARD_CATEGORIES = [
  {
    key: "member_of_year",
    label: "Member of the Year",
    subject: "member",
    blurb: "The member who best embodied Build. Belong. Become. this year.",
  },
  {
    key: "newcomer",
    label: "Newcomer of the Year",
    subject: "member",
    blurb: "The standout first-year member.",
  },
  {
    key: "mentor",
    label: "Mentor of the Year",
    subject: "member",
    blurb: "The member who gave the most to others' growth.",
  },
  {
    key: "connector",
    label: "Connector of the Year",
    subject: "member",
    blurb: "The member who opened the most doors — intros, referrals, deals.",
  },
  {
    key: "chapter_of_year",
    label: "Chapter of the Year",
    subject: "chapter",
    blurb: "The healthiest, most alive chapter of the year.",
  },
  {
    key: "community_impact",
    label: "Community Impact",
    subject: "member",
    blurb: "For give-back that moved the wider community, not just the Circle.",
  },
] as const;
export type AwardCategoryKey = (typeof AWARD_CATEGORIES)[number]["key"];
export const AWARD_CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  AWARD_CATEGORIES.map(c => [c.key, c.label])
);

/* Award levels — a cycle is run at one of these levels. Chapter/zone/region/
   country cycles are scoped to a specific unit (unitId); network is the whole
   organisation (no unit). Mirrors the network/chapter/zone/region/country scope
   taxonomy used elsewhere. */
export const AWARD_LEVELS = [
  { key: "network", label: "Network (national)", unit: null },
  { key: "chapter", label: "Chapter", unit: "chapter" },
  { key: "zone", label: "Zone", unit: "zone" },
  { key: "region", label: "Region", unit: "region" },
  { key: "country", label: "Country", unit: "country" },
] as const;
export type AwardLevel = (typeof AWARD_LEVELS)[number]["key"];
export const AWARD_LEVEL_KEYS = AWARD_LEVELS.map(l => l.key) as AwardLevel[];
export const AWARD_LEVEL_LABEL: Record<string, string> = Object.fromEntries(
  AWARD_LEVELS.map(l => [l.key, l.label])
);
/** Whether a given award level needs a specific unit selected (everything but network). */
export function awardLevelNeedsUnit(level: string): boolean {
  return level !== "network";
}
/** Fairness cap: an auto-scored award can't go to the same member twice within
 *  this window, so recognition rotates rather than entrenching one star
 *  (Awards spec §8.2 — "no back-to-back monthly wins"). ~45 days covers the
 *  previous monthly cycle. */
export const AWARD_FAIRNESS_WINDOW_DAYS = 45;
/** Recognition points awarded to a member on a conferred win (feeds the
 *  leadership pipeline / Hall-of-Fame tracker; Open Decision §9 #7). */
export const AWARD_RECOGNITION_POINTS = 20;

/* --- Honours & lifetime distinctions (Awards spec Part 6, Table 18/19) --- */
/** The Hive Score at or above which a member counts as "champion band" for a
 *  year — the top contribution band (see badge thresholds). */
export const HIVE_CHAMPION_BAND = 80;
/** Hall of Fame auto-qualification bars (multi-year record). A member must have
 *  reached champion band in ≥3 years, won ≥3 annual awards, and carry a clean
 *  standing (no upheld conduct matter, ever) — then a panel ratifies induction. */
export const HALL_OF_FAME_MIN_CHAMPION_YEARS = 3;
export const HALL_OF_FAME_MIN_ANNUAL_AWARDS = 3;
/** Contribution-depth target (converted referrals + confirmed mentoring across
 *  tenure) that scores full marks on that criterion. */
export const HALL_OF_FAME_CONTRIBUTION_TARGET = 20;
/** Structural scarcity: the maximum number of Hall of Fame inductions the portal
 *  will confer per calendar year (Table 19 / Open Decision §9 #4). */
export const HALL_OF_FAME_ANNUAL_INTAKE = 3;
/** Recognition points for a Hall of Fame induction — a lifetime honour weighs
 *  far more than an annual win. */
export const HALL_OF_FAME_POINTS = 100;
/** The award key under which Hall of Fame inductions are recorded (immutable,
 *  permanent — a member is inducted once). */
export const HALL_OF_FAME_AWARD_KEY = "hall_of_fame";
export const AWARD_CYCLE_STATUSES = [
  "draft",
  "open",
  "judging",
  "announced",
  "closed",
] as const;
export type AwardCycleStatus = (typeof AWARD_CYCLE_STATUSES)[number];
export const AWARD_NOMINATION_STATUSES = [
  "nominated",
  "shortlisted",
  "winner",
  "declined",
] as const;
export type AwardNominationStatus = (typeof AWARD_NOMINATION_STATUSES)[number];

/* ML-05 Renewal — the annual decision window. The scheduler opens the window
   RENEWAL_WINDOW_DAYS before the renewal date and auto-lapses a membership that
   stays unrenewed RENEWAL_GRACE_DAYS past it. */
export const RENEWAL_WINDOW_DAYS = 30;
export const RENEWAL_GRACE_DAYS = 14;

/** Where a membership sits relative to its renewal date (pure — testable, and
 *  shared by the scheduler and any UI countdown). */
export function renewalStage(
  renewalAt: Date,
  now: Date,
  windowDays = RENEWAL_WINDOW_DAYS,
  graceDays = RENEWAL_GRACE_DAYS
): "none" | "window" | "lapse" {
  const dayMs = 86_400_000;
  const diffDays = (renewalAt.getTime() - now.getTime()) / dayMs;
  if (diffDays < -graceDays) return "lapse"; // past due beyond grace
  if (diffDays <= windowDays) return "window"; // window open (incl. grace period)
  return "none";
}

/* Membership change events carry an approval state. Self-serve actions (pause,
   cancel, renew) are recorded as `applied`; tier upgrades/downgrades a member
   requests are `pending` until management approves or rejects them. */
export const MEMBERSHIP_EVENT_STATUSES = [
  "applied",
  "pending",
  "approved",
  "rejected",
] as const;
export type MembershipEventStatus = (typeof MEMBERSHIP_EVENT_STATUSES)[number];
export const MEMBERSHIP_EVENT_STATUS_LABEL: Record<
  MembershipEventStatus,
  string
> = {
  applied: "Applied",
  pending: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
};

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

/* Activity master — the full catalogue of eHive Circle activity types. Any of
   these can be scheduled from Calendar management with its own audience. Keep in
   sync with the `kind` enum in db/schema.ts. */
export const EVENT_KINDS = [
  "spark",
  "meetup",
  "circle",
  "retreat",
  "summit",
  "conference",
  "conclave",
  "roundtable",
  "workshop",
  "masterclass",
  "breakfast",
  "lunch",
  "dinner",
  "social",
  "webinar",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  spark: "Spark Evening",
  meetup: "Meetup",
  circle: "Circle Dinner",
  retreat: "Retreat",
  summit: "Summit",
  conference: "Conference",
  conclave: "Conclave",
  roundtable: "Roundtable",
  workshop: "Workshop",
  masterclass: "Masterclass",
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  social: "Social",
  webinar: "Webinar",
};
export const EVENT_KIND_COLOR: Record<
  EventKind,
  "blue" | "purple" | "green" | "gold" | "grey"
> = {
  spark: "blue",
  meetup: "grey",
  circle: "purple",
  retreat: "green",
  summit: "gold",
  conference: "gold",
  conclave: "purple",
  roundtable: "blue",
  workshop: "blue",
  masterclass: "gold",
  breakfast: "green",
  lunch: "green",
  dinner: "purple",
  social: "grey",
  webinar: "blue",
};

/* Who an activity is for. `public` shows it to everyone (incl. prospects);
   `members` opens it to every tier; `tiers` restricts it to a named set. */
export const EVENT_AUDIENCES = ["public", "members", "tiers"] as const;
export type EventAudience = (typeof EVENT_AUDIENCES)[number];
export const EVENT_AUDIENCE_LABEL: Record<EventAudience, string> = {
  public: "Public — open to everyone",
  members: "All members — every tier",
  tiers: "Specific tiers only",
};

/** Attendance can only be recorded inside this window around the start time —
 *  a member cannot check in to an event that hasn't happened yet. */
export const EVENT_CHECKIN_OPENS_BEFORE_MS = 2 * 60 * 60 * 1000; // 2h before start
export const EVENT_CHECKIN_CLOSES_AFTER_MS = 12 * 60 * 60 * 1000; // 12h after start

/** The tiers eligible to see & join an event, given its audience settings.
 *  `members`/`public` → every tier at or above the (legacy) tier gate;
 *  `tiers` → exactly the named set. Shared by client and server. */
export function eventEligibleTiers(ev: {
  audience?: string | null;
  audienceTiers?: string | null;
  tierGate?: string | null;
}): Tier[] {
  if (ev.audience === "tiers") {
    const set = (ev.audienceTiers ?? "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
    const valid = set.filter((t): t is Tier =>
      (TIERS as readonly string[]).includes(t)
    );
    return valid.length ? valid : [...TIERS];
  }
  const floor = tierRank(ev.tierGate || "horizon");
  return TIERS.filter(t => tierRank(t) >= floor);
}
/** Whether a member of `tier` may access an event under its audience rules. */
export function memberCanAccessEvent(
  tier: string,
  ev: {
    audience?: string | null;
    audienceTiers?: string | null;
    tierGate?: string | null;
  }
): boolean {
  return (eventEligibleTiers(ev) as string[]).includes(tier);
}

export const MILESTONE_KEYS = ["deck", "model", "dataroom"] as const;
export type MilestoneKey = (typeof MILESTONE_KEYS)[number];
export const MILESTONE_LABEL: Record<MilestoneKey, string> = {
  deck: "Investor deck",
  model: "Financial model",
  dataroom: "Data room",
};
export const MILESTONE_STATUSES = [
  "not_started",
  "in_progress",
  "submitted",
  "reviewed",
] as const;

export const LIBRARY_KINDS = [
  "playbook",
  "template",
  "recording",
  "note",
] as const;

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

export const DORMANCY_STAGES = [
  "active",
  "at_risk",
  "dormant",
  "non_renewal",
] as const;
export type DormancyStage = (typeof DORMANCY_STAGES)[number];
export const DORMANCY_LABEL: Record<DormancyStage, string> = {
  active: "Active",
  at_risk: "At Risk",
  dormant: "Dormant",
  non_renewal: "Non-Renewal",
};

export const ONE_TO_ONE_KINDS = ["one_to_one", "mentoring"] as const;
export const REFERRAL_STATUSES = [
  "submitted",
  "converted",
  "rejected",
] as const;

export const ZENITH_APP_STATUSES = [
  "nominated",
  "endorsing",
  "review",
  "approved",
  "rejected",
] as const;
export type ZenithAppStatus = (typeof ZENITH_APP_STATUSES)[number];
export const ZENITH_CAP = 50;

export const CHAPTER_STATUSES = [
  "seed",
  "provisional",
  "chartered",
  "mature",
  "at_risk",
] as const;
export type ChapterStatus = (typeof CHAPTER_STATUSES)[number];
export const CHAPTER_STATUS_LABEL: Record<ChapterStatus, string> = {
  seed: "Seed",
  provisional: "Provisional",
  chartered: "Chartered",
  mature: "Mature",
  at_risk: "At Risk",
};
/* Chapter Board — the elected leadership of a chapter, per the eHive Circle
   Member Governance & Leadership Hierarchy (§4.1). Each office carries its
   responsibilities and the number it is accountable for ("every leader owns a
   number"). Terms are one year with a two-consecutive-term limit; `other`
   allows an optional Member Experience Officer or a custom seat. */
export const CHAPTER_ROLES = [
  {
    key: "president",
    label: "President",
    responsibilities:
      "Chairs the board and the chapter. Owns overall chapter health, represents the chapter on the Zone Council, sets the annual plan, and is custodian of chapter culture and the code of conduct.",
    metric: "Chapter health index; member retention",
  },
  {
    key: "vice_president",
    label: "Vice President / President-Elect",
    responsibilities:
      "Deputises for the President, owns one major portfolio for the year, and prepares to assume the presidency — the succession mechanism that makes each handover deliberate.",
    metric: "Readiness to lead; portfolio delivery",
  },
  {
    key: "secretary",
    label: "Secretary",
    responsibilities:
      "Guardian of governance: agendas, minutes, the member roll, the chapter charter, elections administration and compliance with Circle rules.",
    metric: "Governance compliance; accurate records & roll",
  },
  {
    key: "treasurer",
    label: "Treasurer",
    responsibilities:
      "Owns the chapter budget and any locally raised funds within eHive's financial controls. Reconciles, reports monthly, and enforces spend limits.",
    metric: "Financial compliance; budget accuracy; clean audit",
  },
  {
    key: "vp_membership",
    label: "VP Membership",
    responsibilities:
      "Owns growth and retention: the prospect pipeline, guest experience, onboarding of new members, and the early-warning system for members at risk of lapsing.",
    metric: "Net member growth; retention rate; onboarding completion",
  },
  {
    key: "vp_programming",
    label: "VP Programming",
    responsibilities:
      "Owns the calendar: regular meetings, signature events, speakers and formats that make attendance worth the members' time.",
    metric: "Event cadence & attendance; programme satisfaction",
  },
  {
    key: "vp_learning",
    label: "VP Learning & Mentorship",
    responsibilities:
      "Owns member development: peer mentoring, connection to eHive's methodology and content, and the deliberate matching that turns a room of strangers into a network.",
    metric: "Mentoring pairs active; member development participation",
  },
  {
    key: "vp_communications",
    label: "VP Communications",
    responsibilities:
      "Owns the chapter's voice within brand guardrails: member stories, internal communication and the chapter's public presence, with the Community Manager.",
    metric: "Communication reach; brand compliance",
  },
  {
    key: "past_president",
    label: "Immediate Past President",
    responsibilities:
      "Continuity and counsel. Chairs Nominations & Elections, mentors the President, and holds institutional memory across the handover.",
    metric: "Election integrity; leadership pipeline depth",
  },
  {
    key: "member_experience",
    label: "Member Experience Officer",
    responsibilities:
      "Optional in larger chapters: owns in-room culture, new-member integration and the standard of conduct at events.",
    metric: "In-room culture; new-member integration",
  },
  { key: "other", label: "Other role", responsibilities: "", metric: "" },
] as const;
export type ChapterRoleKey = (typeof CHAPTER_ROLES)[number]["key"];
export const CHAPTER_ROLE_LABEL: Record<string, string> = Object.fromEntries(
  CHAPTER_ROLES.map(r => [r.key, r.label])
);
export const CHAPTER_ROLE_RESP: Record<string, string> = Object.fromEntries(
  CHAPTER_ROLES.map(r => [r.key, r.responsibilities])
);

/** Map a free-text election seat (e.g. "President", "VP Membership") to a
 *  chapter-role key so an election can auto-fill the seat on close. Unrecognised
 *  seats become the generic "other" role, keeping the seat text as the title.
 *  Pure — matches on an alias table then exact label/key, never loose substrings
 *  (so "President-Elect" resolves to Vice President, not President). */
export function seatToChapterRole(seat: string): {
  role: ChapterRoleKey;
  title: string | null;
} {
  const norm = (x: string) =>
    x
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const s = norm(seat);
  const fallback = {
    role: "other" as ChapterRoleKey,
    title: seat.trim().slice(0, 128) || "Officer",
  };
  if (!s) return fallback;
  const aliases: Record<string, ChapterRoleKey> = {
    president: "president",
    chair: "president",
    chairperson: "president",
    "vice president": "vice_president",
    vp: "vice_president",
    "president elect": "vice_president",
    "vice president president elect": "vice_president",
    secretary: "secretary",
    "general secretary": "secretary",
    treasurer: "treasurer",
    "vp membership": "vp_membership",
    membership: "vp_membership",
    "vp programming": "vp_programming",
    programming: "vp_programming",
    programmes: "vp_programming",
    "vp learning": "vp_learning",
    "vp learning mentorship": "vp_learning",
    learning: "vp_learning",
    mentorship: "vp_learning",
    "vp communications": "vp_communications",
    communications: "vp_communications",
    "past president": "past_president",
    "immediate past president": "past_president",
    "member experience": "member_experience",
    "member experience officer": "member_experience",
  };
  if (aliases[s]) return { role: aliases[s], title: null };
  for (const r of CHAPTER_ROLES)
    if (r.key !== "other" && norm(r.label) === s)
      return { role: r.key, title: null };
  for (const r of CHAPTER_ROLES)
    if (r.key !== "other" && norm(r.key) === s)
      return { role: r.key, title: null };
  return fallback;
}
export const CHAPTER_ROLE_METRIC: Record<string, string> = Object.fromEntries(
  CHAPTER_ROLES.map(r => [r.key, r.metric])
);
/** Chapter offices are one-year terms, max two consecutive (§9). */
export const CHAPTER_TERM_LIMIT_CONSECUTIVE = 2;
/** Human title for a stored role row (custom title wins for `other`). */
export function chapterRoleTitle(
  role: string,
  customTitle?: string | null
): string {
  if (role === "other") return customTitle || "Officer";
  return CHAPTER_ROLE_LABEL[role] ?? role;
}

/* Chapter Health Index (Operations Manual M7 / §4.4 / CH-06). The single number
   the President owns — a weighted blend of six measures, each 0–100. */
export const HEALTH_COMPONENTS = [
  {
    key: "retention",
    label: "Retention",
    weight: 25,
    desc: "Share of members who stay — the truest test of value.",
  },
  {
    key: "engagement",
    label: "Engagement",
    weight: 25,
    desc: "Active participation, not just headcount on the roll.",
  },
  {
    key: "growth",
    label: "Growth",
    weight: 15,
    desc: "Net new members against the chapter's stage target.",
  },
  {
    key: "programme",
    label: "Programme",
    weight: 15,
    desc: "A consistent calendar delivered, not promised.",
  },
  {
    key: "leadership",
    label: "Leadership pipeline",
    weight: 10,
    desc: "Enough members developing toward office.",
  },
  {
    key: "governance",
    label: "Governance & finance",
    weight: 10,
    desc: "Clean records, compliant spend, elections on time.",
  },
] as const;
export type HealthComponentKey = (typeof HEALTH_COMPONENTS)[number]["key"];
/** Below this index a chapter is under the health bar — remediation recommended. */
export const HEALTH_BAR = 60;
export type HealthBand = "healthy" | "watch" | "below";
export function healthBand(total: number): HealthBand {
  return total >= 75 ? "healthy" : total >= HEALTH_BAR ? "watch" : "below";
}
export const HEALTH_BAND_LABEL: Record<HealthBand, string> = {
  healthy: "Healthy",
  watch: "Watch",
  below: "Below the bar",
};
export const HEALTH_BAND_COLOR: Record<HealthBand, "green" | "gold" | "red"> = {
  healthy: "green",
  watch: "gold",
  below: "red",
};

export const ELECTION_STATUSES = ["open", "voting", "closed"] as const;
export const MOTION_STATUSES = ["open", "passed", "rejected"] as const;
export const BUDGET_KINDS = ["allocation", "sponsorship", "spend"] as const;
export const BUDGET_STATUSES = [
  "proposed",
  "approved",
  "spent",
  "rejected",
] as const;

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
export const PUSH_CATEGORY_KEYS = PUSH_CATEGORIES.map(c => c.key);

/* ---- Admin capability scopes (segregation of duties). Modelled on the eHive
   Circle pillar's org roles so a staff member's portal access matches their
   actual job. An admin whose adminScopes is "" has full access (back-compat);
   "*" is explicit full access (Director eHive Circle / COO / CEO). Otherwise
   the admin may only perform actions whose scope is in their list. ---- */
export const ADMIN_SCOPES = [
  {
    key: "membership",
    label: "Membership Growth — applications, admissions, tiers & status",
  },
  {
    key: "community",
    label: "Community Manager — pods, buddies, 1-2-1s & referrals",
  },
  {
    key: "events",
    label: "Programming & Events — events, sessions & check-in",
  },
  {
    key: "chapters",
    label: "Chapter Development — chapters, governance & elections",
  },
  {
    key: "member_success",
    label: "Member Success — Zenith concierge & dormancy",
  },
  {
    key: "partnerships",
    label: "Partnerships & Member Value — offers, deals & investor intros",
  },
  {
    key: "content",
    label: "Content & Editorial — Hive Journal, library & insights",
  },
  {
    key: "finance",
    label: "Finance & Compliance — payments, leads & PDPL data requests",
  },
  {
    key: "conduct",
    label: "Conduct & Safeguarding — incident reports, cases & member removal",
  },
] as const;
export type AdminScope = (typeof ADMIN_SCOPES)[number]["key"];

/* ML-01 — prospect funnel stages. */
export const PROSPECT_STAGES = [
  "prospect",
  "guest",
  "invited",
  "converted",
  "declined",
] as const;
export type ProspectStage = (typeof PROSPECT_STAGES)[number];
export const PROSPECT_STAGE_LABEL: Record<ProspectStage, string> = {
  prospect: "Prospect",
  guest: "Guest",
  invited: "Invited to apply",
  converted: "Converted",
  declined: "Declined",
};

/* M10 — recognition badges, derived from real data (tenure + contribution).
   Pure and testable; shown on the member's page. */
export function memberBadges(
  m: { createdAt: Date | string; hiveScore: number },
  now = new Date()
): string[] {
  const badges: string[] = [];
  const created = new Date(m.createdAt);
  const years = (now.getTime() - created.getTime()) / (365.25 * 86_400_000);
  const days = (now.getTime() - created.getTime()) / 86_400_000;
  if (years >= 5) badges.push("5+ Years");
  else if (years >= 3) badges.push("3 Years");
  else if (years >= 2) badges.push("2 Years");
  else if (years >= 1) badges.push("1 Year");
  else if (days <= 90) badges.push("Newcomer");
  if (m.hiveScore >= 80) badges.push("Top Contributor");
  else if (m.hiveScore >= 60) badges.push("Active Contributor");
  return badges;
}

/* M3 — chapter & board meetings, with the manual's default agendas (H2). */
export const MEETING_KINDS = [
  { key: "chapter_meeting", label: "Chapter Meeting", sop: "CH-01" },
  { key: "board_meeting", label: "Board Meeting", sop: "CH-04" },
  { key: "huddle", label: "Weekly Huddle", sop: "CH-02" },
  { key: "other", label: "Other", sop: "" },
] as const;
export type MeetingKind = (typeof MEETING_KINDS)[number]["key"];
export const MEETING_KIND_LABEL: Record<string, string> = Object.fromEntries(
  MEETING_KINDS.map(k => [k.key, k.label])
);
export const MEETING_AGENDA_TEMPLATES: Record<string, string> = {
  chapter_meeting: [
    "1. Arrival & networking",
    "2. Welcome & purpose",
    "3. Member wins & spotlight",
    "4. Core content",
    "5. Structured asks & offers",
    "6. Guest welcome",
    "7. Chapter business",
    "8. Close & single call to action",
  ].join("\n"),
  board_meeting: [
    "1. Prior actions",
    "2. Health review",
    "3. Membership & pipeline",
    "4. Finance",
    "5. Programming & PODs",
    "6. Decisions & issues",
    "7. Actions & close",
  ].join("\n"),
  huddle: [
    "1. Wins since last week",
    "2. Pipeline update",
    "3. This week's asks",
    "4. Blockers",
  ].join("\n"),
  other: "",
};

/* AF-02 — spend approval. A chapter spend at or under the threshold can be
   approved by any chapter admin; above it needs a full administrator
   (President / Director sign-off). Amount is in AED. */
export const SPEND_APPROVAL_THRESHOLD_AED = 2000;
/** Refunds are self-serve for finance admins within this window of the payment;
 *  older charges need a full administrator to override (a light dunning/chargeback
 *  guard so a stale membership isn't casually reversed). */
export const REFUND_WINDOW_DAYS = 30;

/* XC-04 — Conduct & incident handling. */
export const CONDUCT_CATEGORIES = [
  "Respect & behaviour",
  "Confidentiality breach",
  "Harassment",
  "Conflict of interest",
  "Solicitation / spam",
  "Safeguarding",
  "Other",
] as const;
export const CONDUCT_SEVERITIES = [
  "low",
  "moderate",
  "high",
  "safeguarding",
] as const;
export type ConductSeverity = (typeof CONDUCT_SEVERITIES)[number];
export const CONDUCT_SEVERITY_LABEL: Record<ConductSeverity, string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
  safeguarding: "Safeguarding",
};
export const CONDUCT_STATUSES = [
  "open",
  "reviewing",
  "actioned",
  "escalated",
  "closed",
] as const;
export type ConductStatus = (typeof CONDUCT_STATUSES)[number];
export const CONDUCT_STATUS_LABEL: Record<ConductStatus, string> = {
  open: "Open",
  reviewing: "Under review",
  actioned: "Actioned",
  escalated: "Escalated",
  closed: "Closed",
};
export const ADMIN_SCOPE_KEYS = ADMIN_SCOPES.map(s => s.key);

/** Leads CRM pipeline. */
export const LEAD_STATUSES = [
  "new",
  "contacted",
  "qualified",
  "won",
  "lost",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  won: "Won",
  lost: "Lost",
};

/** Verification / reset token lifetimes (ms). */
export const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h

/** Days within which a new member must be paired with a buddy */
export const BUDDY_PAIR_WITHIN_DAYS = 5;
/** Days after pairing for the buddy 30-day check-in */
export const BUDDY_CHECKIN_DAYS = 30;
