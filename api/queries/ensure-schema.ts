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

    // --- members: lifecycle state machine (M1) ---
    if (tables.has("members") && !cols.has("members.lifecycleState")) {
      stmts.push(
        "ALTER TABLE members ADD COLUMN lifecycleState enum('prospect','guest','applicant','onboarding','active','at_risk','renewal','lapsed','alumni','suspended') NOT NULL DEFAULT 'active'",
      );
      // One-time backfill from existing status/dormancy so the CRM board is
      // populated the moment the column exists.
      stmts.push(
        "UPDATE members SET lifecycleState = CASE " +
          "WHEN status = 'cancelled' THEN 'alumni' " +
          "WHEN status = 'paused' THEN 'at_risk' " +
          "WHEN dormancyStage IN ('at_risk','dormant','non_renewal') THEN 'at_risk' " +
          "ELSE 'active' END",
      );
    }

    // --- members: POD profile (PD-01 matching) ---
    if (tables.has("members")) {
      for (const [col, def] of [["sector", "varchar(128) NULL"], ["stage", "varchar(64) NULL"], ["goals", "varchar(500) NULL"]] as Array<[string, string]>)
        if (!cols.has(`members.${col}`)) stmts.push(`ALTER TABLE members ADD COLUMN ${col} ${def}`);
    }
    // --- pod_members: confidentiality gate (PD-03) ---
    if (tables.has("pod_members") && !cols.has("pod_members.confidentialityAt"))
      stmts.push("ALTER TABLE pod_members ADD COLUMN confidentialityAt timestamp NULL");

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
      `CREATE TABLE IF NOT EXISTS chapter_roles (
        id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
        chapterId bigint unsigned NOT NULL,
        memberId bigint unsigned NOT NULL,
        role varchar(64) NOT NULL,
        title varchar(128) NULL,
        responsibilities text NULL,
        electionId bigint unsigned NULL,
        termStart timestamp NULL,
        termEnd timestamp NULL,
        status enum('active','ended') NOT NULL DEFAULT 'active',
        appointedBy varchar(320) NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    );
    stmts.push(
      `CREATE TABLE IF NOT EXISTS chapter_posts (
        id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
        chapterId bigint unsigned NOT NULL,
        authorMemberId bigint unsigned NOT NULL,
        title varchar(255) NOT NULL,
        body text NULL,
        url varchar(512) NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    );
    stmts.push(
      `CREATE TABLE IF NOT EXISTS health_snapshots (
        id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
        chapterId bigint unsigned NOT NULL,
        total int NOT NULL,
        retention int NOT NULL,
        engagement int NOT NULL,
        growth int NOT NULL,
        programme int NOT NULL,
        leadership int NOT NULL,
        governance int NOT NULL,
        memberCount int NOT NULL DEFAULT 0,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    );
    stmts.push(
      `CREATE TABLE IF NOT EXISTS onboarding_milestones (
        id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
        memberId bigint unsigned NOT NULL,
        milestone varchar(48) NOT NULL,
        note varchar(500) NULL,
        completedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    );
    tables.add("chapter_transfers"); // so its indexes are considered this run
    tables.add("chapter_roles");
    tables.add("chapter_posts");
    stmts.push(
      `CREATE TABLE IF NOT EXISTS cadences (
        id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
        chapterId bigint unsigned NOT NULL,
        type varchar(48) NOT NULL,
        title varchar(128) NOT NULL,
        frequency varchar(16) NOT NULL,
        ownerRole varchar(48) NULL,
        sop varchar(16) NULL,
        active int NOT NULL DEFAULT 1,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS cadence_log (
        id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
        cadenceId bigint unsigned NOT NULL,
        periodKey varchar(16) NOT NULL,
        status enum('kept','rescheduled','missed') NOT NULL,
        note varchar(500) NULL,
        actorMemberId bigint unsigned NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      // M3 — chapter & board meetings + attendance.
      `CREATE TABLE IF NOT EXISTS meetings (
        id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
        chapterId bigint unsigned NOT NULL,
        kind enum('chapter_meeting','board_meeting','huddle','other') NOT NULL DEFAULT 'chapter_meeting',
        title varchar(255) NOT NULL,
        scheduledAt timestamp NULL,
        status enum('scheduled','held','cancelled') NOT NULL DEFAULT 'scheduled',
        agenda text NULL,
        minutes text NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS meeting_attendance (
        id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
        meetingId bigint unsigned NOT NULL,
        memberId bigint unsigned NOT NULL,
        status enum('present','absent','excused') NOT NULL DEFAULT 'present'
      )`,
      // ML-01 — top-of-funnel prospects/guests.
      `CREATE TABLE IF NOT EXISTS prospects (
        id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name varchar(255) NOT NULL,
        email varchar(320) NULL,
        phone varchar(40) NULL,
        company varchar(255) NULL,
        chapterId bigint unsigned NULL,
        stage enum('prospect','guest','invited','converted','declined') NOT NULL DEFAULT 'prospect',
        source varchar(120) NULL,
        notes text NULL,
        ownerUserId bigint unsigned NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      // XC-04 — conduct & incident cases.
      `CREATE TABLE IF NOT EXISTS conduct_cases (
        id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
        reporterMemberId bigint unsigned NULL,
        subjectMemberId bigint unsigned NULL,
        chapterId bigint unsigned NULL,
        category varchar(64) NOT NULL,
        severity enum('low','moderate','high','safeguarding') NOT NULL DEFAULT 'moderate',
        status enum('open','reviewing','actioned','escalated','closed') NOT NULL DEFAULT 'open',
        summary varchar(255) NOT NULL,
        detail text NULL,
        handledByUserId bigint unsigned NULL,
        resolution text NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    );
    tables.add("health_snapshots");
    tables.add("onboarding_milestones");
    tables.add("cadences");
    tables.add("cadence_log");
    tables.add("conduct_cases");
    tables.add("prospects");

    // --- chapter_budgets: spend-approval trail (AF-02) ---
    if (tables.has("chapter_budgets")) {
      if (!cols.has("chapter_budgets.approvedByUserId"))
        stmts.push("ALTER TABLE chapter_budgets ADD COLUMN approvedByUserId bigint unsigned NULL");
      if (!cols.has("chapter_budgets.note"))
        stmts.push("ALTER TABLE chapter_budgets ADD COLUMN note text NULL");
      if (!cols.has("chapter_budgets.decidedAt"))
        stmts.push("ALTER TABLE chapter_budgets ADD COLUMN decidedAt timestamp NULL");
    }

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
      ["members", "ix_members_lifecycle", "lifecycleState"],
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
      ["chapter_roles", "ix_chroles_chapter_status", "chapterId, status"],
      ["chapter_roles", "ix_chroles_member", "memberId"],
      ["chapter_posts", "ix_chposts_chapter", "chapterId"],
      ["health_snapshots", "ix_health_chapter", "chapterId, createdAt"],
      ["onboarding_milestones", "ix_onboarding_member", "memberId"],
      ["cadences", "ix_cadences_chapter", "chapterId"],
      ["cadence_log", "ix_cadencelog_cadence_period", "cadenceId, periodKey"],
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
