import mysql from "mysql2/promise";
import { env } from "../lib/env";

/**
 * Idempotent, additive schema reconciliation run once at boot. It only ever
 * ADDs columns or WIDENs an enum that a newer build depends on — never drops or
 * rewrites data — so deploys are self-healing and don't require a manual
 * `db:push`. Each statement is guarded by an information_schema check, and a
 * fresh database (tables not created yet) is skipped entirely because
 * `db:push`/`seed` will create everything with the current schema.
 *
 * Never throws to the caller in a way that blocks boot — the caller wraps it.
 */
export async function ensureSchema(): Promise<void> {
  const conn = await mysql.createConnection({
    uri: env.databaseUrl,
    ssl: process.env.DATABASE_SSL === "true" ? { minVersion: "TLSv1.2" } : undefined,
  });
  try {
    const [rows] = (await conn.query(
      `select table_name as t, column_name as c, column_type as ct
         from information_schema.columns where table_schema = database()`,
    )) as [Array<{ t: string; c: string; ct: string }>, unknown];

    const cols = new Map<string, string>(); // "table.column" -> COLUMN_TYPE
    const tables = new Set<string>();
    for (const r of rows) {
      cols.set(`${r.t}.${r.c}`, String(r.ct).toLowerCase());
      tables.add(r.t);
    }

    const stmts: string[] = [];

    // --- events: activity master (audience) + widened kind catalogue ---
    if (tables.has("events")) {
      if (!cols.has("events.audience"))
        stmts.push(
          "ALTER TABLE events ADD COLUMN audience enum('public','members','tiers') NOT NULL DEFAULT 'members'",
        );
      if (!cols.has("events.audienceTiers"))
        stmts.push("ALTER TABLE events ADD COLUMN audienceTiers varchar(128) NULL");
      const kind = cols.get("events.kind") ?? "";
      if (kind && !kind.includes("'webinar'"))
        stmts.push(
          "ALTER TABLE events MODIFY COLUMN kind enum('spark','meetup','circle','retreat','summit'," +
            "'conference','conclave','roundtable','workshop','masterclass'," +
            "'breakfast','lunch','dinner','social','webinar') NOT NULL DEFAULT 'meetup'",
        );
    }

    // --- chapters: BNI-style geographic formation standards ---
    if (tables.has("chapters")) {
      const add: Array<[string, string]> = [
        ["code", "varchar(24) NULL"],
        ["region", "varchar(128) NULL"],
        ["state", "varchar(128) NULL"],
        ["zone", "varchar(128) NULL"],
        ["meetingCadence", "varchar(64) NULL"],
      ];
      for (const [col, def] of add)
        if (!cols.has(`chapters.${col}`)) stmts.push(`ALTER TABLE chapters ADD COLUMN ${col} ${def}`);
    }

    // --- membership_events: tier-change approval workflow ---
    if (tables.has("membership_events")) {
      if (!cols.has("membership_events.status"))
        stmts.push(
          "ALTER TABLE membership_events ADD COLUMN status enum('applied','pending','approved','rejected') NOT NULL DEFAULT 'applied'",
        );
      if (!cols.has("membership_events.actorEmail"))
        stmts.push("ALTER TABLE membership_events ADD COLUMN actorEmail varchar(320) NULL");
      if (!cols.has("membership_events.decidedAt"))
        stmts.push("ALTER TABLE membership_events ADD COLUMN decidedAt timestamp NULL");
    }

    // New tables added after the initial schema — created here so a deploy that
    // introduces them doesn't need a manual db:push. CREATE TABLE IF NOT EXISTS
    // is inherently idempotent.
    stmts.push(
      `CREATE TABLE IF NOT EXISTS chapter_transfers (
        id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
        memberId bigint unsigned NOT NULL,
        fromChapterId bigint unsigned NULL,
        toChapterId bigint unsigned NOT NULL,
        note varchar(500) NULL,
        status enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
        actorEmail varchar(320) NULL,
        decidedAt timestamp NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    );
    tables.add("chapter_transfers"); // so its indexes are considered this run

    for (const s of stmts) {
      try {
        console.log("[ensureSchema]", s.replace(/\s+/g, " ").slice(0, 70));
        await conn.query(s);
      } catch (e) {
        console.error("[ensureSchema] statement skipped:", e);
      }
    }

    // --- performance indexes on hot foreign-key / filter columns ---------------
    // Drizzle only creates PK/unique constraints; at scale (100s of members per
    // chapter, many chapters) these secondary indexes keep the hot paths — admin
    // filters, per-member lookups, event rosters, governance tallies — fast.
    // MySQL has no CREATE INDEX IF NOT EXISTS, so each is guarded by a lookup
    // against information_schema.statistics.
    const [idxRows] = (await conn.query(
      `select table_name as t, index_name as i
         from information_schema.statistics where table_schema = database()`,
    )) as [Array<{ t: string; i: string }>, unknown];
    const haveIdx = new Set(idxRows.map((r) => `${r.t}.${r.i}`));

    const indexes: Array<[string, string, string]> = [
      // table, index name, column list
      ["members", "ix_members_tier_status", "tier, status"],
      ["members", "ix_members_status_score", "status, hiveScore"],
      ["members", "ix_members_home_chapter", "homeChapterId"],
      ["event_regs", "ix_eventregs_event_status", "eventId, status"],
      ["event_regs", "ix_eventregs_member", "memberId"],
      ["event_regs", "ix_eventregs_code", "checkinCode"],
      ["membership_events", "ix_membevents_member", "memberId"],
      ["membership_events", "ix_membevents_status", "status"],
      ["attendance", "ix_attendance_session", "sessionId"],
      ["attendance", "ix_attendance_member", "memberId"],
      ["pod_members", "ix_podmembers_pod", "podId"],
      ["pod_members", "ix_podmembers_member", "memberId"],
      ["sessions", "ix_sessions_pod_starts", "podId, startsAt"],
      ["notifications", "ix_notifications_member_read", "memberId, readAt"],
      ["score_events", "ix_scoreevents_member", "memberId"],
      ["leads", "ix_leads_status", "status"],
      ["leads", "ix_leads_created", "createdAt"],
      ["one_to_ones", "ix_o2o_a", "aMemberId"],
      ["one_to_ones", "ix_o2o_b", "bMemberId"],
      ["referrals", "ix_referrals_member", "memberId"],
      ["ballot_roll", "ix_ballotroll_election_member", "electionId, memberId"],
      ["motion_votes", "ix_motionvotes_motion_member", "motionId, memberId"],
      ["candidates", "ix_candidates_election", "electionId"],
      ["event_feedback", "ix_eventfb_event", "eventId"],
      ["applications", "ix_applications_user", "userId"],
      ["applications", "ix_applications_status", "status"],
      ["endorsements", "ix_endorsements_app", "appId"],
      ["gov_roles", "ix_govroles_body", "bodyId"],
      ["elections", "ix_elections_chapter", "chapterId"],
      ["motions", "ix_motions_chapter", "chapterId"],
      ["chapter_transfers", "ix_chtransfers_status", "status"],
      ["chapter_transfers", "ix_chtransfers_member", "memberId"],
    ];
    let added = 0;
    for (const [table, name, cols] of indexes) {
      if (!tables.has(table) || haveIdx.has(`${table}.${name}`)) continue;
      const ddl = `CREATE INDEX ${name} ON ${table} (${cols})`;
      try {
        console.log("[ensureSchema]", ddl);
        await conn.query(ddl);
        added++;
      } catch (e) {
        console.error("[ensureSchema] index skipped:", name, e);
      }
    }

    if (!stmts.length && !added) console.log("[ensureSchema] schema up to date");
  } finally {
    await conn.end();
  }
}
