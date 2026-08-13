#!/usr/bin/env tsx
/**
 * Production pre-deploy migration runner.
 *
 * Handles the one-time switch from `drizzle-kit push` to versioned
 * `drizzle-kit migrate`. If the database already contains tables (a previous
 * `db:push` deploy) but has no `__drizzle_migrations` journal, we baseline it by
 * recording the initial migration as already applied. Fresh databases are left
 * untouched so the migration runner creates the schema normally.
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const JOURNAL_PATH = "./db/migrations/meta/_journal.json";
const MIGRATIONS_FOLDER = "./db/migrations";

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
    const haveJournal = tables.some(r => r.t === "__drizzle_migrations");

    if (haveUsers && !haveJournal) {
      console.log(
        "[pre-deploy] existing database detected; baselining migrations"
      );
      const journal: Journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf-8"));
      const first = journal.entries[0];
      if (!first) throw new Error("No migrations found in journal");
      const hash = sha256(`${MIGRATIONS_FOLDER}/${first.tag}.sql`);

      await conn.query(`
        create table if not exists __drizzle_migrations (
          id serial primary key,
          hash text not null,
          created_at bigint
        )
      `);
      await conn.query(
        `insert into __drizzle_migrations (hash, created_at) values (?, ?)`,
        [hash, first.when]
      );
      console.log(`[pre-deploy] baselined ${first.tag}`);
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

main().catch(e => {
  console.error("[pre-deploy] failed:", e);
  process.exit(1);
});
