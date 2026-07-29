/**
 * In-process job scheduler (M8 · every timed SOP).
 *
 * The app runs as a single Node process, so timed operations run here rather
 * than in a separate worker. A daily pass ticks the engines that must fire on
 * their own — the manual's promise that "the platform carries the load".
 *
 * Idempotent + restart-safe: a per-day marker in app_config guards the daily
 * pass so a container restart can't double-run it, and each job only acts on
 * rows that still need acting on.
 */
import { eq, isNotNull } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import { evaluateDormancy, notify } from "../queries/circle";
import { renewalStage } from "@contracts/constants";

const DAILY_MARKER = "scheduler:lastDaily";

/** UTC calendar day, e.g. "2026-07-29". */
function todayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

async function getMarker(key: string): Promise<string | null> {
  const row = (await getDb().select().from(schema.appConfig).where(eq(schema.appConfig.key, key)).limit(1)).at(0);
  return row?.value ?? null;
}
async function setMarker(key: string, value: string): Promise<void> {
  await getDb().insert(schema.appConfig).values({ key, value })
    .onDuplicateKeyUpdate({ set: { value } });
}

/** Run one job, isolating failures so one bad job can't stop the rest. */
async function safe(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.error(`[scheduler] job "${name}" failed:`, e);
  }
}

/* ------------------------------- jobs ------------------------------- */

/** ML-04 — recompute the engagement/at-risk ladder for every active member. */
async function jobDormancy(): Promise<void> {
  const { evaluated, transitions } = await evaluateDormancy();
  if (transitions) console.log(`[scheduler] dormancy: ${transitions} transition(s) across ${evaluated} members`);
}

/**
 * ML-05 — open the renewal window and auto-lapse.
 * active → renewal when the window opens; active/renewal → lapsed past grace.
 * Only the CRM lifecycle is changed here; billing status is untouched.
 */
async function jobRenewal(now = new Date()): Promise<void> {
  const db = getDb();
  const rows = await db.select().from(schema.members).where(isNotNull(schema.members.renewalAt));
  let opened = 0, lapsed = 0;
  for (const m of rows) {
    if (!m.renewalAt) continue;
    const lc = (m as { lifecycleState?: string }).lifecycleState ?? "active";
    const stage = renewalStage(new Date(m.renewalAt), now);
    if (stage === "window" && lc === "active") {
      await db.update(schema.members).set({ lifecycleState: "renewal" }).where(eq(schema.members.id, m.id));
      await notify(m.id, "Your renewal window is open — here's your year in review. Renew to keep your membership and chapter access.", "renewal");
      opened++;
    } else if (stage === "lapse" && (lc === "renewal" || lc === "active")) {
      await db.update(schema.members).set({ lifecycleState: "lapsed" }).where(eq(schema.members.id, m.id));
      await notify(m.id, "Your membership has lapsed. You can renew any time to rejoin your chapter — your history is preserved.", "renewal");
      lapsed++;
    }
  }
  if (opened || lapsed) console.log(`[scheduler] renewal: ${opened} window(s) opened, ${lapsed} lapsed`);
}

/** Run all daily jobs at most once per UTC day. */
export async function runDailyJobs(now = new Date()): Promise<boolean> {
  const today = todayKey(now);
  if (await getMarker(DAILY_MARKER) === today) return false; // already ran today
  await safe("dormancy", () => jobDormancy());
  await safe("renewal", () => jobRenewal(now));
  await setMarker(DAILY_MARKER, today);
  console.log(`[scheduler] daily pass complete for ${today}`);
  return true;
}

let started = false;
/** Start the hourly tick (idempotent). The daily guard makes the cadence safe
 *  even though we check every hour. */
export function startScheduler(): void {
  if (started) return;
  started = true;
  const tick = () => { void runDailyJobs().catch((e) => console.error("[scheduler] tick failed:", e)); };
  // Give the server a moment to finish booting, then check hourly.
  setTimeout(tick, 30_000);
  setInterval(tick, 60 * 60 * 1000);
  console.log("[scheduler] started (hourly tick, daily pass)");
}
