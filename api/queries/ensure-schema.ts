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

    for (const s of stmts) {
      console.log("[ensureSchema]", s);
      await conn.query(s);
    }
    if (!stmts.length) console.log("[ensureSchema] schema up to date");
  } finally {
    await conn.end();
  }
}
