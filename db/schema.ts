import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  timestamp,
  bigint,
  int,
  index,
  uniqueIndex,
  json,
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
  // TOTP two-factor (AES-256-GCM encrypted base32 secret; enabled only once
  // confirmed). Column widened to 255 to hold the encrypted ciphertext.
  totpSecret: varchar("totpSecret", { length: 255 }),
  totpEnabled: int("totpEnabled").notNull().default(0),
  // Session invalidation counter: JWTs embed this value; incrementing it
  // invalidates all existing sessions (e.g. password change, logout, admin action).
  tokenVersion: int("tokenVersion").notNull().default(0),
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

export const members = mysqlTable(
  "members",
  {
    id: serial("id").primaryKey(),
    userId: bigint("userId", { mode: "number", unsigned: true })
      .notNull()
      .unique(),
    tier: mysqlEnum("tier", ["horizon", "ascent", "vanguard", "zenith"])
      .notNull()
      .default("horizon"),
    status: mysqlEnum("status", ["active", "paused", "cancelled"])
      .notNull()
      .default("active"),
    /* Member Lifecycle — the CRM state machine (Operations Manual M1 / Figure 2).
     Distinct from `status` (access/billing): this is the member's journey. */
    lifecycleState: mysqlEnum("lifecycleState", [
      "prospect",
      "guest",
      "applicant",
      "onboarding",
      "active",
      "at_risk",
      "renewal",
      "lapsed",
      "alumni",
      "suspended",
    ])
      .notNull()
      .default("active"),
    hiveScore: int("hiveScore").notNull().default(0),
    company: varchar("company", { length: 255 }),
    title: varchar("title", { length: 255 }),
    phone: varchar("phone", { length: 64 }),
    /* POD profile (Operations Manual PD-01) — drives the matching engine. */
    sector: varchar("sector", { length: 128 }),
    stage: varchar("stage", { length: 64 }),
    goals: varchar("goals", { length: 500 }),
    joinedAt: timestamp("joinedAt").defaultNow().notNull(),
    renewalAt: timestamp("renewalAt"),
    /* BRD 6.3 — dormancy ladder + engagement */
    dormancyStage: mysqlEnum("dormancyStage", [
      "active",
      "at_risk",
      "dormant",
      "non_renewal",
    ])
      .notNull()
      .default("active"),
    dormancyNote: varchar("dormancyNote", { length: 500 }),
    exceptionPause: int("exceptionPause").notNull().default(0), // boolean: member-initiated pause
    /* BRD 6.2 — member-controlled directory visibility */
    directoryVisible: int("directoryVisible").notNull().default(1),
    emailNotify: int("emailNotify").notNull().default(1), // email a copy of in-app notifications
    /* BRD 6.6 — founding induction number (Zenith admissions) */
    inductionNo: int("inductionNo"),
    /* BRD 6.7 — home chapter */
    homeChapterId: bigint("homeChapterId", { mode: "number", unsigned: true }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  t => [
    index("ix_members_tier_status").on(t.tier, t.status),
    index("ix_members_status_score").on(t.status, t.hiveScore),
    index("ix_members_home_chapter").on(t.homeChapterId),
    index("ix_members_lifecycle").on(t.lifecycleState),
  ]
);
export type Member = typeof members.$inferSelect;

/* Member KYC (Know Your Customer) — identity verification for compliance. Holds
   structured ID details + a maker-checker verification state. Document *images*
   are out of scope here (they need object storage); this captures the data an
   admin verifies against a sighted document. One row per member. */
export const memberKyc = mysqlTable("member_kyc", {
  id: serial("id").primaryKey(),
  memberId: bigint("memberId", { mode: "number", unsigned: true })
    .notNull()
    .unique(),
  idType: mysqlEnum("idType", ["emirates_id", "passport", "other"]),
  idNumber: varchar("idNumber", { length: 64 }),
  nationality: varchar("nationality", { length: 96 }),
  idExpiry: timestamp("idExpiry"),
  status: mysqlEnum("status", [
    "not_submitted",
    "submitted",
    "verified",
    "rejected",
  ])
    .notNull()
    .default("not_submitted"),
  submittedAt: timestamp("submittedAt"),
  reviewedByUserId: bigint("reviewedByUserId", {
    mode: "number",
    unsigned: true,
  }),
  reviewedAt: timestamp("reviewedAt"),
  reviewNote: varchar("reviewNote", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type MemberKyc = typeof memberKyc.$inferSelect;

/* Operations Manual ML-03 — completed onboarding milestones a member (or the VP
   Membership) has checked off. Auto milestones are derived from activity and not
   stored here; this holds the manual check-offs. */
export const onboardingMilestones = mysqlTable(
  "onboarding_milestones",
  {
    id: serial("id").primaryKey(),
    memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
    milestone: varchar("milestone", { length: 48 }).notNull(),
    note: varchar("note", { length: 500 }),
    completedAt: timestamp("completedAt").defaultNow().notNull(),
  },
  t => [
    uniqueIndex("onboarding_milestone_member_unique").on(
      t.memberId,
      t.milestone
    ),
  ]
);

export const applications = mysqlTable(
  "applications",
  {
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
    tierRequested: mysqlEnum("tierRequested", [
      "horizon",
      "ascent",
      "vanguard",
      "zenith",
    ])
      .notNull()
      .default("ascent"),
    status: mysqlEnum("status", [
      "received",
      "screening",
      "interview",
      "approved",
      "rejected",
    ])
      .notNull()
      .default("received"),
    note: text("note"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    decidedAt: timestamp("decidedAt"),
  },
  t => [
    index("ix_applications_user").on(t.userId),
    index("ix_applications_status").on(t.status),
  ]
);
export type Application = typeof applications.$inferSelect;

export const membershipEvents = mysqlTable(
  "membership_events",
  {
    id: serial("id").primaryKey(),
    memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
    type: mysqlEnum("type", [
      "approved",
      "upgrade",
      "downgrade",
      "pause",
      "cancel",
      "renew",
    ]).notNull(),
    fromTier: varchar("fromTier", { length: 32 }),
    toTier: varchar("toTier", { length: 32 }),
    note: text("note"),
    /* Approval state — tier changes a member requests stay `pending` until
       management approves/rejects; self-serve actions are `applied`. */
    status: mysqlEnum("status", ["applied", "pending", "approved", "rejected"])
      .notNull()
      .default("applied"),
    actorEmail: varchar("actorEmail", { length: 320 }), // admin who decided a pending request
    decidedAt: timestamp("decidedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => [
    index("ix_membevents_member").on(t.memberId),
    index("ix_membevents_status").on(t.status),
  ]
);

/* ERP maker-checker — proposed/applied changes to a member record. High-impact
   changes (tier, status, lifecycle) enter as `pending` and a corporate approver
   (membership scope, full admin, or the member's chapter lead) approves/rejects;
   immediate edits (profile fields) are recorded as `applied` so the member's
   activity ledger captures every change to the record. */
export const memberChangeRequests = mysqlTable("member_change_requests", {
  id: serial("id").primaryKey(),
  memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
  category: mysqlEnum("category", [
    "profile",
    "tier",
    "status",
    "lifecycle",
    "chapter",
  ]).notNull(),
  changes: text("changes").notNull(), // JSON: [{ field, label, from, to }]
  reason: varchar("reason", { length: 500 }),
  status: mysqlEnum("status", [
    "pending",
    "approved",
    "rejected",
    "applied",
    "cancelled",
  ])
    .notNull()
    .default("pending"),
  source: mysqlEnum("source", ["member", "officer", "admin"]).notNull(),
  requestedByUserId: bigint("requestedByUserId", {
    mode: "number",
    unsigned: true,
  }).notNull(),
  requestedByEmail: varchar("requestedByEmail", { length: 320 }),
  decidedByUserId: bigint("decidedByUserId", {
    mode: "number",
    unsigned: true,
  }),
  decidedByEmail: varchar("decidedByEmail", { length: 320 }),
  decisionNote: varchar("decisionNote", { length: 500 }),
  decidedAt: timestamp("decidedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type MemberChangeRequest = typeof memberChangeRequests.$inferSelect;

export const pods = mysqlTable("pods", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  kind: mysqlEnum("kind", ["pod", "mastermind"]).notNull().default("pod"),
  facilitator: varchar("facilitator", { length: 255 }),
  capacity: int("capacity").notNull().default(8),
  cadence: varchar("cadence", { length: 128 }),
  tierGate: mysqlEnum("tierGate", ["horizon", "ascent", "vanguard", "zenith"])
    .notNull()
    .default("horizon"),
  description: text("description"),
  deletedAt: timestamp("deletedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type Pod = typeof pods.$inferSelect;

export const podMembers = mysqlTable("pod_members", {
  id: serial("id").primaryKey(),
  podId: bigint("podId", { mode: "number", unsigned: true }).notNull(),
  memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
  role: varchar("role", { length: 32 }).notNull().default("member"),
  joinedAt: timestamp("joinedAt").defaultNow().notNull(),
  /* PD-03 — POD content is gated until the member accepts confidentiality. */
  confidentialityAt: timestamp("confidentialityAt"),
});

export const sessions = mysqlTable(
  "sessions",
  {
    id: serial("id").primaryKey(),
    podId: bigint("podId", { mode: "number", unsigned: true }).notNull(),
    startsAt: timestamp("startsAt").notNull(),
    durationMin: int("durationMin").notNull().default(90),
    topic: varchar("topic", { length: 255 }),
    videoLink: varchar("videoLink", { length: 512 }),
    location: varchar("location", { length: 255 }),
    status: mysqlEnum("status", ["scheduled", "done", "cancelled"])
      .notNull()
      .default("scheduled"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => [index("ix_sessions_pod_starts").on(t.podId, t.startsAt)]
);
export type Session = typeof sessions.$inferSelect;

export const attendance = mysqlTable(
  "attendance",
  {
    id: serial("id").primaryKey(),
    sessionId: bigint("sessionId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
    status: mysqlEnum("status", ["attended", "absent", "excused"])
      .notNull()
      .default("attended"),
    markedAt: timestamp("markedAt").defaultNow().notNull(),
  },
  t => [
    index("ix_attendance_session").on(t.sessionId),
    index("ix_attendance_member").on(t.memberId),
  ]
);

export const sessionNotes = mysqlTable("session_notes", {
  id: serial("id").primaryKey(),
  sessionId: bigint("sessionId", { mode: "number", unsigned: true })
    .notNull()
    .unique(),
  summary: text("summary"),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
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
  /* Activity master — keep in sync with EVENT_KINDS (contracts/constants). */
  kind: mysqlEnum("kind", [
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
  ])
    .notNull()
    .default("meetup"),
  description: text("description"),
  startsAt: timestamp("startsAt").notNull(),
  location: varchar("location", { length: 255 }),
  tierGate: mysqlEnum("tierGate", ["horizon", "ascent", "vanguard", "zenith"])
    .notNull()
    .default("horizon"),
  /* Audience governance: who may see & join. `tiers` restricts to audienceTiers. */
  audience: mysqlEnum("audience", ["public", "members", "tiers"])
    .notNull()
    .default("members"),
  audienceTiers: varchar("audienceTiers", { length: 128 }), // CSV of tiers when audience = 'tiers'
  capacity: int("capacity").notNull().default(40),
  // CPD (Continuing Professional Development) credits a member earns by
  // attending. 0 = the event carries no formal credits.
  cpdCredits: int("cpdCredits").notNull().default(0),
  deletedAt: timestamp("deletedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type CircleEvent = typeof events.$inferSelect;

export const eventRegs = mysqlTable(
  "event_regs",
  {
    id: serial("id").primaryKey(),
    eventId: bigint("eventId", { mode: "number", unsigned: true }).notNull(),
    memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
    status: mysqlEnum("status", [
      "registered",
      "waitlisted",
      "attended",
      "cancelled",
    ])
      .notNull()
      .default("registered"),
    /* BRD 6.4 — QR check-in code (member shows code at door; check-in writes score real-time) */
    checkinCode: varchar("checkinCode", { length: 12 }),
    guestOf: bigint("guestOf", { mode: "number", unsigned: true }), // set when this seat is a member's guest ticket
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => [
    index("ix_eventregs_event_status").on(t.eventId, t.status),
    index("ix_eventregs_member").on(t.memberId),
    index("ix_eventregs_code").on(t.checkinCode),
  ]
);

export const hiveScoreConfig = mysqlTable("hive_score_config", {
  id: serial("id").primaryKey(),
  factor: varchar("factor", { length: 64 }).notNull().unique(),
  weight: int("weight").notNull().default(0),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const scoreEvents = mysqlTable(
  "score_events",
  {
    id: serial("id").primaryKey(),
    memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
    factor: varchar("factor", { length: 64 }).notNull(),
    points: int("points").notNull().default(0),
    note: varchar("note", { length: 255 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => [index("ix_scoreevents_member").on(t.memberId)]
);

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
  tierGate: mysqlEnum("tierGate", ["horizon", "ascent", "vanguard", "zenith"])
    .notNull()
    .default("vanguard"),
  startsAt: timestamp("startsAt"),
  status: mysqlEnum("status", ["open", "running", "closed"])
    .notNull()
    .default("open"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const frpEnrolments = mysqlTable("frp_enrolments", {
  id: serial("id").primaryKey(),
  cohortId: bigint("cohortId", { mode: "number", unsigned: true }).notNull(),
  memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
  status: mysqlEnum("status", ["enrolled", "active", "completed", "withdrawn"])
    .notNull()
    .default("enrolled"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const readinessAssessments = mysqlTable("readiness_assessments", {
  id: serial("id").primaryKey(),
  enrolmentId: bigint("enrolmentId", { mode: "number", unsigned: true })
    .notNull()
    .unique(),
  team: int("team").notNull().default(0),
  traction: int("traction").notNull().default(0),
  market: int("market").notNull().default(0),
  financials: int("financials").notNull().default(0),
  narrative: int("narrative").notNull().default(0),
  legal: int("legal").notNull().default(0),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const frpMilestones = mysqlTable("frp_milestones", {
  id: serial("id").primaryKey(),
  enrolmentId: bigint("enrolmentId", {
    mode: "number",
    unsigned: true,
  }).notNull(),
  key: mysqlEnum("key", ["deck", "model", "dataroom"]).notNull(),
  status: mysqlEnum("status", [
    "not_started",
    "in_progress",
    "submitted",
    "reviewed",
  ])
    .notNull()
    .default("not_started"),
  note: text("note"),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const govBodies = mysqlTable("gov_bodies", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const govRoles = mysqlTable(
  "gov_roles",
  {
    id: serial("id").primaryKey(),
    bodyId: bigint("bodyId", { mode: "number", unsigned: true }).notNull(),
    memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
    seat: varchar("seat", { length: 128 }).notNull(),
    termStart: timestamp("termStart"),
    termEnd: timestamp("termEnd"),
  },
  t => [index("ix_govroles_body").on(t.bodyId)]
);

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

export const policyAcks = mysqlTable(
  "policy_acks",
  {
    id: serial("id").primaryKey(),
    policyId: bigint("policyId", { mode: "number", unsigned: true }).notNull(),
    memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => [
    uniqueIndex("policy_acks_policy_member_unique").on(t.policyId, t.memberId),
  ]
);

export const libraryItems = mysqlTable("library_items", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  version: int("version").notNull().default(1),
  kind: mysqlEnum("kind", ["playbook", "template", "recording", "note"])
    .notNull()
    .default("playbook"),
  tierGate: mysqlEnum("tierGate", ["horizon", "ascent", "vanguard", "zenith"])
    .notNull()
    .default("horizon"),
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
  tierGate: mysqlEnum("tierGate", ["horizon", "ascent", "vanguard", "zenith"])
    .notNull()
    .default("horizon"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/* Provider-agnostic payment records (SRS INT-02). One row per checkout.
   providerRef is unique per provider so duplicate Stripe webhook deliveries
   and race conditions can't create double payments or double activations. */
export const paymentRecords = mysqlTable(
  "payment_records",
  {
    id: serial("id").primaryKey(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    provider: varchar("provider", { length: 32 }).notNull().default("stripe"),
    providerRef: varchar("providerRef", { length: 255 }), // checkout session / intent id
    purpose: varchar("purpose", { length: 32 }).notNull().default("membership"),
    tier: mysqlEnum("tier", ["horizon", "ascent", "vanguard", "zenith"]),
    amount: int("amount").notNull(), // minor units (fils)
    currency: varchar("currency", { length: 8 }).notNull().default("aed"),
    status: mysqlEnum("status", [
      "pending",
      "paid",
      "failed",
      "refunded",
      "partially_refunded",
    ])
      .notNull()
      .default("pending"),
    note: varchar("note", { length: 500 }), // manual/offline payment note or reference
    refundedByUserId: bigint("refundedByUserId", {
      mode: "number",
      unsigned: true,
    }),
    // Cumulative amount refunded (minor units). Equals `amount` for a full refund,
    // less for a partial. `status` becomes refunded / partially_refunded to match.
    refundedAmount: int("refundedAmount").notNull().default(0),
    refundReason: varchar("refundReason", { length: 500 }),
    refundedAt: timestamp("refundedAt"),
    // Funds-settlement time. Used for revenue recognition; may differ from createdAt
    // when a checkout spans a period end or an async payment settles later.
    paidAt: timestamp("paidAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  t => [
    uniqueIndex("payment_records_provider_ref_unique").on(
      t.provider,
      t.providerRef
    ),
  ]
);

/* ERP-grade invoice / credit-note ledger. One invoice is issued per settled
   payment; credit notes are issued on refunds. Numbers are daily sequences
   generated atomically through invoice_counters so concurrent writes can't
   collide. */
export type InvoiceLineItem = {
  label: string;
  amount: number; // minor units
  quantity?: number;
  description?: string;
};

export const invoiceCounters = mysqlTable(
  "invoice_counters",
  {
    id: serial("id").primaryKey(),
    prefix: varchar("prefix", { length: 16 }).notNull(), // "INV" or "CN"
    date: varchar("date", { length: 8 }).notNull(), // YYYYMMDD
    sequence: int("sequence").notNull().default(1),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  t => [uniqueIndex("invoice_counters_prefix_date_unique").on(t.prefix, t.date)]
);

export const invoices = mysqlTable(
  "invoices",
  {
    id: serial("id").primaryKey(),
    paymentRecordId: bigint("paymentRecordId", {
      mode: "number",
      unsigned: true,
    })
      .notNull()
      .references(() => paymentRecords.id, { onDelete: "restrict" }),
    memberId: bigint("memberId", { mode: "number", unsigned: true }),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    invoiceNumber: varchar("invoiceNumber", { length: 32 }).notNull().unique(),
    amount: int("amount").notNull(), // minor units (fils)
    currency: varchar("currency", { length: 8 }).notNull().default("aed"),
    status: mysqlEnum("status", ["open", "paid", "void"])
      .notNull()
      .default("open"),
    billedAt: timestamp("billedAt").notNull(),
    dueAt: timestamp("dueAt"),
    lineItems: json("lineItems").$type<InvoiceLineItem[]>().notNull(),
    pdfUrl: varchar("pdfUrl", { length: 512 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  t => [
    index("ix_invoices_payment_record").on(t.paymentRecordId),
    index("ix_invoices_user").on(t.userId),
    index("ix_invoices_member").on(t.memberId),
    index("ix_invoices_status").on(t.status),
    index("ix_invoices_billed_at").on(t.billedAt),
  ]
);
export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = typeof invoices.$inferInsert;

export const creditNotes = mysqlTable(
  "credit_notes",
  {
    id: serial("id").primaryKey(),
    paymentRecordId: bigint("paymentRecordId", {
      mode: "number",
      unsigned: true,
    })
      .notNull()
      .references(() => paymentRecords.id, { onDelete: "restrict" }),
    invoiceId: bigint("invoiceId", {
      mode: "number",
      unsigned: true,
    }).references(() => invoices.id, { onDelete: "set null" }),
    memberId: bigint("memberId", { mode: "number", unsigned: true }),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    creditNoteNumber: varchar("creditNoteNumber", { length: 32 })
      .notNull()
      .unique(),
    amount: int("amount").notNull(), // minor units (fils)
    currency: varchar("currency", { length: 8 }).notNull().default("aed"),
    reason: varchar("reason", { length: 500 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  t => [
    index("ix_credit_notes_payment_record").on(t.paymentRecordId),
    index("ix_credit_notes_invoice").on(t.invoiceId),
    index("ix_credit_notes_user").on(t.userId),
    index("ix_credit_notes_member").on(t.memberId),
  ]
);
export type CreditNote = typeof creditNotes.$inferSelect;
export type InsertCreditNote = typeof creditNotes.$inferInsert;

export const leads = mysqlTable(
  "leads",
  {
    id: serial("id").primaryKey(),
    form: varchar("form", { length: 64 }).notNull(),
    email: varchar("email", { length: 320 }),
    payload: text("payload"),
    sourcePage: varchar("sourcePage", { length: 255 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    /* Lightweight CRM: pipeline status, owner (admin) and freeform notes. */
    status: mysqlEnum("status", [
      "new",
      "contacted",
      "qualified",
      "won",
      "lost",
    ])
      .notNull()
      .default("new"),
    ownerUserId: bigint("ownerUserId", { mode: "number", unsigned: true }),
    notes: text("notes"),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  t => [
    index("ix_leads_status").on(t.status),
    index("ix_leads_created").on(t.createdAt),
  ]
);
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
  factor: varchar("factor", { length: 64 }).notNull(), // score factor bucket
  points: int("points").notNull(),
  label: varchar("label", { length: 255 }).notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

/* BRD 6.3 — Engagement Standard per tier (quarterly minimums; null = open item) */
export const engagementConfig = mysqlTable("engagement_config", {
  id: serial("id").primaryKey(),
  tier: mysqlEnum("tier", ["horizon", "ascent", "vanguard", "zenith"])
    .notNull()
    .unique(),
  sessionsRequired: int("sessionsRequired"), // e.g. 8
  sessionsOffered: int("sessionsOffered"), // e.g. 12 ("8 of 12")
  oneToOnesPerQuarter: int("oneToOnesPerQuarter"), // Ascent: 2/month → 6/quarter
  giveBackPerYear: int("giveBackPerYear"), // Vanguard: 2
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
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
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
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
/* Time-stamped KPI snapshots (KPI Framework Part 10 — the metrics engine).
   One row per metric per scope per day, so trends, cohorts and threshold
   alerting are possible. `scopeId` is null for network-wide metrics. */
export const kpiSnapshots = mysqlTable("kpi_snapshots", {
  id: serial("id").primaryKey(),
  scope: mysqlEnum("scope", ["network", "chapter", "zone", "region", "country"])
    .notNull()
    .default("network"),
  scopeId: bigint("scopeId", { mode: "number", unsigned: true }),
  metric: varchar("metric", { length: 48 }).notNull(),
  value: int("value").notNull(),
  capturedOn: varchar("capturedOn", { length: 10 }).notNull(), // YYYY-MM-DD (one per day)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type KpiSnapshot = typeof kpiSnapshots.$inferSelect;

/* Threshold alerts — raised when a KPI crosses its bar (KPI Framework Part 10:
   "any KPI crossing a threshold fires an alert to the owner"). Deduped: one open
   alert per metric+scope; auto-resolved when the metric recovers. */
export const kpiAlerts = mysqlTable("kpi_alerts", {
  id: serial("id").primaryKey(),
  scope: mysqlEnum("scope", ["network", "chapter", "zone", "region", "country"])
    .notNull()
    .default("network"),
  scopeId: bigint("scopeId", { mode: "number", unsigned: true }),
  metric: varchar("metric", { length: 48 }).notNull(),
  severity: mysqlEnum("severity", ["red", "amber"]).notNull().default("red"),
  message: varchar("message", { length: 500 }).notNull(),
  status: mysqlEnum("status", ["open", "acknowledged", "resolved"])
    .notNull()
    .default("open"),
  acknowledgedByEmail: varchar("acknowledgedByEmail", { length: 320 }),
  acknowledgedAt: timestamp("acknowledgedAt"),
  resolvedAt: timestamp("resolvedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type KpiAlert = typeof kpiAlerts.$inferSelect;

export const adminAuditLog = mysqlTable("admin_audit_log", {
  id: serial("id").primaryKey(),
  actorUserId: bigint("actorUserId", {
    mode: "number",
    unsigned: true,
  }).notNull(),
  actorEmail: varchar("actorEmail", { length: 320 }),
  action: varchar("action", { length: 64 }).notNull(), // e.g. "application.approve"
  targetType: varchar("targetType", { length: 48 }), // e.g. "application"
  targetId: varchar("targetId", { length: 64 }),
  detail: text("detail"), // short human summary
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

export const notifications = mysqlTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
    text: varchar("text", { length: 500 }).notNull(),
    kind: varchar("kind", { length: 32 }).notNull().default("info"), // info | dormancy | event | connect
    readAt: timestamp("readAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => [index("ix_notifications_member_read").on(t.memberId, t.readAt)]
);

/* BRD 6.3 — 1-2-1s with counterpart confirmation; kind=mentoring feeds Give-Back */
export const oneToOnes = mysqlTable(
  "one_to_ones",
  {
    id: serial("id").primaryKey(),
    aMemberId: bigint("aMemberId", {
      mode: "number",
      unsigned: true,
    }).notNull(), // logger
    bMemberId: bigint("bMemberId", {
      mode: "number",
      unsigned: true,
    }).notNull(), // counterpart
    kind: mysqlEnum("kind", ["one_to_one", "mentoring"])
      .notNull()
      .default("one_to_one"),
    note: varchar("note", { length: 500 }),
    status: mysqlEnum("status", ["pending", "confirmed", "declined"])
      .notNull()
      .default("pending"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    confirmedAt: timestamp("confirmedAt"),
  },
  t => [index("ix_o2o_a").on(t.aMemberId), index("ix_o2o_b").on(t.bMemberId)]
);

/* BRD 6.3 — buddy pairing for new members (paired within 5 days, 30-day check-in) */
export const buddies = mysqlTable("buddies", {
  id: serial("id").primaryKey(),
  newMemberId: bigint("newMemberId", {
    mode: "number",
    unsigned: true,
  }).notNull(),
  buddyMemberId: bigint("buddyMemberId", {
    mode: "number",
    unsigned: true,
  }).notNull(),
  pairedAt: timestamp("pairedAt").defaultNow().notNull(),
  checkinAt: timestamp("checkinAt"),
  note: varchar("note", { length: 500 }),
});

/* BRD 6.3 — member-submitted referrals (give-to-get; converted referrals score higher) */
export const referrals = mysqlTable(
  "referrals",
  {
    id: serial("id").primaryKey(),
    memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
    prospectName: varchar("prospectName", { length: 255 }).notNull(),
    prospectContact: varchar("prospectContact", { length: 255 }),
    note: varchar("note", { length: 500 }),
    status: mysqlEnum("status", ["submitted", "converted", "rejected"])
      .notNull()
      .default("submitted"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => [index("ix_referrals_member").on(t.memberId)]
);

/* BRD 6.3 — Deal Flow board (tier-gated; Ascent requires 1 referral/quarter to post) */
export const deals = mysqlTable("deals", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  tierGate: mysqlEnum("tierGate", ["horizon", "ascent", "vanguard", "zenith"])
    .notNull()
    .default("ascent"),
  postedBy: bigint("postedBy", { mode: "number", unsigned: true }), // memberId, null = staff
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/* BRD 6.4 — post-event feedback */
export const eventFeedback = mysqlTable(
  "event_feedback",
  {
    id: serial("id").primaryKey(),
    eventId: bigint("eventId", { mode: "number", unsigned: true }).notNull(),
    memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
    rating: int("rating").notNull(), // 1-5
    comment: varchar("comment", { length: 1000 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => [index("ix_eventfb_event").on(t.eventId)]
);

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
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
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
  status: mysqlEnum("status", [
    "nominated",
    "endorsing",
    "review",
    "approved",
    "rejected",
  ])
    .notNull()
    .default("nominated"),
  note: varchar("note", { length: 1000 }),
  decidedAt: timestamp("decidedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const endorsements = mysqlTable(
  "endorsements",
  {
    id: serial("id").primaryKey(),
    appId: bigint("appId", { mode: "number", unsigned: true }).notNull(),
    memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(), // endorser
    role: mysqlEnum("role", ["qc", "board"]).notNull().default("qc"), // QC member or board member
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => [index("ix_endorsements_app").on(t.appId)]
);

/* BRD 6.6 — investor relationship tracker (staff-only) with cool-down rules */
export const investorIntros = mysqlTable("investor_intros", {
  id: serial("id").primaryKey(),
  investorName: varchar("investorName", { length: 255 }).notNull(),
  firm: varchar("firm", { length: 255 }),
  memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(), // member introduced
  introducedBy: varchar("introducedBy", { length: 128 }).notNull(), // staff name
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
/* The governance hierarchy above the chapter: Zone → Region → Country. A single
   self-referencing table (parentId) so roll-ups nest cleanly (M7/M11). */
export const orgUnits = mysqlTable("org_units", {
  id: serial("id").primaryKey(),
  level: mysqlEnum("level", ["zone", "region", "country"]).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 24 }),
  parentId: bigint("parentId", { mode: "number", unsigned: true }), // zone→region→country→null
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type OrgUnit = typeof orgUnits.$inferSelect;

/* Leadership at a Zone/Region/Country level — the councils above the chapter
   (ZO/RE/NA). Mirrors chapterRoles but keyed to an org unit. */
export const unitRoles = mysqlTable("unit_roles", {
  id: serial("id").primaryKey(),
  unitId: bigint("unitId", { mode: "number", unsigned: true }).notNull(),
  level: mysqlEnum("level", ["zone", "region", "country"]).notNull(),
  memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
  role: varchar("role", { length: 96 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/* Councils as working bodies (ZO/RE/NA governance): the leaders in unit_roles
   convene here — a meeting carries an agenda and minutes, and decisions are the
   motions the council carries/defeats. Scoped to an org_unit. */
export const councilMeetings = mysqlTable("council_meetings", {
  id: serial("id").primaryKey(),
  unitId: bigint("unitId", { mode: "number", unsigned: true }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  scheduledAt: timestamp("scheduledAt"),
  status: mysqlEnum("status", ["scheduled", "held", "cancelled"])
    .notNull()
    .default("scheduled"),
  agenda: text("agenda"),
  minutes: text("minutes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export const councilDecisions = mysqlTable("council_decisions", {
  id: serial("id").primaryKey(),
  unitId: bigint("unitId", { mode: "number", unsigned: true }).notNull(),
  meetingId: bigint("meetingId", { mode: "number", unsigned: true }), // null = standalone decision
  title: varchar("title", { length: 255 }).notNull(),
  detail: text("detail"),
  status: mysqlEnum("status", ["proposed", "carried", "failed", "deferred"])
    .notNull()
    .default("proposed"),
  decidedAt: timestamp("decidedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/* NA-03 Recognition Awards. A cycle is one awards round; nominations are peers
   (or chapters) put forward per category and shortlisted/won by the National body. */
export const awardCycles = mysqlTable("award_cycles", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  status: mysqlEnum("status", [
    "draft",
    "open",
    "judging",
    "announced",
    "closed",
  ])
    .notNull()
    .default("draft"),
  // The level this cycle is run at, and the unit it's scoped to. `network` =
  // whole organisation (unitId null). chapter → chapters.id; zone/region/country
  // → org_units.id at the matching level.
  level: mysqlEnum("level", ["network", "chapter", "zone", "region", "country"])
    .notNull()
    .default("network"),
  unitId: bigint("unitId", { mode: "number", unsigned: true }),
  // Panel-judging rubric as JSON [{ key, label, weight }] (weights sum to 100).
  // Null falls back to the default rubric (see api/lib/awards-scoring.ts).
  rubric: text("rubric"),
  opensAt: timestamp("opensAt"),
  closesAt: timestamp("closesAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export const awardNominations = mysqlTable("award_nominations", {
  id: serial("id").primaryKey(),
  cycleId: bigint("cycleId", { mode: "number", unsigned: true }).notNull(),
  category: varchar("category", { length: 48 }).notNull(), // AWARD_CATEGORIES key
  nomineeMemberId: bigint("nomineeMemberId", {
    mode: "number",
    unsigned: true,
  }), // member subject
  nomineeChapterId: bigint("nomineeChapterId", {
    mode: "number",
    unsigned: true,
  }), // chapter subject
  nominatedByMemberId: bigint("nominatedByMemberId", {
    mode: "number",
    unsigned: true,
  }), // null = admin-entered
  citation: text("citation"),
  status: mysqlEnum("status", [
    "nominated",
    "shortlisted",
    "winner",
    "declined",
  ])
    .notNull()
    .default("nominated"),
  // Independent ratification of a winner (the fourth judging gate). A winner is
  // only conferred once ratified by an officer who is not a judge of the cycle.
  ratifiedByUserId: bigint("ratifiedByUserId", {
    mode: "number",
    unsigned: true,
  }),
  ratifiedAt: timestamp("ratifiedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/* Panel judging (Awards spec Part 1 / Part 7). A cycle's panel-judged
   categories are scored by an assigned, independent panel against the cycle's
   rubric; the weighted average across judges ranks nominees, and an independent
   officer ratifies the winner before conferral. */
export const awardJudges = mysqlTable(
  "award_judges",
  {
    id: serial("id").primaryKey(),
    cycleId: bigint("cycleId", { mode: "number", unsigned: true }).notNull(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(), // the judge (staff/officer)
    assignedByUserId: bigint("assignedByUserId", {
      mode: "number",
      unsigned: true,
    }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => [uniqueIndex("award_judges_cycle_user_unique").on(t.cycleId, t.userId)]
);

export const awardScores = mysqlTable(
  "award_scores",
  {
    id: serial("id").primaryKey(),
    cycleId: bigint("cycleId", { mode: "number", unsigned: true }).notNull(),
    nominationId: bigint("nominationId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    judgeUserId: bigint("judgeUserId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    // Per-criterion scores (0–100) as JSON [{ key, value }], and the rubric-
    // weighted total (0–100) computed at submit time.
    scores: text("scores").notNull(),
    total: int("total").notNull(),
    note: varchar("note", { length: 1000 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  t => [
    uniqueIndex("award_scores_nomination_judge_unique").on(
      t.nominationId,
      t.judgeUserId
    ),
    index("ix_awardscores_cycle").on(t.cycleId),
  ]
);

/* Conferred awards (Awards spec Part 7 — the AwardRecord object). An immutable
   record of a member/chapter winning an award in a cycle, feeding profiles, the
   recognition-point scheme, fairness caps and the Hall-of-Fame tracker. */
export const awardRecords = mysqlTable(
  "award_records",
  {
    id: serial("id").primaryKey(),
    cycleId: bigint("cycleId", { mode: "number", unsigned: true }),
    awardKey: varchar("awardKey", { length: 64 }).notNull(), // stable award identifier
    label: varchar("label", { length: 160 }).notNull(),
    level: mysqlEnum("level", [
      "network",
      "chapter",
      "zone",
      "region",
      "country",
    ])
      .notNull()
      .default("network"),
    memberId: bigint("memberId", { mode: "number", unsigned: true }),
    chapterId: bigint("chapterId", { mode: "number", unsigned: true }),
    source: mysqlEnum("source", ["auto", "panel", "vote"]).notNull(),
    score: int("score"), // winning score where applicable
    points: int("points").notNull().default(0), // recognition points awarded
    conferredByUserId: bigint("conferredByUserId", {
      mode: "number",
      unsigned: true,
    }),
    conferredAt: timestamp("conferredAt").defaultNow().notNull(),
    note: varchar("note", { length: 500 }),
  },
  t => [
    index("ix_awardrecords_member").on(t.memberId),
    index("ix_awardrecords_award").on(t.awardKey, t.conferredAt),
  ]
);

/* Constrained shortlist voting (Awards spec Part 1 — the member-vote mechanism).
   Eligible members cast ONE equal vote over a PRE-QUALIFIED shortlist (never an
   open field); the unique key enforces one vote per member per cycle. */
export const awardVotes = mysqlTable(
  "award_votes",
  {
    id: serial("id").primaryKey(),
    cycleId: bigint("cycleId", { mode: "number", unsigned: true }).notNull(),
    nominationId: bigint("nominationId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    voterMemberId: bigint("voterMemberId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => [
    uniqueIndex("award_votes_cycle_voter_unique").on(
      t.cycleId,
      t.voterMemberId
    ),
    index("ix_awardvotes_nomination").on(t.nominationId),
  ]
);

/* Integrity flags (Awards spec Part 8 — the IntegrityFlag object). Gaming,
   conflict and moderation concerns raised (by the automated scan or by hand)
   against a cycle before a winner is conferred. An OPEN flag blocks conferral;
   an officer must clear or uphold it first. */
export const awardIntegrityFlags = mysqlTable(
  "award_integrity_flags",
  {
    id: serial("id").primaryKey(),
    cycleId: bigint("cycleId", { mode: "number", unsigned: true }).notNull(),
    // Optional subjects — a nomination and/or a member the flag concerns.
    nominationId: bigint("nominationId", { mode: "number", unsigned: true }),
    memberId: bigint("memberId", { mode: "number", unsigned: true }),
    kind: mysqlEnum("kind", [
      "conflict", // officer self-dealing / connected judge
      "reciprocity", // mutual-crediting collusion
      "vote_velocity", // vote brigading / burst
      "conduct", // open conduct/moderation case
      "manual", // raised by hand
    ]).notNull(),
    severity: mysqlEnum("severity", ["info", "warn", "block"])
      .notNull()
      .default("warn"),
    detail: varchar("detail", { length: 500 }).notNull(),
    status: mysqlEnum("status", ["open", "cleared", "upheld"])
      .notNull()
      .default("open"),
    // Null raiser = the automated scan.
    raisedByUserId: bigint("raisedByUserId", {
      mode: "number",
      unsigned: true,
    }),
    resolvedByUserId: bigint("resolvedByUserId", {
      mode: "number",
      unsigned: true,
    }),
    resolutionNote: varchar("resolutionNote", { length: 500 }),
    resolvedAt: timestamp("resolvedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => [
    index("ix_integrityflags_cycle").on(t.cycleId),
    index("ix_integrityflags_nomination").on(t.nominationId),
    // Lets the scan dedupe an existing open auto-flag of the same kind/target.
    index("ix_integrityflags_dedupe").on(
      t.cycleId,
      t.kind,
      t.nominationId,
      t.status
    ),
  ]
);

export type UnitRole = typeof unitRoles.$inferSelect;

export const chapters = mysqlTable("chapters", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  zoneId: bigint("zoneId", { mode: "number", unsigned: true }), // the Zone this chapter rolls up to
  code: varchar("code", { length: 24 }), // short chapter code, e.g. "AE-DXB-01"
  country: varchar("country", { length: 128 }),
  region: varchar("region", { length: 128 }), // operating region (e.g. "Gulf", "UAE")
  state: varchar("state", { length: 128 }), // state / emirate / province
  city: varchar("city", { length: 128 }),
  zone: varchar("zone", { length: 128 }), // area within a city (e.g. "DIFC", "Downtown")
  meetingCadence: varchar("meetingCadence", { length: 64 }), // e.g. "Weekly · Tue 7:30am"
  status: mysqlEnum("status", [
    "seed",
    "provisional",
    "chartered",
    "mature",
    "at_risk",
  ])
    .notNull()
    .default("seed"),
  charterDate: timestamp("charterDate"),
  deletedAt: timestamp("deletedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/* BRD 6.7 — member-requested chapter transfers. A member asks to move to another
   chapter; management approves before the home chapter changes (mirrors the tier
   change approval flow). */
export const chapterTransfers = mysqlTable(
  "chapter_transfers",
  {
    id: serial("id").primaryKey(),
    memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
    fromChapterId: bigint("fromChapterId", { mode: "number", unsigned: true }),
    toChapterId: bigint("toChapterId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    note: varchar("note", { length: 500 }),
    status: mysqlEnum("status", ["pending", "approved", "rejected"])
      .notNull()
      .default("pending"),
    actorEmail: varchar("actorEmail", { length: 320 }),
    decidedAt: timestamp("decidedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => [
    index("ix_chtransfers_status").on(t.status),
    index("ix_chtransfers_member").on(t.memberId),
  ]
);

/* Operations Manual A2 — the chapter operating rhythm. A recurring obligation
   the platform schedules and rolls up ("cadence is the product"). */
export const cadences = mysqlTable(
  "cadences",
  {
    id: serial("id").primaryKey(),
    chapterId: bigint("chapterId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    type: varchar("type", { length: 48 }).notNull(), // CADENCE_TEMPLATES type
    title: varchar("title", { length: 128 }).notNull(),
    frequency: varchar("frequency", { length: 16 }).notNull(), // weekly | biweekly | ...
    ownerRole: varchar("ownerRole", { length: 48 }), // accountable chapter role
    sop: varchar("sop", { length: 16 }),
    active: int("active").notNull().default(1),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => [index("ix_cadences_chapter").on(t.chapterId)]
);

/* One row per cadence occurrence a leader records — kept / rescheduled / missed
   (§A2 "the one rule of the calendar"). Keyed by the period it belongs to. */
export const cadenceLog = mysqlTable(
  "cadence_log",
  {
    id: serial("id").primaryKey(),
    cadenceId: bigint("cadenceId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    periodKey: varchar("periodKey", { length: 16 }).notNull(),
    status: mysqlEnum("status", ["kept", "rescheduled", "missed"]).notNull(),
    note: varchar("note", { length: 500 }),
    actorMemberId: bigint("actorMemberId", { mode: "number", unsigned: true }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => [index("ix_cadencelog_cadence_period").on(t.cadenceId, t.periodKey)]
);

/* Operations Manual M7 / CH-06 — chapter health snapshots. Time-stamped index +
   its six components, saved for trend and Zone comparison. */
export const healthSnapshots = mysqlTable(
  "health_snapshots",
  {
    id: serial("id").primaryKey(),
    chapterId: bigint("chapterId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    total: int("total").notNull(),
    retention: int("retention").notNull(),
    engagement: int("engagement").notNull(),
    growth: int("growth").notNull(),
    programme: int("programme").notNull(),
    leadership: int("leadership").notNull(),
    governance: int("governance").notNull(),
    memberCount: int("memberCount").notNull().default(0),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => [index("ix_health_chapter").on(t.chapterId, t.createdAt)]
);

/* BRD 6.7 — chapter "learnings": notes, resources and playbooks an officer
   shares with their chapter to drive growth. */
export const chapterPosts = mysqlTable(
  "chapter_posts",
  {
    id: serial("id").primaryKey(),
    chapterId: bigint("chapterId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    authorMemberId: bigint("authorMemberId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    body: text("body"),
    url: varchar("url", { length: 512 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => [index("ix_chposts_chapter").on(t.chapterId)]
);

/* BRD 6.7 — chapter leadership team. A member holds a named office in a chapter
   (President, Treasurer, PODs Lead …), assigned directly or from an election.
   One active holder per role per chapter; superseded rows are marked ended. */
export const chapterRoles = mysqlTable(
  "chapter_roles",
  {
    id: serial("id").primaryKey(),
    chapterId: bigint("chapterId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
    role: varchar("role", { length: 64 }).notNull(), // CHAPTER_ROLES key, or "other"
    title: varchar("title", { length: 128 }), // custom title when role = "other"
    responsibilities: text("responsibilities"), // optional override of the default
    electionId: bigint("electionId", { mode: "number", unsigned: true }), // set when elected
    termStart: timestamp("termStart"),
    termEnd: timestamp("termEnd"),
    onboardingMask: int("onboardingMask").notNull().default(0), // ROLE_ONBOARDING_STEPS progress
    status: mysqlEnum("status", ["active", "ended"])
      .notNull()
      .default("active"),
    appointedBy: varchar("appointedBy", { length: 320 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => [
    index("ix_chroles_chapter_status").on(t.chapterId, t.status),
    index("ix_chroles_member").on(t.memberId),
  ]
);

/* BRD 6.7 — elections: eligibility-checked candidates, secret ballot, quorum, tamper-evident results.
   Secrecy: ballots store NO voter identity; participation is recorded separately in ballotRoll. */
export const elections = mysqlTable(
  "elections",
  {
    id: serial("id").primaryKey(),
    chapterId: bigint("chapterId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    seat: varchar("seat", { length: 128 }).notNull(),
    status: mysqlEnum("status", ["open", "voting", "closed"])
      .notNull()
      .default("open"),
    opensAt: timestamp("opensAt"),
    closesAt: timestamp("closesAt"),
    quorumPct: int("quorumPct").notNull().default(50),
    resultHash: varchar("resultHash", { length: 64 }), // tamper-evident digest published at close
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => [index("ix_elections_chapter").on(t.chapterId)]
);

export const candidates = mysqlTable(
  "candidates",
  {
    id: serial("id").primaryKey(),
    electionId: bigint("electionId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
    statement: varchar("statement", { length: 1000 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => [index("ix_candidates_election").on(t.electionId)]
);

export const ballots = mysqlTable("ballots", {
  id: serial("id").primaryKey(),
  electionId: bigint("electionId", {
    mode: "number",
    unsigned: true,
  }).notNull(),
  candidateId: bigint("candidateId", {
    mode: "number",
    unsigned: true,
  }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const ballotRoll = mysqlTable(
  "ballot_roll",
  {
    id: serial("id").primaryKey(),
    electionId: bigint("electionId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(), // voted — not how
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => [index("ix_ballotroll_election_member").on(t.electionId, t.memberId)]
);

/* BRD 6.7 — motions: one member, one vote */
export const motions = mysqlTable(
  "motions",
  {
    id: serial("id").primaryKey(),
    chapterId: bigint("chapterId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    body: text("body"),
    status: mysqlEnum("status", ["open", "passed", "rejected"])
      .notNull()
      .default("open"),
    closesAt: timestamp("closesAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => [index("ix_motions_chapter").on(t.chapterId)]
);

export const motionVotes = mysqlTable(
  "motion_votes",
  {
    id: serial("id").primaryKey(),
    motionId: bigint("motionId", { mode: "number", unsigned: true }).notNull(),
    memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
    choice: mysqlEnum("choice", ["yes", "no", "abstain"]).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => [index("ix_motionvotes_motion_member").on(t.motionId, t.memberId)]
);

/* BRD 6.7 — chapter budgets: allocations, sponsorships, spend approvals */
export const chapterBudgets = mysqlTable("chapter_budgets", {
  id: serial("id").primaryKey(),
  chapterId: bigint("chapterId", { mode: "number", unsigned: true }).notNull(),
  label: varchar("label", { length: 255 }).notNull(),
  kind: mysqlEnum("kind", ["allocation", "sponsorship", "spend"])
    .notNull()
    .default("allocation"),
  amount: int("amount").notNull(), // AED
  // Expense category (EXPENSE_CATEGORIES key) for spend rows — null on
  // allocations/sponsorships. Enables spend-by-category reporting.
  category: varchar("category", { length: 48 }),
  status: mysqlEnum("status", ["proposed", "approved", "spent", "rejected"])
    .notNull()
    .default("proposed"),
  approvedByUserId: bigint("approvedByUserId", {
    mode: "number",
    unsigned: true,
  }), // who approved/rejected
  note: text("note"), // decision note / justification
  // Optional receipt for a spend line — the file as a base64 data URL plus its
  // original name. Stored in-row (small receipts only); no external storage.
  receiptData: text("receiptData"),
  receiptName: varchar("receiptName", { length: 255 }),
  decidedAt: timestamp("decidedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/* Multi-currency FX rates (admin-maintained). One row per non-base currency;
   `rateScaled` is base minor-units per 1 minor-unit of the currency ×
   FX_RATE_SCALE (see @contracts/constants). Finance reporting converts every
   payment to the base currency (AED) using these. */
export const currencyRates = mysqlTable("currency_rates", {
  code: varchar("code", { length: 8 }).primaryKey(), // e.g. "usd"
  rateScaled: bigint("rateScaled", {
    mode: "number",
    unsigned: true,
  }).notNull(),
  updatedByUserId: bigint("updatedByUserId", {
    mode: "number",
    unsigned: true,
  }),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
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

/* XC-04 — Conduct & incident handling. A confidential case record with the
   process trail. Reporter/subject are optional so a report can be anonymous or
   about a situation rather than a named member. */
export const conductCases = mysqlTable("conduct_cases", {
  id: serial("id").primaryKey(),
  reporterMemberId: bigint("reporterMemberId", {
    mode: "number",
    unsigned: true,
  }), // null = anonymous
  subjectMemberId: bigint("subjectMemberId", {
    mode: "number",
    unsigned: true,
  }), // null = not a named member
  chapterId: bigint("chapterId", { mode: "number", unsigned: true }),
  category: varchar("category", { length: 64 }).notNull(),
  severity: mysqlEnum("severity", ["low", "moderate", "high", "safeguarding"])
    .notNull()
    .default("moderate"),
  status: mysqlEnum("status", [
    "open",
    "reviewing",
    "actioned",
    "escalated",
    "closed",
  ])
    .notNull()
    .default("open"),
  summary: varchar("summary", { length: 255 }).notNull(),
  detail: text("detail"),
  handledByUserId: bigint("handledByUserId", {
    mode: "number",
    unsigned: true,
  }),
  resolution: text("resolution"),
  /* MOD-04 — appeal: the subject may challenge an action; reviewed one level up
     (never the original decider). none until the member appeals. */
  appealStatus: mysqlEnum("appealStatus", [
    "none",
    "open",
    "upheld",
    "reduced",
    "reversed",
  ])
    .notNull()
    .default("none"),
  appealReason: text("appealReason"),
  appealReviewerUserId: bigint("appealReviewerUserId", {
    mode: "number",
    unsigned: true,
  }),
  appealOutcome: text("appealOutcome"),
  appealedAt: timestamp("appealedAt"),
  appealDecidedAt: timestamp("appealDecidedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

/* ML-04b — Save Playbook cases. One tracked intervention per At-Risk episode:
   an owner in Member Success works the ordered SAVE_PLAYBOOK_STEPS (stored as a
   bitmask) and closes it saved or lost. Opened automatically when a member is
   flagged at-risk; at most one open case per member at a time. */
export const memberSaveCases = mysqlTable("member_save_cases", {
  id: serial("id").primaryKey(),
  memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
  chapterId: bigint("chapterId", { mode: "number", unsigned: true }),
  status: mysqlEnum("status", ["open", "working", "saved", "lost"])
    .notNull()
    .default("open"),
  reason: varchar("reason", { length: 255 }).notNull(),
  ownerUserId: bigint("ownerUserId", { mode: "number", unsigned: true }),
  stepsMask: int("stepsMask").notNull().default(0),
  notes: text("notes"),
  resolution: text("resolution"),
  openedAt: timestamp("openedAt").defaultNow().notNull(),
  closedAt: timestamp("closedAt"),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});
export type ConductCase = typeof conductCases.$inferSelect;

/* M3 / CH-01 · CH-04 — structured Chapter & Board meetings: a default agenda
   (pre-loaded from the manual templates), attendance and minutes. */
export const meetings = mysqlTable("meetings", {
  id: serial("id").primaryKey(),
  chapterId: bigint("chapterId", { mode: "number", unsigned: true }).notNull(),
  kind: mysqlEnum("kind", [
    "chapter_meeting",
    "board_meeting",
    "huddle",
    "other",
  ])
    .notNull()
    .default("chapter_meeting"),
  title: varchar("title", { length: 255 }).notNull(),
  scheduledAt: timestamp("scheduledAt"),
  status: mysqlEnum("status", ["scheduled", "held", "cancelled"])
    .notNull()
    .default("scheduled"),
  agenda: text("agenda"),
  minutes: text("minutes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type Meeting = typeof meetings.$inferSelect;

/* Attendance for a meeting (M3). One row per member per meeting. */
export const meetingAttendance = mysqlTable("meeting_attendance", {
  id: serial("id").primaryKey(),
  meetingId: bigint("meetingId", { mode: "number", unsigned: true }).notNull(),
  memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
  status: mysqlEnum("status", ["present", "absent", "excused"])
    .notNull()
    .default("present"),
});
export type MeetingAttendance = typeof meetingAttendance.$inferSelect;

/* ML-01 — top-of-funnel: prospects captured and nurtured to guest, then invited
   to apply. A lightweight CRM that sits before the Application. */
export const prospects = mysqlTable("prospects", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 40 }),
  company: varchar("company", { length: 255 }),
  chapterId: bigint("chapterId", { mode: "number", unsigned: true }),
  stage: mysqlEnum("stage", [
    "prospect",
    "guest",
    "invited",
    "converted",
    "declined",
  ])
    .notNull()
    .default("prospect"),
  source: varchar("source", { length: 120 }),
  notes: text("notes"),
  ownerUserId: bigint("ownerUserId", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});
export type Prospect = typeof prospects.$inferSelect;

/* CH-01 / CH-03 — guest follow-up tasks. When a guest/prospect is captured, the
   system auto-creates a task with an owner and a deadline so no warm guest is
   dropped. Also usable for ad-hoc chapter follow-ups. */
export const followUps = mysqlTable("follow_ups", {
  id: serial("id").primaryKey(),
  chapterId: bigint("chapterId", { mode: "number", unsigned: true }),
  prospectId: bigint("prospectId", { mode: "number", unsigned: true }),
  ownerUserId: bigint("ownerUserId", { mode: "number", unsigned: true }),
  title: varchar("title", { length: 255 }).notNull(),
  dueAt: timestamp("dueAt"),
  status: mysqlEnum("status", ["open", "done", "dismissed"])
    .notNull()
    .default("open"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  doneAt: timestamp("doneAt"),
});
export type FollowUp = typeof followUps.$inferSelect;

/* Clarity Scorecard submissions — persisted so the team can follow up and the
   visitor can receive a saved copy of their results. */
export const scorecardResults = mysqlTable(
  "scorecard_results",
  {
    id: serial("id").primaryKey(),
    email: varchar("email", { length: 320 }).notNull(),
    name: varchar("name", { length: 255 }),
    phone: varchar("phone", { length: 64 }),
    company: varchar("company", { length: 255 }),
    location: varchar("location", { length: 255 }),
    industry: varchar("industry", { length: 128 }),
    total: int("total").notNull(),
    domains: json("domains"),
    recommendationProduct: varchar("recommendationProduct", { length: 128 }),
    recommendationWhy: text("recommendationWhy"),
    nurtureStage: mysqlEnum("nurtureStage", [
      "new",
      "emailed",
      "follow_up_1",
      "follow_up_2",
      "replied",
      "booked",
      "disqualified",
    ])
      .notNull()
      .default("new"),
    emailedAt: timestamp("emailedAt"),
    leadId: bigint("leadId", { mode: "number", unsigned: true }).references(
      () => leads.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  t => [
    index("ix_scorecard_email").on(t.email),
    index("ix_scorecard_stage").on(t.nurtureStage),
  ]
);
export type ScorecardResult = typeof scorecardResults.$inferSelect;
export type InsertScorecardResult = typeof scorecardResults.$inferInsert;

/* Public appointment bookings — consulting discovery calls, sprints and business
   setup consultations. Stored with the requested slot so the team can confirm,
   reschedule and avoid double-booking once the live calendar connects. */
export const appointments = mysqlTable(
  "appointments",
  {
    id: serial("id").primaryKey(),
    product: varchar("product", { length: 64 }).notNull(),
    status: mysqlEnum("status", [
      "requested",
      "confirmed",
      "cancelled",
      "no_show",
    ])
      .notNull()
      .default("requested"),
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    phone: varchar("phone", { length: 64 }),
    notes: text("notes"),
    scheduledAt: timestamp("scheduledAt").notNull(),
    timezone: varchar("timezone", { length: 64 })
      .notNull()
      .default("Asia/Dubai"),
    durationMin: int("durationMin").notNull().default(30),
    leadId: bigint("leadId", { mode: "number", unsigned: true }).references(
      () => leads.id,
      { onDelete: "set null" }
    ),
    confirmedAt: timestamp("confirmedAt"),
    cancelledAt: timestamp("cancelledAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  t => [
    index("ix_appointments_status").on(t.status),
    index("ix_appointments_scheduled").on(t.scheduledAt),
    index("ix_appointments_email").on(t.email),
  ]
);
export type Appointment = typeof appointments.$inferSelect;
export type InsertAppointment = typeof appointments.$inferInsert;

/* Shared rate-limit counters — stored in MySQL so per-IP/account limits apply
   across multiple app replicas (Railway can scale horizontally). */
export const rateLimits = mysqlTable("rate_limits", {
  key: varchar("key", { length: 255 }).primaryKey(),
  count: int("count").notNull(),
  resetAt: bigint("resetAt", { mode: "number" }).notNull(),
});
