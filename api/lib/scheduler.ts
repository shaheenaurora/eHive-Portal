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
import { and, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
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
import {
  evaluateFranchiseReadiness,
  readinessScore,
} from "./franchise-readiness";
import { carryForwardBudgets } from "./budget-carry-forward";
import { audit } from "./audit";
import { retryEmailDelivery } from "./notify-mail";
import { paymentsEnabled, getPaymentProvider } from "./payments";
import { env } from "./env";
import { randomUUID } from "node:crypto";

/** System actor used for scheduler-driven audit rows. */
const SYSTEM_ACTOR = { id: 0, email: "system@ehive.global" };

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

/** Best-effort operational alert when a scheduled job fails. Posts to the
 *  configured webhook and/or Sentry so silent failures don't hide in logs. */
async function alertScheduler(job: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const payload = {
    source: "ehive-scheduler",
    job,
    error: message,
    time: new Date().toISOString(),
  };

  if (env.alertWebhookUrl) {
    try {
      await fetch(env.alertWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      /* alerting must not break the scheduler */
    }
  }

  if (env.sentryDsn) {
    try {
      const parsed = new URL(env.sentryDsn);
      const key = parsed.username;
      const projectId = parsed.pathname.replace(/^\//, "");
      if (key && projectId) {
        const event = {
          event_id: randomUUID().replace(/-/g, ""),
          timestamp: new Date().toISOString(),
          platform: "node",
          level: "error",
          message: `Scheduler job "${job}" failed: ${message}`,
          extra: payload,
        };
        await fetch(`https://${parsed.host}/api/${projectId}/store/`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Sentry-Auth": `Sentry sentry_version=7,sentry_client=ehive-scheduler/1.0,sentry_key=${key}`,
          },
          body: JSON.stringify(event),
        });
      }
    } catch {
      /* best-effort: don't crash if Sentry is unreachable */
    }
  }
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
    await alertScheduler(name, e);
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
    .where(
      and(
        isNotNull(schema.members.renewalAt),
        eq(schema.members.status, "active")
      )
    );
  let opened = 0,
    lapsed = 0;
  for (const m of rows) {
    if (!m.renewalAt) continue;
    const lc = (m as { lifecycleState?: string }).lifecycleState ?? "active";
    const stage = renewalStage(new Date(m.renewalAt), now);
    if (stage === "window" && lc === "active") {
      const r = await tryLifecycleTransition(m.id, "renewal", {
        reason: "Renewal window opened",
        actor: SYSTEM_ACTOR,
        audit: true,
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
        actor: SYSTEM_ACTOR,
        audit: true,
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
 * officers, mark the chapter `at_risk`, and open a remediation case. Fires once
 * on the transition into "below" (and re-arms once it recovers), so it doesn't
 * repeat daily. The alert/case are resolved when health climbs back above the
 * watch band.
 */
async function jobHealthThreshold(now = new Date()): Promise<void> {
  const db = getDb();
  const chapters = await db
    .select({ id: schema.chapters.id, name: schema.chapters.name, status: schema.chapters.status })
    .from(schema.chapters)
    .where(isNull(schema.chapters.deletedAt));
  let alerted = 0;
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  for (const ch of chapters) {
    let total: number, below: boolean;
    let h: Awaited<ReturnType<typeof computeChapterHealth>>;
    try {
      h = await computeChapterHealth(ch.id);
      total = h.total;
      below = h.band === "below";
    } catch {
      continue;
    }
    // Persist the daily health snapshot so KPI trends and alerting have data.
    await db
      .delete(schema.healthSnapshots)
      .where(
        and(
          eq(schema.healthSnapshots.chapterId, ch.id),
          gte(schema.healthSnapshots.createdAt, dayStart),
          lt(schema.healthSnapshots.createdAt, dayEnd)
        )
      );
    await db.insert(schema.healthSnapshots).values({
      chapterId: ch.id,
      total: h.total,
      retention: h.components.retention,
      engagement: h.components.engagement,
      growth: h.components.growth,
      programme: h.components.programme,
      leadership: h.components.leadership,
      governance: h.components.governance,
      memberCount: h.memberCount,
    });
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
      // Surface at-risk status for franchise operations and reporting.
      if (ch.status !== "at_risk") {
        await db
          .update(schema.chapters)
          .set({ status: "at_risk" })
          .where(eq(schema.chapters.id, ch.id));
        await audit(SYSTEM_ACTOR, "chapter.status", {
          type: "chapter",
          id: ch.id,
          detail: `${ch.name} marked at_risk (health index ${total})`,
        });
      }
      // Open a single remediation case per chapter while at-risk.
      const existing = await db
        .select({ id: schema.kpiAlerts.id })
        .from(schema.kpiAlerts)
        .where(
          and(
            eq(schema.kpiAlerts.scope, "chapter"),
            eq(schema.kpiAlerts.scopeId, ch.id),
            eq(schema.kpiAlerts.metric, "chapter_health"),
            inArray(schema.kpiAlerts.status, ["open", "acknowledged"])
          )
        )
        .limit(1);
      if (!existing.length) {
        await db.insert(schema.kpiAlerts).values({
          scope: "chapter",
          scopeId: ch.id,
          metric: "chapter_health",
          severity: "red",
          status: "open",
          message: `${ch.name} health index ${total} is below the healthy line. Remediation plan required.`,
        });
      }
      alerted++;
    } else {
      // Health recovered — resolve any open chapter-health case for this chapter.
      await db
        .update(schema.kpiAlerts)
        .set({ status: "resolved", resolvedAt: new Date() })
        .where(
          and(
            eq(schema.kpiAlerts.scope, "chapter"),
            eq(schema.kpiAlerts.scopeId, ch.id),
            eq(schema.kpiAlerts.metric, "chapter_health"),
            inArray(schema.kpiAlerts.status, ["open", "acknowledged"])
          )
        );
    }
    await setMarker(markerKey, state);
  }
  if (alerted)
    logger.info(`scheduler health threshold: ${alerted} chapter(s) alerted`, { alerted });
}

/**
 * FR-02 — automatically promote provisional chapters that satisfy the franchise
 * readiness checklist. Runs once per day; idempotent because the query only
 * targets `provisional` chapters and the update changes their status.
 */
async function jobFranchiseReadiness(now = new Date()): Promise<void> {
  const db = getDb();
  const provisional = await db
    .select()
    .from(schema.chapters)
    .where(eq(schema.chapters.status, "provisional"));
  let promoted = 0;
  for (const chapter of provisional) {
    const [[memberRow], roles, budgetRows, cadenceRows] = await Promise.all([
      db
        .select({ n: sql<number>`count(*)` })
        .from(schema.members)
        .where(eq(schema.members.homeChapterId, chapter.id)),
      db
        .select({ role: schema.chapterRoles.role })
        .from(schema.chapterRoles)
        .where(
          and(
            eq(schema.chapterRoles.chapterId, chapter.id),
            eq(schema.chapterRoles.status, "active")
          )
        ),
      db
        .select({ amount: schema.chapterBudgets.amount })
        .from(schema.chapterBudgets)
        .where(
          and(
            eq(schema.chapterBudgets.chapterId, chapter.id),
            eq(schema.chapterBudgets.status, "approved"),
            eq(schema.chapterBudgets.kind, "allocation")
          )
        ),
      db
        .select({ id: schema.cadences.id })
        .from(schema.cadences)
        .where(
          and(
            eq(schema.cadences.chapterId, chapter.id),
            eq(schema.cadences.active, 1)
          )
        ),
    ]);

    const items = evaluateFranchiseReadiness({
      status: chapter.status,
      charterDate: chapter.charterDate,
      zoneId: chapter.zoneId,
      memberCount: Number(memberRow?.n ?? 0),
      activeRoleKeys: roles.map(r => r.role),
      approvedBudgetAed: budgetRows.reduce(
        (sum, r) => sum + (r.amount ?? 0),
        0
      ),
      activeCadenceCount: cadenceRows.length,
    });
    const score = readinessScore(items);
    if (!score.ready) continue;

    const charterDate = chapter.charterDate ?? now;
    await db
      .update(schema.chapters)
      .set({ status: "chartered", charterDate })
      .where(eq(schema.chapters.id, chapter.id));

    await audit(SYSTEM_ACTOR, "chapter.charter.auto", {
      type: "chapter",
      id: chapter.id,
      detail: `${chapter.name} → chartered (readiness ${score.percent}%)`,
    });

    // Notify all leaders in the chapter's ancestor chain (zone → region → country).
    const ancestorIds: number[] = [];
    if (chapter.zoneId) {
      ancestorIds.push(chapter.zoneId);
      const zone = (
        await db
          .select()
          .from(schema.orgUnits)
          .where(eq(schema.orgUnits.id, chapter.zoneId))
          .limit(1)
      ).at(0);
      if (zone?.parentId) {
        ancestorIds.push(zone.parentId);
        const region = (
          await db
            .select()
            .from(schema.orgUnits)
            .where(eq(schema.orgUnits.id, zone.parentId))
            .limit(1)
        ).at(0);
        if (region?.parentId) ancestorIds.push(region.parentId);
      }
    }
    const leaders = ancestorIds.length
      ? await db
          .select({ memberId: schema.unitRoles.memberId, level: schema.unitRoles.level })
          .from(schema.unitRoles)
          .where(
            and(
              inArray(schema.unitRoles.unitId, ancestorIds),
              sql`${schema.unitRoles.role} in ('zone_director','region_director','country_director','national_director','National Director','Country Director','Region Director','Zone Director')`
            )
          )
      : [];
    const msg = `${chapter.name} has met all franchise readiness requirements and been automatically granted a charter.`;
    for (const d of leaders) {
      notify(d.memberId, msg, "governance").catch(() => {});
    }
    promoted++;
  }
  if (promoted)
    logger.info(`scheduler franchise readiness: ${promoted} chapter(s) chartered`, { promoted });
}

/**
 * FR-03 — nudge owners of overdue franchise onboarding checklist items once per
 * day. Only items that are pending/in_progress and have passed their due date
 * (or have no due date and are still open after 14 days) are flagged.
 */
async function jobFranchiseOnboardingNudges(now = new Date()): Promise<void> {
  const db = getDb();
  const stale = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      id: schema.franchiseOnboardingChecklists.id,
      chapterId: schema.franchiseOnboardingChecklists.chapterId,
      label: schema.franchiseOnboardingChecklists.label,
      assignedMemberId: schema.franchiseOnboardingChecklists.assignedMemberId,
      dueAt: schema.franchiseOnboardingChecklists.dueAt,
      createdAt: schema.franchiseOnboardingChecklists.createdAt,
      chapterName: schema.chapters.name,
    })
    .from(schema.franchiseOnboardingChecklists)
    .innerJoin(
      schema.chapters,
      eq(schema.chapters.id, schema.franchiseOnboardingChecklists.chapterId)
    )
    .where(
      and(
        inArray(schema.franchiseOnboardingChecklists.status, ["pending", "in_progress"]),
        or(
          lte(schema.franchiseOnboardingChecklists.dueAt, now),
          and(
            isNull(schema.franchiseOnboardingChecklists.dueAt),
            lte(schema.franchiseOnboardingChecklists.createdAt, stale)
          )
        )
      )
    );

  let nudged = 0;
  for (const row of rows) {
    const targetId = row.assignedMemberId;
    if (!targetId) continue; // unassigned items are not nudged
    const markerKey = `fronb:${row.id}:${now.toISOString().slice(0, 10)}`;
    if (await getMarker(markerKey)) continue;
    await notify(
      targetId,
      `"${row.label}" for ${row.chapterName} is overdue on the franchise onboarding checklist. Please update its status or move the due date.`,
      "health"
    );
    await setMarker(markerKey, "sent");
    nudged++;
  }
  if (nudged)
    logger.info(`scheduler franchise onboarding nudges: ${nudged} reminder(s) sent`, { nudged });
}

/**
 * BRD 6.7 — carry forward unspent chapter budget allocations at the start of
 * each calendar year. Guarded by a per-year marker so the pass only runs once.
 */
async function jobBudgetCarryForward(now = new Date()): Promise<void> {
  const year = now.getUTCFullYear();
  const markerKey = `budget-carry-forward:${year}`;
  const already = await getMarker(markerKey);
  if (already) return;

  const result = await carryForwardBudgets(now);
  await setMarker(markerKey, "done");
  if (result.carried || result.skipped) {
    logger.info(`scheduler budget carry-forward FY${year}: ${result.carried} carried, ${result.skipped} already done`, result);
  }
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
 * OPS-P0-2 — reconcile pending Stripe payments that may have missed a webhook.
 * Polls records older than 1 hour once per day and flips status to paid/failed.
 */
async function jobReconcilePayments(now = new Date()): Promise<void> {
  if (!paymentsEnabled()) return;
  const provider = getPaymentProvider();
  if (provider.name !== "stripe" || !("retrieveCheckoutSession" in provider)) return;

  const db = getDb();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const pending = await db
    .select({
      id: schema.paymentRecords.id,
      providerRef: schema.paymentRecords.providerRef,
      userId: schema.paymentRecords.userId,
      amount: schema.paymentRecords.amount,
    })
    .from(schema.paymentRecords)
    .where(
      and(
        eq(schema.paymentRecords.status, "pending"),
        eq(schema.paymentRecords.provider, "stripe"),
        isNotNull(schema.paymentRecords.providerRef),
        lte(schema.paymentRecords.createdAt, oneHourAgo)
      )
    );

  let reconciled = 0;
  for (const p of pending) {
    if (!p.providerRef) continue;
    try {
      const result = await provider.retrieveCheckoutSession(p.providerRef);
      if (!result) continue; // gateway still pending
      const status = result.status;
      if (status !== "paid" && status !== "failed") continue;
      await db
        .update(schema.paymentRecords)
        .set({
          status,
          paidAt: status === "paid" ? new Date() : undefined,
        })
        .where(eq(schema.paymentRecords.id, p.id));
      await audit(SYSTEM_ACTOR, "payment.reconcile", {
        type: "payment",
        id: p.id,
        detail: `Reconciled to ${status} via retrieveCheckoutSession`,
      });
      reconciled++;
    } catch (e) {
      logger.warn(`scheduler payment reconciliation failed for ${p.id}`, {
        paymentId: p.id,
        error: String(e),
      });
    }
  }
  if (reconciled)
    logger.info(`scheduler payment reconciliation: ${reconciled} record(s) updated`, {
      reconciled,
    });
}

/**
 * BRD 6.3 — retry failed/bounced email deliveries that may have been transient.
 * Bounded: only the last 7 days, max 3 prior attempts, up to 100 per run so the
 * daily pass can't be swamped by a bad provider week.
 */
async function jobRetryFailedNotifications(now = new Date()): Promise<void> {
  const db = getDb();
  const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ id: schema.notificationDeliveries.id })
    .from(schema.notificationDeliveries)
    .where(
      and(
        inArray(schema.notificationDeliveries.status, ["failed", "bounced"]),
        lte(schema.notificationDeliveries.retryCount, 3),
        gte(schema.notificationDeliveries.createdAt, cutoff)
      )
    )
    .orderBy(schema.notificationDeliveries.createdAt)
    .limit(100);

  let retried = 0;
  for (const row of rows) {
    try {
      await retryEmailDelivery(row.id);
      retried++;
    } catch (e) {
      logger.warn(`scheduler notification retry failed for delivery ${row.id}`, {
        deliveryId: row.id,
        error: String(e),
      });
    }
  }
  if (retried)
    logger.info(`scheduler notification retries: ${retried} delivery(s) re-attempted`, { retried });
}

/**
 * Scorecard nurture — send a personalised follow-up to clarity-scorecard leads
 * at day 3 and day 10. Only sends once per lead per stage.
 */
async function jobScorecardFollowUp(now = new Date()): Promise<void> {
  const db = getDb();
  const day3 = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
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
  await safe("payment-reconciliation", () => jobReconcilePayments(now));
  await safe("notification-retries", () => jobRetryFailedNotifications(now));
  await safe("onboarding-slip", () => jobOnboardingSlip());
  await safe("cadence-reminders", () => jobCadenceReminders(now));
  await safe("role-terms", () => jobRoleTerms(now));
  await safe("health-threshold", () => jobHealthThreshold());
  await safe("franchise-readiness", () => jobFranchiseReadiness(now));
  await safe("franchise-onboarding-nudges", () => jobFranchiseOnboardingNudges(now));
  await safe("scorecard-follow-up", () => jobScorecardFollowUp(now));
  await safe("kpi-snapshots", async () => {
    const { captureKpiSnapshots } = await import("../queries/kpi-snapshots");
    await captureKpiSnapshots(now);
  });
  await safe("kpi-alerts", async () => {
    const { evaluateKpiAlerts } = await import("../queries/kpi-alerts");
    await evaluateKpiAlerts();
  });
  await safe("budget-carry-forward", () => jobBudgetCarryForward(now));
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
      void alertScheduler("tick", e);
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
