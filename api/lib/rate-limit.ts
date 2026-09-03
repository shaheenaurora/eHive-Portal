/* Rate limiter backed by MySQL so per-IP/account limits are shared across all
   app replicas. Falls back to an in-memory map if the database is unreachable,
   so a transient DB issue does not open the floodgates. */

import { eq, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import * as schema from "@db/schema";
import { env } from "./env";
import { logger } from "./log";

type Bucket = { count: number; resetAt: number };
const memoryStore = new Map<string, Bucket>();

function memoryRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = memoryStore.get(key);
  if (!b || now > b.resetAt) {
    memoryStore.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= max) return false;
  b.count++;
  return true;
}

/** Returns true if the action is allowed, false if the caller is over the limit.
 *  `key` scopes the window (e.g. `login:<ip>` or `login:<email>`).
 *  In production the limiter fails closed (denies the request) when the
 *  database is unreachable, because an in-process fallback is per-replica and
 *  can be bypassed in a multi-instance deployment. */
export async function rateLimit(
  key: string,
  max: number,
  windowMs: number
): Promise<boolean> {
  const now = Date.now();
  const resetAt = now + windowMs;
  try {
    // Run the increment and the read inside one transaction so the count we
    // check is the one we just wrote, not a stale value from another replica.
    const rows = await getDb().transaction(async tx => {
      await tx
        .insert(schema.rateLimits)
        .values({ key, count: 1, resetAt })
        .onDuplicateKeyUpdate({
          set: {
            count: sql`CASE WHEN ${schema.rateLimits.resetAt} < ${now} THEN 1 ELSE ${schema.rateLimits.count} + 1 END`,
            resetAt: sql`CASE WHEN ${schema.rateLimits.resetAt} < ${now} THEN ${resetAt} ELSE ${schema.rateLimits.resetAt} END`,
          },
        });
      return tx
        .select({ count: schema.rateLimits.count })
        .from(schema.rateLimits)
        .where(eq(schema.rateLimits.key, key))
        .limit(1);
    });
    return (rows[0]?.count ?? 0) <= max;
  } catch (err) {
    logger.error("rate limit db error", { error: err });
    if (env.isProduction) return false;
    return memoryRateLimit(key, max, windowMs);
  }
}

/** Clear a key's window (e.g. after a successful login). */
export async function rateLimitReset(key: string): Promise<void> {
  memoryStore.delete(key);
  try {
    await getDb()
      .delete(schema.rateLimits)
      .where(eq(schema.rateLimits.key, key));
  } catch (err) {
    logger.error("rate limit reset db error", { error: err });
  }
}

// Opportunistic cleanup so the in-memory fallback map can't grow unbounded.
setInterval(
  () => {
    const now = Date.now();
    for (const [k, b] of memoryStore)
      if (now > b.resetAt) memoryStore.delete(k);
  },
  10 * 60 * 1000
).unref?.();
