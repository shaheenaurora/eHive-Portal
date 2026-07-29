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
import { and, eq, isNotNull } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import { evaluateDormancy, notify } from "../queries/circle";
import { computeOnboarding } from "../queries/onboarding";
import { listCadences } from "../queries/cadence";
import { computeChapterHealth } from "../queries/health";
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

/**
 * ML-03 — nudge members whose onboarding milestones have slipped past their
 * 30/60/90-day target. A per-member+stage marker means each slip is flagged
 * once, not every day.
 */
async function jobOnboardingSlip(): Promise<void> {
  const db = getDb();
  const members = await db.select().from(schema.members).where(eq(schema.members.lifecycleState, "onboarding"));
  let flagged = 0;
  for (const m of members) {
    const prog = await computeOnboarding(m);
    if (prog.complete) continue;
    const overdueStage = prog.dayCount > 90 ? 3 : prog.dayCount > 60 ? 2 : prog.dayCount > 30 ? 1 : 0;
    if (overdueStage === 0) continue;
    const behind = prog.milestones.some((ms) => ms.stage <= overdueStage && !ms.done);
    if (!behind) continue;
    const markerKey = `onbslip:${m.id}`;
    if (await getMarker(markerKey) === String(overdueStage)) continue; // already flagged this stage
    await notify(m.id, "A couple of your onboarding steps are still open past their target — let's get you fully set up. Open your dashboard to finish them.", "onboarding");
    await setMarker(markerKey, String(overdueStage));
    flagged++;
  }
  if (flagged) console.log(`[scheduler] onboarding-slip: ${flagged} member(s) nudged`);
}

/**
 * CH cadences — remind a chapter's officers when a cadence period is still
 * unlogged (due). One reminder per cadence per period.
 */
async function jobCadenceReminders(now = new Date()): Promise<void> {
  const db = getDb();
  const chapters = await db.select({ id: schema.chapters.id }).from(schema.chapters);
  let sent = 0;
  for (const ch of chapters) {
    const officers = await db.select({ memberId: schema.chapterRoles.memberId }).from(schema.chapterRoles)
      .where(and(eq(schema.chapterRoles.chapterId, ch.id), eq(schema.chapterRoles.status, "active")));
    if (!officers.length) continue;
    const { cadences } = await listCadences(ch.id, now);
    for (const c of cadences) {
      if (c.currentStatus !== "open") continue; // already logged this period
      const markerKey = `cadence:${c.id}:${c.currentKey}`;
      if (await getMarker(markerKey)) continue;
      for (const o of officers) {
        await notify(o.memberId, `Reminder: "${c.title}" is due this period. Log it on the chapter page once it's done.`, "cadence");
      }
      await setMarker(markerKey, "sent");
      sent++;
    }
  }
  if (sent) console.log(`[scheduler] cadence reminders: ${sent} cadence(s) nudged`);
}

/**
 * XC-03 — retire chapter-officer terms on schedule. A role whose term-end date
 * has passed is ended (access transfers "not before, not after"), and the
 * outgoing officer is thanked and pointed at the handover checklist.
 */
async function jobRoleTerms(now = new Date()): Promise<void> {
  const db = getDb();
  const roles = await db.select().from(schema.chapterRoles)
    .where(and(eq(schema.chapterRoles.status, "active"), isNotNull(schema.chapterRoles.termEnd)));
  let ended = 0;
  for (const r of roles) {
    if (!r.termEnd || new Date(r.termEnd) > now) continue;
    await db.update(schema.chapterRoles).set({ status: "ended" }).where(eq(schema.chapterRoles.id, r.id));
    await notify(r.memberId, "Your term as a chapter officer has ended — thank you for serving. Please complete the handover with the incoming officer.", "governance");
    ended++;
  }
  if (ended) console.log(`[scheduler] role terms: ${ended} ended`);
}

/**
 * CH-06 — when a chapter's health index drops below the healthy line, alert its
 * officers with a remediation prompt. Fires once on the transition into
 * "below" (and re-arms once it recovers), so it doesn't repeat daily.
 */
async function jobHealthThreshold(): Promise<void> {
  const db = getDb();
  const chapters = await db.select({ id: schema.chapters.id, name: schema.chapters.name }).from(schema.chapters);
  let alerted = 0;
  for (const ch of chapters) {
    let total: number, below: boolean;
    try { const h = await computeChapterHealth(ch.id); total = h.total; below = h.band === "below"; }
    catch { continue; }
    const markerKey = `health:${ch.id}`;
    const state = below ? "below" : "ok";
    if (await getMarker(markerKey) === state) continue; // no change since last pass
    if (below) {
      const officers = await db.select({ memberId: schema.chapterRoles.memberId }).from(schema.chapterRoles)
        .where(and(eq(schema.chapterRoles.chapterId, ch.id), eq(schema.chapterRoles.status, "active")));
      for (const o of officers) {
        await notify(o.memberId, `Chapter health for ${ch.name} has dropped below the healthy line (index ${total}). Time for a health review and a remediation plan.`, "health");
      }
      alerted++;
    }
    await setMarker(markerKey, state);
  }
  if (alerted) console.log(`[scheduler] health threshold: ${alerted} chapter(s) alerted`);
}

/** Run all daily jobs at most once per UTC day. */
export async function runDailyJobs(now = new Date()): Promise<boolean> {
  const today = todayKey(now);
  if (await getMarker(DAILY_MARKER) === today) return false; // already ran today
  await safe("dormancy", () => jobDormancy());
  await safe("renewal", () => jobRenewal(now));
  await safe("onboarding-slip", () => jobOnboardingSlip());
  await safe("cadence-reminders", () => jobCadenceReminders(now));
  await safe("role-terms", () => jobRoleTerms(now));
  await safe("health-threshold", () => jobHealthThreshold());
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
