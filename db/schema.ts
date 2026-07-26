import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  timestamp,
  bigint,
  int,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  // Stable internal id carried in the session token. Generated on sign-up.
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  // Email is the login identity for email/password auth — unique and required.
  email: varchar("email", { length: 320 }).notNull().unique(),
  // scrypt hash (salt:hash). Null only for legacy/non-password accounts.
  passwordHash: varchar("passwordHash", { length: 255 }),
  // UAE PDPL — timestamp of privacy/terms consent captured at sign-up.
  consentAt: timestamp("consentAt"),
  avatar: text("avatar"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  // Segregation of duties: comma-separated admin capability scopes (see
  // contracts/constants ADMIN_SCOPES). Empty on a plain admin = full access
  // for backward-compatibility; the owner always has "*".
  adminScopes: varchar("adminScopes", { length: 512 }).notNull().default(""),
  // Email verification (null until the address is confirmed via emailed link).
  emailVerifiedAt: timestamp("emailVerifiedAt"),
  // TOTP two-factor (base32 secret; enabled only once confirmed).
  totpSecret: varchar("totpSecret", { length: 64 }),
  totpEnabled: int("totpEnabled").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;


/* ==========================================================================
   eHive Circle — community vertical (BRD §9) + website leads
   ========================================================================== */

export const members = mysqlTable("members", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull().unique(),
  tier: mysqlEnum("tier", ["horizon", "ascent", "vanguard", "zenith"]).notNull().default("horizon"),
  status: mysqlEnum("status", ["active", "paused", "cancelled"]).notNull().default("active"),
  hiveScore: int("hiveScore").notNull().default(0),
  company: varchar("company", { length: 255 }),
  title: varchar("title", { length: 255 }),
  phone: varchar("phone", { length: 64 }),
  joinedAt: timestamp("joinedAt").defaultNow().notNull(),
  renewalAt: timestamp("renewalAt"),
  /* BRD 6.3 — dormancy ladder + engagement */
  dormancyStage: mysqlEnum("dormancyStage", ["active", "at_risk", "dormant", "non_renewal"]).notNull().default("active"),
  dormancyNote: varchar("dormancyNote", { length: 500 }),
  exceptionPause: int("exceptionPause").notNull().default(0), // boolean: member-initiated pause
  /* BRD 6.2 — member-controlled directory visibility */
  directoryVisible: int("directoryVisible").notNull().default(1),
  /* BRD 6.6 — founding induction number (Zenith admissions) */
  inductionNo: int("inductionNo"),
  /* BRD 6.7 — home chapter */
  homeChapterId: bigint("homeChapterId", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});
export type Member = typeof members.$inferSelect;

export const applications = mysqlTable("applications", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  company: varchar("company", { length: 255 }),
  stage: varchar("stage", { length: 64 }),
  revenue: varchar("revenue", { length: 64 }),
  why: text("why"),
  proofPoint: text("proofPoint"),
  consentAt: timestamp("consentAt"),
  tierRequested: mysqlEnum("tierRequested", ["horizon", "ascent", "vanguard", "zenith"]).notNull().default("ascent"),
  status: mysqlEnum("status", ["received", "screening", "interview", "approved", "rejected"]).notNull().default("received"),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  decidedAt: timestamp("decidedAt"),
});
export type Application = typeof applications.$inferSelect;

export const membershipEvents = mysqlTable("membership_events", {
  id: serial("id").primaryKey(),
  memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
  type: mysqlEnum("type", ["approved", "upgrade", "downgrade", "pause", "cancel", "renew"]).notNull(),
  fromTier: varchar("fromTier", { length: 32 }),
  toTier: varchar("toTier", { length: 32 }),
  note: text("note"),
  /* Approval state — tier changes a member requests stay `pending` until
     management approves/rejects; self-serve actions are `applied`. */
  status: mysqlEnum("status", ["applied", "pending", "approved", "rejected"]).notNull().default("applied"),
  actorEmail: varchar("actorEmail", { length: 320 }), // admin who decided a pending request
  decidedAt: timestamp("decidedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const pods = mysqlTable("pods", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  kind: mysqlEnum("kind", ["pod", "mastermind"]).notNull().default("pod"),
  facilitator: varchar("facilitator", { length: 255 }),
  capacity: int("capacity").notNull().default(8),
  cadence: varchar("cadence", { length: 128 }),
  tierGate: mysqlEnum("tierGate", ["horizon", "ascent", "vanguard", "zenith"]).notNull().default("horizon"),
  description: text("description"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type Pod = typeof pods.$inferSelect;

export const podMembers = mysqlTable("pod_members", {
  id: serial("id").primaryKey(),
  podId: bigint("podId", { mode: "number", unsigned: true }).notNull(),
  memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
  role: varchar("role", { length: 32 }).notNull().default("member"),
  joinedAt: timestamp("joinedAt").defaultNow().notNull(),
});

export const sessions = mysqlTable("sessions", {
  id: serial("id").primaryKey(),
  podId: bigint("podId", { mode: "number", unsigned: true }).notNull(),
  startsAt: timestamp("startsAt").notNull(),
  durationMin: int("durationMin").notNull().default(90),
  topic: varchar("topic", { length: 255 }),
  videoLink: varchar("videoLink", { length: 512 }),
  location: varchar("location", { length: 255 }),
  status: mysqlEnum("status", ["scheduled", "done", "cancelled"]).notNull().default("scheduled"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type Session = typeof sessions.$inferSelect;

export const attendance = mysqlTable("attendance", {
  id: serial("id").primaryKey(),
  sessionId: bigint("sessionId", { mode: "number", unsigned: true }).notNull(),
  memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
  status: mysqlEnum("status", ["attended", "absent", "excused"]).notNull().default("attended"),
  markedAt: timestamp("markedAt").defaultNow().notNull(),
});

export const sessionNotes = mysqlTable("session_notes", {
  id: serial("id").primaryKey(),
  sessionId: bigint("sessionId", { mode: "number", unsigned: true }).notNull().unique(),
  summary: text("summary"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export const actionItems = mysqlTable("action_items", {
  id: serial("id").primaryKey(),
  podId: bigint("podId", { mode: "number", unsigned: true }).notNull(),
  sessionId: bigint("sessionId", { mode: "number", unsigned: true }),
  memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
  text: varchar("text", { length: 512 }).notNull(),
  dueAt: timestamp("dueAt"),
  status: mysqlEnum("status", ["open", "done"]).notNull().default("open"),
  doneAt: timestamp("doneAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ActionItem = typeof actionItems.$inferSelect;

export const events = mysqlTable("events", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  /* Activity master — keep in sync with EVENT_KINDS (contracts/constants) and
     ensureSchema() in api/boot.ts. */
  kind: mysqlEnum("kind", [
    "spark", "meetup", "circle", "retreat", "summit",
    "conference", "conclave", "roundtable", "workshop", "masterclass",
    "breakfast", "lunch", "dinner", "social", "webinar",
  ]).notNull().default("meetup"),
  description: text("description"),
  startsAt: timestamp("startsAt").notNull(),
  location: varchar("location", { length: 255 }),
  tierGate: mysqlEnum("tierGate", ["horizon", "ascent", "vanguard", "zenith"]).notNull().default("horizon"),
  /* Audience governance: who may see & join. `tiers` restricts to audienceTiers. */
  audience: mysqlEnum("audience", ["public", "members", "tiers"]).notNull().default("members"),
  audienceTiers: varchar("audienceTiers", { length: 128 }), // CSV of tiers when audience = 'tiers'
  capacity: int("capacity").notNull().default(40),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type CircleEvent = typeof events.$inferSelect;

export const eventRegs = mysqlTable("event_regs", {
  id: serial("id").primaryKey(),
  eventId: bigint("eventId", { mode: "number", unsigned: true }).notNull(),
  memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
  status: mysqlEnum("status", ["registered", "waitlisted", "attended", "cancelled"]).notNull().default("registered"),
  /* BRD 6.4 — QR check-in code (member shows code at door; check-in writes score real-time) */
  checkinCode: varchar("checkinCode", { length: 12 }),
  guestOf: bigint("guestOf", { mode: "number", unsigned: true }), // set when this seat is a member's guest ticket
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const hiveScoreConfig = mysqlTable("hive_score_config", {
  id: serial("id").primaryKey(),
  factor: varchar("factor", { length: 64 }).notNull().unique(),
  weight: int("weight").notNull().default(0),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export const scoreEvents = mysqlTable("score_events", {
  id: serial("id").primaryKey(),
  memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
  factor: varchar("factor", { length: 64 }).notNull(),
  points: int("points").notNull().default(0),
  note: varchar("note", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const hiveScoreHistory = mysqlTable("hive_score_history", {
  id: serial("id").primaryKey(),
  memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
  score: int("score").notNull(),
  breakdown: text("breakdown"),
  computedAt: timestamp("computedAt").defaultNow().notNull(),
});

export const frpCohorts = mysqlTable("frp_cohorts", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  tierGate: mysqlEnum("tierGate", ["horizon", "ascent", "vanguard", "zenith"]).notNull().default("vanguard"),
  startsAt: timestamp("startsAt"),
  status: mysqlEnum("status", ["open", "running", "closed"]).notNull().default("open"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const frpEnrolments = mysqlTable("frp_enrolments", {
  id: serial("id").primaryKey(),
  cohortId: bigint("cohortId", { mode: "number", unsigned: true }).notNull(),
  memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
  status: mysqlEnum("status", ["enrolled", "active", "completed", "withdrawn"]).notNull().default("enrolled"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const readinessAssessments = mysqlTable("readiness_assessments", {
  id: serial("id").primaryKey(),
  enrolmentId: bigint("enrolmentId", { mode: "number", unsigned: true }).notNull().unique(),
  team: int("team").notNull().default(0),
  traction: int("traction").notNull().default(0),
  market: int("market").notNull().default(0),
  financials: int("financials").notNull().default(0),
  narrative: int("narrative").notNull().default(0),
  legal: int("legal").notNull().default(0),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export const frpMilestones = mysqlTable("frp_milestones", {
  id: serial("id").primaryKey(),
  enrolmentId: bigint("enrolmentId", { mode: "number", unsigned: true }).notNull(),
  key: mysqlEnum("key", ["deck", "model", "dataroom"]).notNull(),
  status: mysqlEnum("status", ["not_started", "in_progress", "submitted", "reviewed"]).notNull().default("not_started"),
  note: text("note"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export const govBodies = mysqlTable("gov_bodies", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const govRoles = mysqlTable("gov_roles", {
  id: serial("id").primaryKey(),
  bodyId: bigint("bodyId", { mode: "number", unsigned: true }).notNull(),
  memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
  seat: varchar("seat", { length: 128 }).notNull(),
  termStart: timestamp("termStart"),
  termEnd: timestamp("termEnd"),
});

export const govMinutes = mysqlTable("gov_minutes", {
  id: serial("id").primaryKey(),
  bodyId: bigint("bodyId", { mode: "number", unsigned: true }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  date: timestamp("date"),
  text: text("text"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const policies = mysqlTable("policies", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  body: text("body"),
  version: int("version").notNull().default(1),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const policyAcks = mysqlTable("policy_acks", {
  id: serial("id").primaryKey(),
  policyId: bigint("policyId", { mode: "number", unsigned: true }).notNull(),
  memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const libraryItems = mysqlTable("library_items", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  version: int("version").notNull().default(1),
  kind: mysqlEnum("kind", ["playbook", "template", "recording", "note"]).notNull().default("playbook"),
  tierGate: mysqlEnum("tierGate", ["horizon", "ascent", "vanguard", "zenith"]).notNull().default("horizon"),
  url: varchar("url", { length: 512 }),
  description: text("description"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type LibraryItem = typeof libraryItems.$inferSelect;

export const offers = mysqlTable("offers", {
  id: serial("id").primaryKey(),
  vertical: mysqlEnum("vertical", ["setup", "consulting"]).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  ctaUrl: varchar("ctaUrl", { length: 512 }),
  tierGate: mysqlEnum("tierGate", ["horizon", "ascent", "vanguard", "zenith"]).notNull().default("horizon"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/* Provider-agnostic payment records (SRS INT-02). One row per checkout. */
export const paymentRecords = mysqlTable("payment_records", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  provider: varchar("provider", { length: 32 }).notNull().default("stripe"),
  providerRef: varchar("providerRef", { length: 255 }), // checkout session / intent id
  purpose: varchar("purpose", { length: 32 }).notNull().default("membership"),
  tier: mysqlEnum("tier", ["horizon", "ascent", "vanguard", "zenith"]),
  amount: int("amount").notNull(),        // minor units (fils)
  currency: varchar("currency", { length: 8 }).notNull().default("aed"),
  status: mysqlEnum("status", ["pending", "paid", "failed", "refunded"]).notNull().default("pending"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export const leads = mysqlTable("leads", {
  id: serial("id").primaryKey(),
  form: varchar("form", { length: 64 }).notNull(),
  email: varchar("email", { length: 320 }),
  payload: text("payload"),
  sourcePage: varchar("sourcePage", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  /* Lightweight CRM: pipeline status, owner (admin) and freeform notes. */
  status: mysqlEnum("status", ["new", "contacted", "qualified", "won", "lost"]).notNull().default("new"),
  ownerUserId: bigint("ownerUserId", { mode: "number", unsigned: true }),
  notes: text("notes"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});
export type Lead = typeof leads.$inferSelect;

// TODO: Add your tables here. See docs/Database.md for schema examples and patterns.
//
// Example:
// export const posts = mysqlTable("posts", {
//   id: serial("id").primaryKey(),
//   title: varchar("title", { length: 255 }).notNull(),
//   content: text("content"),
//   createdAt: timestamp("created_at").notNull().defaultNow(),
// });
//
// Note: FK columns referencing a serial() PK must use:
//   bigint("columnName", { mode: "number", unsigned: true }).notNull()

/* ==========================================================================
   BRD v2 — engagement engine, admissions, chapters, CMS
   ========================================================================== */

/* BRD 7.2 — admin-configurable Hive Score point rules (one row per event type) */
export const pointRules = mysqlTable("point_rules", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 64 }).notNull().unique(), // e.g. event_attend, one_to_one_confirmed
  factor: varchar("factor", { length: 64 }).notNull(),      // score factor bucket
  points: int("points").notNull(),
  label: varchar("label", { length: 255 }).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

/* BRD 6.3 — Engagement Standard per tier (quarterly minimums; null = open item) */
export const engagementConfig = mysqlTable("engagement_config", {
  id: serial("id").primaryKey(),
  tier: mysqlEnum("tier", ["horizon", "ascent", "vanguard", "zenith"]).notNull().unique(),
  sessionsRequired: int("sessionsRequired"),   // e.g. 8
  sessionsOffered: int("sessionsOffered"),     // e.g. 12 ("8 of 12")
  oneToOnesPerQuarter: int("oneToOnesPerQuarter"), // Ascent: 2/month → 6/quarter
  giveBackPerYear: int("giveBackPerYear"),     // Vanguard: 2
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

/* BRD 6.3 — dormancy ladder transitions (manual overrides logged too) */
export const dormancyLog = mysqlTable("dormancy_log", {
  id: serial("id").primaryKey(),
  memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
  fromStage: varchar("fromStage", { length: 32 }).notNull(),
  toStage: varchar("toStage", { length: 32 }).notNull(),
  reason: varchar("reason", { length: 500 }),
  actor: varchar("actor", { length: 128 }).notNull().default("system"), // "system" or admin name
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/* BRD 6.3/7.4 — in-portal notifications (email/WhatsApp are platform dependencies) */
/* Generic key/value config — used to persist the auto-generated VAPID keypair
   so web push needs no environment setup. */
export const appConfig = mysqlTable("app_config", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

/* Single-use auth tokens for email verification + password reset. Only the
   SHA-256 hash of the token is stored; the raw token lives only in the emailed
   link. Rows are consumed (usedAt set) on success and expire by expiresAt. */
export const authTokens = mysqlTable("auth_tokens", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  kind: mysqlEnum("kind", ["verify", "reset"]).notNull(),
  tokenHash: varchar("tokenHash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  usedAt: timestamp("usedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/* Append-only audit trail of privileged admin actions (who did what, to what,
   when). Never updated or deleted from the app — accountability for PDPL and
   internal governance. */
export const adminAuditLog = mysqlTable("admin_audit_log", {
  id: serial("id").primaryKey(),
  actorUserId: bigint("actorUserId", { mode: "number", unsigned: true }).notNull(),
  actorEmail: varchar("actorEmail", { length: 320 }),
  action: varchar("action", { length: 64 }).notNull(),       // e.g. "application.approve"
  targetType: varchar("targetType", { length: 48 }),         // e.g. "application"
  targetId: varchar("targetId", { length: 64 }),
  detail: text("detail"),                                    // short human summary
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/* Web Push subscriptions (PWA push notifications, one row per device). */
export const pushSubscriptions = mysqlTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
  endpoint: varchar("endpoint", { length: 500 }).notNull().unique(),
  p256dh: varchar("p256dh", { length: 255 }).notNull(),
  auth: varchar("auth", { length: 255 }).notNull(),
  categories: text("categories"), // JSON array of enabled category keys; null = all
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const notifications = mysqlTable("notifications", {
  id: serial("id").primaryKey(),
  memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
  text: varchar("text", { length: 500 }).notNull(),
  kind: varchar("kind", { length: 32 }).notNull().default("info"), // info | dormancy | event | connect
  readAt: timestamp("readAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/* BRD 6.3 — 1-2-1s with counterpart confirmation; kind=mentoring feeds Give-Back */
export const oneToOnes = mysqlTable("one_to_ones", {
  id: serial("id").primaryKey(),
  aMemberId: bigint("aMemberId", { mode: "number", unsigned: true }).notNull(), // logger
  bMemberId: bigint("bMemberId", { mode: "number", unsigned: true }).notNull(), // counterpart
  kind: mysqlEnum("kind", ["one_to_one", "mentoring"]).notNull().default("one_to_one"),
  note: varchar("note", { length: 500 }),
  status: mysqlEnum("status", ["pending", "confirmed", "declined"]).notNull().default("pending"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  confirmedAt: timestamp("confirmedAt"),
});

/* BRD 6.3 — buddy pairing for new members (paired within 5 days, 30-day check-in) */
export const buddies = mysqlTable("buddies", {
  id: serial("id").primaryKey(),
  newMemberId: bigint("newMemberId", { mode: "number", unsigned: true }).notNull(),
  buddyMemberId: bigint("buddyMemberId", { mode: "number", unsigned: true }).notNull(),
  pairedAt: timestamp("pairedAt").defaultNow().notNull(),
  checkinAt: timestamp("checkinAt"),
  note: varchar("note", { length: 500 }),
});

/* BRD 6.3 — member-submitted referrals (give-to-get; converted referrals score higher) */
export const referrals = mysqlTable("referrals", {
  id: serial("id").primaryKey(),
  memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
  prospectName: varchar("prospectName", { length: 255 }).notNull(),
  prospectContact: varchar("prospectContact", { length: 255 }),
  note: varchar("note", { length: 500 }),
  status: mysqlEnum("status", ["submitted", "converted", "rejected"]).notNull().default("submitted"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/* BRD 6.3 — Deal Flow board (tier-gated; Ascent requires 1 referral/quarter to post) */
export const deals = mysqlTable("deals", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  tierGate: mysqlEnum("tierGate", ["horizon", "ascent", "vanguard", "zenith"]).notNull().default("ascent"),
  postedBy: bigint("postedBy", { mode: "number", unsigned: true }), // memberId, null = staff
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/* BRD 6.4 — post-event feedback */
export const eventFeedback = mysqlTable("event_feedback", {
  id: serial("id").primaryKey(),
  eventId: bigint("eventId", { mode: "number", unsigned: true }).notNull(),
  memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
  rating: int("rating").notNull(), // 1-5
  comment: varchar("comment", { length: 1000 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/* BRD 6.1/6.5 — Insights CMS (staff publish; public site renders published posts) */
export const insights = mysqlTable("insights", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  excerpt: varchar("excerpt", { length: 500 }),
  body: text("body"),
  tag: varchar("tag", { length: 64 }).default("Note"),
  publishedAt: timestamp("publishedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

/* BRD 6.5 — newsletter archive */
export const newsletters = mysqlTable("newsletters", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  issue: varchar("issue", { length: 64 }),
  url: varchar("url", { length: 512 }),
  publishedAt: timestamp("publishedAt").defaultNow().notNull(),
});

/* BRD 6.6 — Zenith admissions: nomination → endorsements → leadership review → decision */
export const zenithApps = mysqlTable("zenith_apps", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  company: varchar("company", { length: 255 }),
  proofPoint: text("proofPoint"), // revenue/funding proof (also used for Vanguard applications)
  status: mysqlEnum("status", ["nominated", "endorsing", "review", "approved", "rejected"]).notNull().default("nominated"),
  note: varchar("note", { length: 1000 }),
  decidedAt: timestamp("decidedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const endorsements = mysqlTable("endorsements", {
  id: serial("id").primaryKey(),
  appId: bigint("appId", { mode: "number", unsigned: true }).notNull(),
  memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(), // endorser
  role: mysqlEnum("role", ["qc", "board"]).notNull().default("qc"), // QC member or board member
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/* BRD 6.6 — investor relationship tracker (staff-only) with cool-down rules */
export const investorIntros = mysqlTable("investor_intros", {
  id: serial("id").primaryKey(),
  investorName: varchar("investorName", { length: 255 }).notNull(),
  firm: varchar("firm", { length: 255 }),
  memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(), // member introduced
  introducedBy: varchar("introducedBy", { length: 128 }).notNull(),           // staff name
  note: varchar("note", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/* BRD 8.4 — PDPL data-subject requests (export / deletion) */
export const dataRequests = mysqlTable("data_requests", {
  id: serial("id").primaryKey(),
  memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
  kind: mysqlEnum("kind", ["export", "deletion"]).notNull(),
  status: mysqlEnum("status", ["open", "done"]).notNull().default("open"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/* BRD 6.7 — chapters. Formation follows a BNI-style geographic hierarchy:
   Country → Region → State/Emirate → City → Zone, with a short chapter code. */
export const chapters = mysqlTable("chapters", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 24 }),        // short chapter code, e.g. "AE-DXB-01"
  country: varchar("country", { length: 128 }),
  region: varchar("region", { length: 128 }),   // operating region (e.g. "Gulf", "UAE")
  state: varchar("state", { length: 128 }),     // state / emirate / province
  city: varchar("city", { length: 128 }),
  zone: varchar("zone", { length: 128 }),        // area within a city (e.g. "DIFC", "Downtown")
  meetingCadence: varchar("meetingCadence", { length: 64 }), // e.g. "Weekly · Tue 7:30am"
  status: mysqlEnum("status", ["seed", "provisional", "chartered", "mature", "at_risk"]).notNull().default("seed"),
  charterDate: timestamp("charterDate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/* BRD 6.7 — member-requested chapter transfers. A member asks to move to another
   chapter; management approves before the home chapter changes (mirrors the tier
   change approval flow). */
export const chapterTransfers = mysqlTable("chapter_transfers", {
  id: serial("id").primaryKey(),
  memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
  fromChapterId: bigint("fromChapterId", { mode: "number", unsigned: true }),
  toChapterId: bigint("toChapterId", { mode: "number", unsigned: true }).notNull(),
  note: varchar("note", { length: 500 }),
  status: mysqlEnum("status", ["pending", "approved", "rejected"]).notNull().default("pending"),
  actorEmail: varchar("actorEmail", { length: 320 }),
  decidedAt: timestamp("decidedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/* BRD 6.7 — chapter "learnings": notes, resources and playbooks an officer
   shares with their chapter to drive growth. */
export const chapterPosts = mysqlTable("chapter_posts", {
  id: serial("id").primaryKey(),
  chapterId: bigint("chapterId", { mode: "number", unsigned: true }).notNull(),
  authorMemberId: bigint("authorMemberId", { mode: "number", unsigned: true }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  body: text("body"),
  url: varchar("url", { length: 512 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/* BRD 6.7 — chapter leadership team. A member holds a named office in a chapter
   (President, Treasurer, PODs Lead …), assigned directly or from an election.
   One active holder per role per chapter; superseded rows are marked ended. */
export const chapterRoles = mysqlTable("chapter_roles", {
  id: serial("id").primaryKey(),
  chapterId: bigint("chapterId", { mode: "number", unsigned: true }).notNull(),
  memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
  role: varchar("role", { length: 64 }).notNull(),          // CHAPTER_ROLES key, or "other"
  title: varchar("title", { length: 128 }),                 // custom title when role = "other"
  responsibilities: text("responsibilities"),               // optional override of the default
  electionId: bigint("electionId", { mode: "number", unsigned: true }), // set when elected
  termStart: timestamp("termStart"),
  termEnd: timestamp("termEnd"),
  status: mysqlEnum("status", ["active", "ended"]).notNull().default("active"),
  appointedBy: varchar("appointedBy", { length: 320 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/* BRD 6.7 — elections: eligibility-checked candidates, secret ballot, quorum, tamper-evident results.
   Secrecy: ballots store NO voter identity; participation is recorded separately in ballotRoll. */
export const elections = mysqlTable("elections", {
  id: serial("id").primaryKey(),
  chapterId: bigint("chapterId", { mode: "number", unsigned: true }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  seat: varchar("seat", { length: 128 }).notNull(),
  status: mysqlEnum("status", ["open", "voting", "closed"]).notNull().default("open"),
  opensAt: timestamp("opensAt"),
  closesAt: timestamp("closesAt"),
  quorumPct: int("quorumPct").notNull().default(50),
  resultHash: varchar("resultHash", { length: 64 }), // tamper-evident digest published at close
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const candidates = mysqlTable("candidates", {
  id: serial("id").primaryKey(),
  electionId: bigint("electionId", { mode: "number", unsigned: true }).notNull(),
  memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
  statement: varchar("statement", { length: 1000 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const ballots = mysqlTable("ballots", {
  id: serial("id").primaryKey(),
  electionId: bigint("electionId", { mode: "number", unsigned: true }).notNull(),
  candidateId: bigint("candidateId", { mode: "number", unsigned: true }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const ballotRoll = mysqlTable("ballot_roll", {
  id: serial("id").primaryKey(),
  electionId: bigint("electionId", { mode: "number", unsigned: true }).notNull(),
  memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(), // voted — not how
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/* BRD 6.7 — motions: one member, one vote */
export const motions = mysqlTable("motions", {
  id: serial("id").primaryKey(),
  chapterId: bigint("chapterId", { mode: "number", unsigned: true }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  body: text("body"),
  status: mysqlEnum("status", ["open", "passed", "rejected"]).notNull().default("open"),
  closesAt: timestamp("closesAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const motionVotes = mysqlTable("motion_votes", {
  id: serial("id").primaryKey(),
  motionId: bigint("motionId", { mode: "number", unsigned: true }).notNull(),
  memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
  choice: mysqlEnum("choice", ["yes", "no", "abstain"]).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/* BRD 6.7 — chapter budgets: allocations, sponsorships, spend approvals */
export const chapterBudgets = mysqlTable("chapter_budgets", {
  id: serial("id").primaryKey(),
  chapterId: bigint("chapterId", { mode: "number", unsigned: true }).notNull(),
  label: varchar("label", { length: 255 }).notNull(),
  kind: mysqlEnum("kind", ["allocation", "sponsorship", "spend"]).notNull().default("allocation"),
  amount: int("amount").notNull(), // AED
  status: mysqlEnum("status", ["proposed", "approved", "spent", "rejected"]).notNull().default("proposed"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PointRule = typeof pointRules.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type OneToOne = typeof oneToOnes.$inferSelect;
export type Deal = typeof deals.$inferSelect;
export type Referral = typeof referrals.$inferSelect;
export type Insight = typeof insights.$inferSelect;
export type Chapter = typeof chapters.$inferSelect;
export type Election = typeof elections.$inferSelect;
export type Motion = typeof motions.$inferSelect;
