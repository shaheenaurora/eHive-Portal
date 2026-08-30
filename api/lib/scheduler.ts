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
import { and, eq, isNotNull, isNull, lte, ne } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import { evaluateDormancy, notify } from "../queries/circle";
import { computeOnboarding } from "../queries/onboarding";
import { listCadences } from "../queries/cadence";
import { computeChapterHealth } from "../queries/health";
import { renewalStage } from "@contracts/constants";
import { tryLifecycleTransition } from "./lifecycle";
import { sendScorecardFollowUp } from "./lead-mail";
import { buildScorecardReport } from "../../src/lib/scorecard";
import { logger } from "./log";

const DAILY_MARKER = "scheduler:lastDaily";

type SchedulerStatus = {
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  failures: number;
};
const schedulerStatus: SchedulerStatus = {
  lastRunAt: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  failures: 0,
};
export function getSchedulerStatus(): SchedulerStatus {
  return { ...schedulerStatus };
}

/** UTC calendar day, e.g. "2026-07-29". */
function todayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

async function getMarker(key: string): Promise<string | null> {
  const row = (
    await getDb()
      .select()
      .from(schema.appConfig)
      .where(eq(schema.appConfig.key, key))
      .limit(1)
  ).at(0);
  return row?.value ?? null;
}
async function setMarker(key: string, value: string): Promise<void> {
  await getDb()
    .insert(schema.appConfig)
    .values({ key, value })
    .onDuplicateKeyUpdate({ set: { value } });
}

/** Run one job, isolating failures so one bad job can't stop the rest. */
async function safe(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    schedulerStatus.lastFailureAt = new Date().toISOString();
    schedulerStatus.failures++;
    logger.error(`scheduler job "${name}" failed`, { job: name, error: String(e) });
  }
}

/* ------------------------------- jobs ------------------------------- */

/** ML-04 — recompute the engagement/at-risk ladder for every active member. */
async function jobDormancy(): Promise<void> {
  const { evaluated, transitions } = await evaluateDormancy();
  if (transitions)
    logger.info(`scheduler dormancy: ${transitions} transition(s) across ${evaluated} members`, {
      transitions,
      evaluated,
    });
}

/**
 * ML-05 — open the renewal window and auto-lapse.
 * active → renewal when the window opens; active/renewal → lapsed past grace.
 * Only the CRM lifecycle is changed here; billing status is untouched.
 */
async function jobRenewal(now = new Date()): Promise<void> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.members)
    .where(isNotNull(schema.members.renewalAt));
  let opened = 0,
    lapsed = 0;
  for (const m of rows) {
    if (!m.renewalAt) continue;
    const lc = (m as { lifecycleState?: string }).lifecycleState ?? "active";
    const stage = renewalStage(new Date(m.renewalAt), now);
    if (stage === "window" && lc === "active") {
      const r = await tryLifecycleTransition(m.id, "renewal", {
        reason: "Renewal window opened",
        audit: false,
      });
      if (r.ok) {
        await notify(
          m.id,
          "Your renewal window is open — here's your year in review. Renew to keep your membership and chapter access.",
          "renewal"
        );
        opened++;
      } else {
        logger.info(`scheduler renewal window skipped: ${r.reason}`, { memberId: m.id, reason: r.reason });
      }
    } else if (stage === "lapse" && (lc === "renewal" || lc === "active")) {
      const r = await tryLifecycleTransition(m.id, "lapsed", {
        reason: "Renewal window closed without payment",
        audit: false,
      });
      if (r.ok) {
        await notify(
          m.id,
          "Your membership has lapsed. You can renew any time to rejoin your chapter — your history is preserved.",
          "renewal"
        );
        lapsed++;
      } else {
        logger.info(`scheduler lapse skipped: ${r.reason}`, { memberId: m.id, reason: r.reason });
      }
    }
  }
  if (opened || lapsed)
    logger.info(`scheduler renewal: ${opened} window(s) opened, ${lapsed} lapsed`, {
      opened,
      lapsed,
    });
}

/**
 * ML-03 — nudge members whose onboarding milestones have slipped past their
 * 30/60/90-day target. A per-member+stage marker means each slip is flagged
 * once, not every day.
 */
async function jobOnboardingSlip(): Promise<void> {
  const db = getDb();
  const members = await db
    .select()
    .from(schema.members)
    .where(eq(schema.members.lifecycleState, "onboarding"));
  let flagged = 0;
  for (const m of members) {
    const prog = await computeOnboarding(m);
    if (prog.complete) continue;
    const overdueStage =
      prog.dayCount > 90
        ? 3
        : prog.dayCount > 60
          ? 2
          : prog.dayCount > 30
            ? 1
            : 0;
    if (overdueStage === 0) continue;
    const behind = prog.milestones.some(
      ms => ms.stage <= overdueStage && !ms.done
    );
    if (!behind) continue;
    const markerKey = `onbslip:${m.id}`;
    if ((await getMarker(markerKey)) === String(overdueStage)) continue; // already flagged this stage
    await notify(
      m.id,
      "A couple of your onboarding steps are still open past their target — let's get you fully set up. Open your dashboard to finish them.",
      "onboarding"
    );
    await setMarker(markerKey, String(overdueStage));
    flagged++;
  }
  if (flagged)
    logger.info(`scheduler onboarding-slip: ${flagged} member(s) nudged`, { flagged });
}

/**
 * CH cadences — remind a chapter's officers when a cadence period is still
 * unlogged (due). One reminder per cadence per period.
 */
async function jobCadenceReminders(now = new Date()): Promise<void> {
  const db = getDb();
  const chapters = await db
    .select({ id: schema.chapters.id })
    .from(schema.chapters)
    .where(isNull(schema.chapters.deletedAt));
  let sent = 0;
  for (const ch of chapters) {
    const officers = await db
      .select({ memberId: schema.chapterRoles.memberId })
      .from(schema.chapterRoles)
      .where(
        and(
          eq(schema.chapterRoles.chapterId, ch.id),
          eq(schema.chapterRoles.status, "active")
        )
      );
    if (!officers.length) continue;
    const { cadences } = await listCadences(ch.id, now);
    for (const c of cadences) {
      if (c.currentStatus !== "open") continue; // already logged this period
      const markerKey = `cadence:${c.id}:${c.currentKey}`;
      if (await getMarker(markerKey)) continue;
      for (const o of officers) {
        await notify(
          o.memberId,
          `Reminder: "${c.title}" is due this period. Log it on the chapter page once it's done.`,
          "cadence"
        );
      }
      await setMarker(markerKey, "sent");
      sent++;
    }
  }
  if (sent)
    logger.info(`scheduler cadence reminders: ${sent} cadence(s) nudged`, { sent });
}

/**
 * XC-03 — retire chapter-officer terms on schedule. A role whose term-end date
 * has passed is ended (access transfers "not before, not after"), and the
 * outgoing officer is thanked and pointed at the handover checklist.
 */
async function jobRoleTerms(now = new Date()): Promise<void> {
  const db = getDb();
  const roles = await db
    .select()
    .from(schema.chapterRoles)
    .where(
      and(
        eq(schema.chapterRoles.status, "active"),
        isNotNull(schema.chapterRoles.termEnd)
      )
    );
  let ended = 0;
  for (const r of roles) {
    if (!r.termEnd || new Date(r.termEnd) > now) continue;
    await db
      .update(schema.chapterRoles)
      .set({ status: "ended" })
      .where(eq(schema.chapterRoles.id, r.id));
    await notify(
      r.memberId,
      "Your term as a chapter officer has ended — thank you for serving. Please complete the handover with the incoming officer.",
      "governance"
    );
    ended++;
  }
  if (ended) logger.info(`scheduler role terms: ${ended} ended`, { ended });
}

/**
 * CH-06 — when a chapter's health index drops below the healthy line, alert its
 * officers with a remediation prompt. Fires once on the transition into
 * "below" (and re-arms once it recovers), so it doesn't repeat daily.
 */
async function jobHealthThreshold(): Promise<void> {
  const db = getDb();
  const chapters = await db
    .select({ id: schema.chapters.id, name: schema.chapters.name })
    .from(schema.chapters)
    .where(isNull(schema.chapters.deletedAt));
  let alerted = 0;
  for (const ch of chapters) {
    let total: number, below: boolean;
    try {
      const h = await computeChapterHealth(ch.id);
      total = h.total;
      below = h.band === "below";
    } catch {
      continue;
    }
    const markerKey = `health:${ch.id}`;
    const state = below ? "below" : "ok";
    if ((await getMarker(markerKey)) === state) continue; // no change since last pass
    if (below) {
      const officers = await db
        .select({ memberId: schema.chapterRoles.memberId })
        .from(schema.chapterRoles)
        .where(
          and(
            eq(schema.chapterRoles.chapterId, ch.id),
            eq(schema.chapterRoles.status, "active")
          )
        );
      for (const o of officers) {
        await notify(
          o.memberId,
          `Chapter health for ${ch.name} has dropped below the healthy line (index ${total}). Time for a health review and a remediation plan.`,
          "health"
        );
      }
      alerted++;
    }
    await setMarker(markerKey, state);
  }
  if (alerted)
    logger.info(`scheduler health threshold: ${alerted} chapter(s) alerted`, { alerted });
}

/**
 * Dunning — nudge members with a still-pending membership payment. A payment
 * that's sat "pending" for 3+ days gets a reminder, then a follow-up every 7
 * days, up to 3 nudges total (a per-payment marker counts them) so we recover
 * revenue without hounding anyone.
 */
async function jobDunning(now = new Date()): Promise<void> {
  const db = getDb();
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const pending = await db
    .select({
      id: schema.paymentRecords.id,
      userId: schema.paymentRecords.userId,
      createdAt: schema.paymentRecords.createdAt,
    })
    .from(schema.paymentRecords)
    .where(
      and(
        eq(schema.paymentRecords.status, "pending"),
        lte(schema.paymentRecords.createdAt, threeDaysAgo)
      )
    );
  let nudged = 0;
  for (const p of pending) {
    const markerKey = `dunning:${p.id}`;
    const marker = await getMarker(markerKey); // "count:lastIso" or null
    const [countStr, lastIso] = (marker ?? "").split("|");
    const count = Number(countStr) || 0;
    if (count >= 3) continue; // enough reminders sent
    if (lastIso) {
      const daysSince =
        (now.getTime() - new Date(lastIso).getTime()) / (24 * 60 * 60 * 1000);
      if (daysSince < 7) continue; // not due for the next nudge yet
    }
    const member = (
      await db
        .select({ id: schema.members.id })
        .from(schema.members)
        .where(eq(schema.members.userId, p.userId))
        .limit(1)
    ).at(0);
    if (!member) continue;
    await notify(
      member.id,
      "You have a membership payment still pending. Complete it from your Membership page to keep your access active.",
      "membership"
    );
    await setMarker(markerKey, `${count + 1}|${now.toISOString()}`);
    nudged++;
  }
  if (nudged) logger.info(`scheduler dunning: ${nudged} reminder(s) sent`, { nudged });
}

/**
 * Scorecard nurture — send a personalised follow-up to clarity-scorecard leads
 * at day 3 and day 10. Only sends once per lead per stage.
 */
async function jobScorecardFollowUp(now = new Date()): Promise<void> {
  const db = getDb();
  const day3 = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const day10 = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
  const leads = await db
    .select()
    .from(schema.leads)
    .where(
      and(
        eq(schema.leads.form, "clarity-scorecard"),
        isNotNull(schema.leads.email),
        lte(schema.leads.createdAt, day3)
      )
    );
  let sent = 0;
  for (const l of leads) {
    if (!l.email) continue;
    const ageDays = Math.floor(
      (now.getTime() - new Date(l.createdAt).getTime()) /
        (24 * 60 * 60 * 1000)
    );
    const stage = ageDays >= 10 ? "follow_up_2" : "follow_up_1";
    const markerKey = `scorecard-followup:${l.id}:${stage}`;
    if (await getMarker(markerKey)) continue;
    const payload = (() => {
      try {
        return JSON.parse(l.payload ?? "{}");
      } catch {
        return {};
      }
    })();
    const report = buildScorecardReport(payload);
    if (!report) continue;
    const r = await sendScorecardFollowUp({
      email: l.email,
      name: typeof payload.name === "string" ? payload.name : null,
      total: report.total,
      recommendationProduct: report.recommendation.product,
      recommendationWhy: report.recommendation.why,
      stage,
    });
    if (r.ok) {
      await setMarker(markerKey, now.toISOString());
      sent++;
    } else {
      logger.warn(`scheduler scorecard follow-up failed for lead ${l.id}`, { leadId: l.id, error: r.error });
    }
  }
  if (sent) logger.info(`scheduler scorecard follow-up: ${sent} email(s) sent`, { sent });
}

/** Run all daily jobs at most once per UTC day. */
/**
 * Atomically claim today's daily pass for THIS process. A single conditional
 * UPDATE (a per-row lock in MySQL) means exactly one replica wins even if
 * several tick at the same instant — a distributed guard that works with a
 * pooled connection, unlike a connection-scoped GET_LOCK. Returns true only for
 * the winner; everyone else (and re-ticks the same day) gets false.
 */
async function claimDailyPass(today: string): Promise<boolean> {
  const db = getDb();
  // Ensure the marker row exists without disturbing an existing value.
  await db
    .insert(schema.appConfig)
    .values({ key: DAILY_MARKER, value: "" })
    .onDuplicateKeyUpdate({ set: { key: DAILY_MARKER } });
  const res = await db
    .update(schema.appConfig)
    .set({ value: today })
    .where(
      and(
        eq(schema.appConfig.key, DAILY_MARKER),
        ne(schema.appConfig.value, today)
      )
    );
  const affected =
    (res as unknown as { affectedRows?: number }).affectedRows ??
    (res as unknown as [{ affectedRows?: number }])[0]?.affectedRows ??
    0;
  return affected === 1;
}

export async function runDailyJobs(now = new Date()): Promise<boolean> {
  const today = todayKey(now);
  schedulerStatus.lastRunAt = now.toISOString();
  // Distributed guard: only the replica that atomically claims today runs.
  if (!(await claimDailyPass(today))) return false;
  await safe("dormancy", () => jobDormancy());
  await safe("renewal", () => jobRenewal(now));
  await safe("dunning", () => jobDunning(now));
  await safe("onboarding-slip", () => jobOnboardingSlip());
  await safe("cadence-reminders", () => jobCadenceReminders(now));
  await safe("role-terms", () => jobRoleTerms(now));
  await safe("health-threshold", () => jobHealthThreshold());
  await safe("scorecard-follow-up", () => jobScorecardFollowUp(now));
  await safe("kpi-snapshots", async () => {
    const { captureKpiSnapshots } = await import("../queries/kpi-snapshots");
    await captureKpiSnapshots(now);
  });
  await safe("kpi-alerts", async () => {
    const { evaluateKpiAlerts } = await import("../queries/kpi-alerts");
    await evaluateKpiAlerts();
  });
  // The marker was already set to `today` by claimDailyPass (the claim IS the
  // guard), so there's nothing more to write here.
  schedulerStatus.lastSuccessAt = new Date().toISOString();
  logger.info(`scheduler daily pass complete for ${today}`, { today });
  return true;
}

let started = false;
let bootTimer: ReturnType<typeof setTimeout> | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
/** Start the hourly tick (idempotent). The daily guard makes the cadence safe
 *  even though we check every hour. */
export function startScheduler(): void {
  if (started) return;
  started = true;
  const tick = () => {
    void runDailyJobs().catch(e => {
      schedulerStatus.lastFailureAt = new Date().toISOString();
      schedulerStatus.failures++;
      logger.error("scheduler tick failed", { error: String(e) });
    });
  };
  // Give the server a moment to finish booting, then check hourly.
  bootTimer = setTimeout(tick, 30_000);
  tickTimer = setInterval(tick, 60 * 60 * 1000);
  logger.info("scheduler started (hourly tick, daily pass)");
}

/** Stop the scheduler's timers so the process can exit cleanly on shutdown. */
export function stopScheduler(): void {
  if (bootTimer) clearTimeout(bootTimer);
  if (tickTimer) clearInterval(tickTimer);
  bootTimer = null;
  tickTimer = null;
  started = false;
}
