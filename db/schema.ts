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
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
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
  kind: mysqlEnum("kind", ["spark", "meetup", "circle", "retreat", "summit"]).notNull().default("meetup"),
  description: text("description"),
  startsAt: timestamp("startsAt").notNull(),
  location: varchar("location", { length: 255 }),
  tierGate: mysqlEnum("tierGate", ["horizon", "ascent", "vanguard", "zenith"]).notNull().default("horizon"),
  capacity: int("capacity").notNull().default(40),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type CircleEvent = typeof events.$inferSelect;

export const eventRegs = mysqlTable("event_regs", {
  id: serial("id").primaryKey(),
  eventId: bigint("eventId", { mode: "number", unsigned: true }).notNull(),
  memberId: bigint("memberId", { mode: "number", unsigned: true }).notNull(),
  status: mysqlEnum("status", ["registered", "attended", "cancelled"]).notNull().default("registered"),
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

export const leads = mysqlTable("leads", {
  id: serial("id").primaryKey(),
  form: varchar("form", { length: 64 }).notNull(),
  email: varchar("email", { length: 320 }),
  payload: text("payload"),
  sourcePage: varchar("sourcePage", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
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
