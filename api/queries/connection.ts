import { drizzle } from "drizzle-orm/mysql2";
import { createPool } from "mysql2";
import { env } from "../lib/env";
import * as schema from "@db/schema";

let instance: ReturnType<typeof drizzle<typeof schema>>;
let activePool: ReturnType<typeof createPool> | null = null;

export function getDb() {
  if (!instance) {
    const pool = createPool({
      uri: env.databaseUrl,
      // TLS is only needed for external managed databases. Railway's
      // private-network MySQL doesn't require it, so it's off unless the
      // provider needs it (set DATABASE_SSL=true, e.g. for PlanetScale/RDS).
      ssl:
        process.env.DATABASE_SSL === "true"
          ? { minVersion: "TLSv1.2" }
          : undefined,
      connectionLimit: Number(process.env.DB_POOL_SIZE) || 20,
      queueLimit: 0,
      waitForConnections: true,
      // Fail fast rather than hang forever when the DB is unreachable or the
      // pool is exhausted, and recycle idle sockets so a silently-dropped
      // connection (proxy/idle timeout) can't wedge the pool.
      connectTimeout: 10_000,
      idleTimeout: 60_000,
      maxIdle: 10,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10_000,
    });
    activePool = pool;
    instance = drizzle(pool, { schema, mode: "default" });
  }
  return instance;
}

/** Close the connection pool so the process can exit cleanly on shutdown. */
export async function closePool(): Promise<void> {
  if (!activePool) return;
  const pool = activePool;
  activePool = null;
  await pool.promise().end();
}
