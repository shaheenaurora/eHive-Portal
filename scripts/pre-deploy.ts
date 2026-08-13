#!/usr/bin/env tsx
/**
 * Production pre-deploy migration runner.
 *
 * Handles the one-time switch from `drizzle-kit push` to versioned
 * `drizzle-kit migrate`. The old runtime `ensureSchema` already created the full
 * schema — every table AND every secondary index — for any existing database.
 * The initial migrations (0000 = tables, 0001 = those indexes) were generated
 * FROM that schema, so re-running them against a live database would fail on a
 * duplicate table/index. We therefore record the initial-snapshot migrations
 * (everything up to and including BASELINE_THROUGH_TAG) as already-applied for
 * any database that already has the schema, then let the migration runner apply
 * only genuinely-new migrations added afterwards.
 *
 * This reconciliation is idempotent and self-healing: it runs whenever the
 * schema exists (not just when the journal table is absent), so a database left
 * with a partial journal by an earlier failed deploy is repaired here. Fresh
 * databases (no `users` table) are left untouched so the runner builds the
 * schema normally, and migrations after BASELINE_THROUGH_TAG are never baselined
 * so future schema changes always apply.
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const JOURNAL_PATH = "./db/migrations/meta/_journal.json";
const MIGRATIONS_FOLDER = "./db/migrations";

/**
 * The last migration whose objects were already created by the pre-migration
 * runtime `ensureSchema`. Migrations up to and including this tag are the
 * initial snapshot and are baselined (recorded as applied) on an existing
 * database; anything after it is a genuine change and must run normally.
 */
const BASELINE_THROUGH_TAG = "0001_parched_spectrum";

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

/**
 * Pure selection of which journal entries to record as already-applied on an
 * existing database: every entry up to and including `throughTag` whose `when`
 * isn't already recorded. Returns them in journal order. Exported for testing.
 * Throws when `throughTag` isn't present so a misconfigured tag fails loudly
 * instead of silently baselining nothing (or everything).
 */
export function selectBaselineInserts(
  entries: JournalEntry[],
  throughTag: string,
  recordedWhens: ReadonlySet<string>
): JournalEntry[] {
  if (entries.length === 0) throw new Error("No migrations found in journal");
  const throughIdx = entries.findIndex(e => e.tag === throughTag);
  if (throughIdx === -1)
    throw new Error(
      `Baseline tag ${throughTag} not found in migration journal`
    );
  return entries
    .slice(0, throughIdx + 1)
    .filter(e => !recordedWhens.has(String(e.when)));
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function main() {
  const uri = process.env.DATABASE_URL;
  if (!uri) {
    throw new Error("DATABASE_URL is required");
  }

  const conn = await mysql.createConnection({
    uri,
    ssl:
      process.env.DATABASE_SSL === "true"
        ? { minVersion: "TLSv1.2" }
        : undefined,
  });
  try {
    const dbName = (await conn.query("select database() as db")) as [
      { db: string }[],
      unknown,
    ];
    const database = dbName[0][0]?.db;
    if (!database) throw new Error("DATABASE_URL does not select a database");

    const [tables] = (await conn.query(
      `select table_name as t
         from information_schema.tables
         where table_schema = ?
           and table_name in ('users', '__drizzle_migrations')`,
      [database]
    )) as [{ t: string }[], unknown];
    const haveUsers = tables.some(r => r.t === "users");

    // An existing database already has the full schema (created by the old
    // runtime ensureSchema). Reconcile the migrations journal so the initial-
    // snapshot migrations are recorded as applied. This runs regardless of
    // whether the journal table already exists, so a partial journal left by an
    // earlier failed deploy is repaired rather than blocking baselining.
    if (haveUsers) {
      const journal: Journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf-8"));

      await conn.query(`
        create table if not exists __drizzle_migrations (
          id serial primary key,
          hash text not null,
          created_at bigint
        )
      `);

      // Only insert baseline rows that aren't already recorded, so this is a
      // no-op once the database has been baselined (or has genuinely migrated).
      const [recordedRows] = (await conn.query(
        `select created_at as c from __drizzle_migrations`
      )) as [{ c: number | string }[], unknown];
      const recorded = new Set(recordedRows.map(r => String(r.c)));

      const toInsert = selectBaselineInserts(
        journal.entries,
        BASELINE_THROUGH_TAG,
        recorded
      );
      for (const entry of toInsert) {
        const hash = sha256(`${MIGRATIONS_FOLDER}/${entry.tag}.sql`);
        await conn.query(
          `insert into __drizzle_migrations (hash, created_at) values (?, ?)`,
          [hash, entry.when]
        );
        console.log(`[pre-deploy] baselined ${entry.tag}`);
      }
    }
  } finally {
    await conn.end();
  }

  console.log("[pre-deploy] running migrations");
  const migrationConn = await mysql.createConnection({
    uri,
    ssl:
      process.env.DATABASE_SSL === "true"
        ? { minVersion: "TLSv1.2" }
        : undefined,
    multipleStatements: true,
  });
  try {
    const db = drizzle(migrationConn);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await migrationConn.end();
  }
  console.log("[pre-deploy] migrations complete");
}

// Run only when executed directly (node dist/pre-deploy.js), not when imported
// by a test — keeps importing the pure helpers free of DB side effects.
const isDirectRun =
  process.argv[1] !== undefined &&
  process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch(e => {
    console.error("[pre-deploy] failed:", e);
    process.exit(1);
  });
}
