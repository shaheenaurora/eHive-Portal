import { eq, and, asc, sql, gte, isNull } from "drizzle-orm";
import * as schema from "@db/schema";
import type { Tier } from "@contracts/constants";
import { getDb } from "./connection";
import { pushToMember } from "../lib/push";
import { applyLifecycleTransition } from "../lib/lifecycle";
import { logger } from "../lib/log";

/** The member record for a user, or null when they only have an application. */
export async function getMemberByUserId(userId: number) {
  const rows = await getDb()
    .select()
    .from(schema.members)
    .where(eq(schema.members.userId, userId))
    .limit(1);
  return rows.at(0) ?? null;
}

/** Score weights as { factor: maxPoints } — caps sum to 100. */
export async function getScoreWeights(): Promise<Record<string, number>> {
  const rows = await getDb().select().from(schema.hiveScoreConfig);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.factor] = r.weight;
  return out;
}

/**
 * Recompute a member's Hive Score from the raw score-events ledger:
 * per factor, min(rawSum, factorCap); total = sum of capped factors.
 * Writes the cached score + a history snapshot. Returns the new score.
 */
export async function recomputeScore(memberId: number): Promise<number> {
  const db = getDb();
  const weights = await getScoreWeights();
  const sums = await db
    .select({
      factor: schema.scoreEvents.factor,
      total: sql<number>`coalesce(sum(${schema.scoreEvents.points}),0)`,
    })
    .from(schema.scoreEvents)
    .where(eq(schema.scoreEvents.memberId, memberId))
    .groupBy(schema.scoreEvents.factor);
  const breakdown: Record<string, number> = {};
  for (const s of sums)
    breakdown[s.factor] = Math.min(s.total, weights[s.factor] ?? s.total);
  const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
  await db
    .update(schema.members)
    .set({ hiveScore: score })
    .where(eq(schema.members.id, memberId));
  await db
    .insert(schema.hiveScoreHistory)
    .values({ memberId, score, breakdown: JSON.stringify(breakdown) });
  return score;
}

/** Add raw points to the ledger and recompute. */
export async function awardPoints(
  memberId: number,
  factor: string,
  points: number,
  note?: string
) {
  await getDb()
    .insert(schema.scoreEvents)
    .values({ memberId, factor, points, note });
  return recomputeScore(memberId);
}

/** Open action items assigned to a member, newest first. */
export async function openActionItems(memberId: number) {
  return getDb()
    .select()
    .from(schema.actionItems)
    .where(
      and(
        eq(schema.actionItems.memberId, memberId),
        eq(schema.actionItems.status, "open")
      )
    )
    .orderBy(asc(schema.actionItems.dueAt));
}

/** Next scheduled session across the member's pods. */
export async function nextSessionForMember(memberId: number) {
  const rows = await getDb()
    .select({ session: schema.sessions, pod: schema.pods })
    .from(schema.sessions)
    .innerJoin(schema.pods, eq(schema.sessions.podId, schema.pods.id))
    .innerJoin(
      schema.podMembers,
      and(
        eq(schema.podMembers.podId, schema.pods.id),
        eq(schema.podMembers.memberId, memberId)
      )
    )
    .where(
      and(
        eq(schema.sessions.status, "scheduled"),
        gte(schema.sessions.startsAt, new Date())
      )
    )
    .orderBy(asc(schema.sessions.startsAt))
    .limit(1);
  return rows.at(0) ?? null;
}

export function memberDisplayName(user: {
  name: string | null;
  email: string | null;
}) {
  if (user.name && user.name.trim()) return user.name;
  if (user.email) return user.email.split("@")[0];
  return "Member";
}

/* ================= BRD v2: point-rules engine, notifications, dormancy ================= */

import {
  POINT_RULE_DEFAULTS,
  POINT_RULE_FACTOR,
  POINT_RULE_LABEL,
  type PointRuleKey,
  type DormancyStage,
} from "@contracts/constants";

/** Point values per rule key — DB overrides (point_rules table) over BRD defaults. */
export async function getPointRules(): Promise<Record<string, number>> {
  const rows = await getDb().select().from(schema.pointRules);
  const out: Record<string, number> = { ...POINT_RULE_DEFAULTS };
  for (const r of rows) out[r.key] = r.points;
  return out;
}

/** Award points for a BRD point-rule key (value is admin-configurable). */
export async function awardRulePoints(
  memberId: number,
  key: PointRuleKey,
  note?: string
): Promise<number> {
  const rules = await getPointRules();
  const pts = rules[key] ?? POINT_RULE_DEFAULTS[key];
  return awardPoints(
    memberId,
    POINT_RULE_FACTOR[key],
    pts,
    note ?? POINT_RULE_LABEL[key]
  );
}

/** In-portal notification (BRD 6.3 — email/WhatsApp dispatch is a platform dependency). */
export async function notify(memberId: number, text: string, kind = "info") {
  const db = getDb();
  const res = await db.insert(schema.notifications).values({ memberId, text, kind });
  const notificationId = Number((res as unknown as { insertId?: number }).insertId ?? 0);

  // Create delivery tracking rows for each outbound channel.
  const [emailDelivery] = await db.insert(schema.notificationDeliveries).values({
    notificationId,
    memberId,
    channel: "email",
    status: "pending",
  });

  // Fire a matching web push (fire-and-forget; never blocks the in-app notify).
  void pushToMember(
    memberId,
    { title: "eHive Circle", body: text, url: "/portal" },
    kind
  );

  // Email a copy too. Await so the delivery record is updated before notify() returns,
  // but keep errors from propagating to the caller.
  try {
    const { emailNotification } = await import("../lib/notify-mail");
    await emailNotification(memberId, text, kind, Number((emailDelivery as unknown as { insertId?: number }).insertId ?? 0));
  } catch {
    /* delivery status already recorded; never breaks the triggering action */
  }
}

/**
 * Automatically pair a new member with an existing active buddy (SRS POR-ENG-06
 * / 5.3 — within 5 business days). Picks the least-loaded active member (spreads
 * the load), tie-broken by longest tenure. No-op if already paired or if there's
 * no eligible buddy yet. Safe to call on member creation; never throws upward.
 */
export async function autoPairBuddy(
  newMemberId: number
): Promise<number | null> {
  const db = getDb();
  const already = await db
    .select({ id: schema.buddies.id })
    .from(schema.buddies)
    .where(eq(schema.buddies.newMemberId, newMemberId))
    .limit(1);
  if (already.length) return null;

  const candidates = await db
    .select({ id: schema.members.id, createdAt: schema.members.createdAt })
    .from(schema.members)
    .where(
      and(
        eq(schema.members.status, "active"),
        sql`${schema.members.dormancyStage} = 'active'`,
        sql`${schema.members.id} <> ${newMemberId}`
      )
    )
    .limit(500);
  if (!candidates.length) return null;

  const loads = await db
    .select({ b: schema.buddies.buddyMemberId, n: sql<number>`count(*)` })
    .from(schema.buddies)
    .groupBy(schema.buddies.buddyMemberId);
  const loadOf = new Map(loads.map(l => [l.b, Number(l.n)]));

  candidates.sort((a, b) => {
    const la = loadOf.get(a.id) ?? 0,
      lb = loadOf.get(b.id) ?? 0;
    if (la !== lb) return la - lb;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
  const buddy = candidates[0];

  await db
    .insert(schema.buddies)
    .values({ newMemberId, buddyMemberId: buddy.id });
  await notify(
    newMemberId,
    "You've been paired with an eHive buddy — say hello and book a first chat!",
    "connect"
  );
  await notify(
    buddy.id,
    "You've been assigned as a buddy to a new member. A 30-day check-in is due.",
    "connect"
  );
  return buddy.id;
}

/**
 * Activate (or upgrade) a membership for a user — the shared path used by both
 * paid self-serve join and admin approval. Creates the member, logs the event,
 * awards joining points, and auto-pairs a buddy for brand-new members.
 */
export async function activateMembership(
  userId: number,
  tier: Tier,
  note = "Membership activated"
): Promise<number> {
  const db = getDb();
  const existing = (
    await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.userId, userId))
      .limit(1)
  ).at(0);
  if (existing) {
    const fromTier = existing.tier;
    await db
      .update(schema.members)
      .set({ tier, status: "active" })
      .where(eq(schema.members.id, existing.id));
    if (fromTier !== tier) {
      await db.insert(schema.membershipEvents).values({
        memberId: existing.id,
        type: "upgrade",
        fromTier,
        toTier: tier,
        note,
      });
    }
    return existing.id;
  }
  const renewal = new Date();
  renewal.setFullYear(renewal.getFullYear() + 1);
  // New members enter ONBOARDING (the first 30/60/90 days), not straight to
  // active — a Stripe-paid join must run the same onboarding journey as an
  // admin-approved one. statusForLifecycle("onboarding") is still "active", so
  // access is granted immediately.
  const res = await db.insert(schema.members).values({
    userId,
    tier,
    status: "active",
    lifecycleState: "onboarding",
    renewalAt: renewal,
  });
  const memberId = Number(res[0].insertId);
  await db
    .insert(schema.membershipEvents)
    .values({ memberId, type: "approved", toTier: tier, note });
  await awardPoints(memberId, "tenure", 5, "Joined eHive Circle");
  try {
    await notify(
      memberId,
      "Welcome to eHive Circle. Your onboarding journey starts now.",
      "membership"
    );
  } catch {
    /* non-fatal */
  }
  try {
    await autoPairBuddy(memberId);
  } catch (e) {
    logger.error("buddy auto-pair failed", { error: e });
  }
  return memberId;
}

/**
 * ML-05 — renew a membership for another year. Extends the renewal date by one
 * year (from the later of now / the current date so early renewals don't lose
 * time), returns the CRM lifecycle to Active, and logs the event. Used by the
 * paid-renewal webhook and by an admin recording an offline renewal.
 */
export async function renewMembership(
  userId: number,
  note = "Membership renewed"
): Promise<number | null> {
  const db = getDb();
  const m = (
    await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.userId, userId))
      .limit(1)
  ).at(0);
  if (!m) return null;
  const base =
    m.renewalAt && new Date(m.renewalAt) > new Date()
      ? new Date(m.renewalAt)
      : new Date();
  base.setFullYear(base.getFullYear() + 1);
  await db
    .update(schema.members)
    .set({ renewalAt: base })
    .where(eq(schema.members.id, m.id));
  await applyLifecycleTransition(m.id, "active", {
    reason: note,
    audit: false,
  });
  await db
    .insert(schema.membershipEvents)
    .values({ memberId: m.id, type: "renew", toTier: m.tier, note });
  await awardPoints(m.id, "tenure", 5, "Renewed membership");
  await notify(
    m.id,
    "Thank you for renewing — your membership is active for another year. 🎉",
    "membership"
  );
  return m.id;
}

/** Start of the current quarter. */
export function quarterStart(d = new Date()): Date {
  const q = Math.floor(d.getMonth() / 3) * 3;
  return new Date(d.getFullYear(), q, 1);
}

/** Quarter-to-date engagement counts for a member. */
export async function engagementCounts(
  memberId: number,
  since = quarterStart()
) {
  const map = await engagementCountsForMembers([memberId], since);
  return map.get(memberId) ?? { sessions: 0, oneToOnes: 0, giveBack: 0 };
}

/** Batch engagement counts for many members in three queries (fixes N+1). */
export async function engagementCountsForMembers(
  memberIds: number[],
  since = quarterStart()
): Promise<
  Map<number, { sessions: number; oneToOnes: number; giveBack: number }>
> {
  const db = getDb();
  const empty = new Map<
    number,
    { sessions: number; oneToOnes: number; giveBack: number }
  >();
  for (const id of memberIds)
    empty.set(id, { sessions: 0, oneToOnes: 0, giveBack: 0 });
  if (!memberIds.length) return empty;

  const idsSql = sql.join(
    memberIds.map(id => sql`${id}`),
    sql`, `
  );
  const yearStart = new Date(new Date().getFullYear(), 0, 1);

  const [sessionsRows, oneToOneRows, giveBackRows] = await Promise.all([
    db
      .select({
        memberId: schema.attendance.memberId,
        n: sql<number>`count(*)`,
      })
      .from(schema.attendance)
      .innerJoin(
        schema.sessions,
        eq(schema.attendance.sessionId, schema.sessions.id)
      )
      .where(
        and(
          sql`${schema.attendance.memberId} in (${idsSql})`,
          gte(schema.sessions.startsAt, since)
        )
      )
      .groupBy(schema.attendance.memberId),
    db
      .select({
        memberId: schema.oneToOnes.aMemberId,
        n: sql<number>`count(*)`,
      })
      .from(schema.oneToOnes)
      .where(
        and(
          sql`(${schema.oneToOnes.aMemberId} in (${idsSql}) or ${schema.oneToOnes.bMemberId} in (${idsSql}))`,
          eq(schema.oneToOnes.status, "confirmed"),
          eq(schema.oneToOnes.kind, "one_to_one"),
          gte(schema.oneToOnes.createdAt, since)
        )
      )
      .groupBy(schema.oneToOnes.aMemberId),
    db
      .select({
        memberId: schema.oneToOnes.bMemberId,
        n: sql<number>`count(*)`,
      })
      .from(schema.oneToOnes)
      .where(
        and(
          sql`${schema.oneToOnes.bMemberId} in (${idsSql})`,
          eq(schema.oneToOnes.status, "confirmed"),
          eq(schema.oneToOnes.kind, "mentoring"),
          gte(schema.oneToOnes.createdAt, yearStart)
        )
      )
      .groupBy(schema.oneToOnes.bMemberId),
  ]);

  for (const r of sessionsRows) {
    const e = empty.get(r.memberId)!;
    e.sessions = Number(r.n);
  }
  for (const r of oneToOneRows) {
    const e = empty.get(r.memberId)!;
    e.oneToOnes = Number(r.n);
  }
  for (const r of giveBackRows) {
    const e = empty.get(r.memberId)!;
    e.giveBack = Number(r.n);
  }
  return empty;
}

async function setDormancyStage(
  memberId: number,
  from: string,
  to: DormancyStage,
  reason: string,
  actor = "system"
) {
  const db = getDb();
  await db
    .update(schema.members)
    .set({ dormancyStage: to })
    .where(eq(schema.members.id, memberId));
  await db
    .insert(schema.dormancyLog)
    .values({ memberId, fromStage: from, toStage: to, reason, actor });
  const labels: Record<string, string> = {
    at_risk: "At Risk",
    dormant: "Dormant",
    non_renewal: "Non-Renewal",
    active: "Active",
  };
  await notify(
    memberId,
    `Your engagement status changed to ${labels[to] ?? to}. ${reason}`,
    "dormancy"
  );
}

/**
 * BRD 6.3 Dormancy Ladder evaluation (quarterly, admin-triggered):
 * meets standard -> active; some activity but below standard -> at_risk;
 * zero activity -> dormant; dormant twice in a row -> non_renewal.
 * Members on exception pause are skipped (pause counter decremented).
 */
export async function evaluateDormancy(): Promise<{
  evaluated: number;
  transitions: number;
}> {
  const db = getDb();
  const configs = await db.select().from(schema.engagementConfig);
  const cfgByTier = new Map(configs.map(c => [c.tier, c]));
  const all = await db
    .select()
    .from(schema.members)
    .where(eq(schema.members.status, "active"));
  // Tick down every paused member in one statement rather than one UPDATE each.
  // The loop below then simply skips them (their snapshot value is still > 0).
  await db
    .update(schema.members)
    .set({ exceptionPause: sql`${schema.members.exceptionPause} - 1` })
    .where(
      and(
        eq(schema.members.status, "active"),
        sql`${schema.members.exceptionPause} > 0`
      )
    );
  const countsByMember = await engagementCountsForMembers(all.map(m => m.id));
  let transitions = 0;
  for (const m of all) {
    // Paused this cycle — already decremented in the bulk update above.
    if (m.exceptionPause > 0) continue;
    const cfg = cfgByTier.get(m.tier);
    const counts = countsByMember.get(m.id) ?? {
      sessions: 0,
      oneToOnes: 0,
      giveBack: 0,
    };
    const needSessions = Math.max(
      1,
      Math.ceil((cfg?.sessionsRequired ?? 2) / 4)
    );
    const needOneToOnes = cfg?.oneToOnesPerQuarter ?? 1;
    const anyActivity =
      counts.sessions > 0 || counts.oneToOnes > 0 || counts.giveBack > 0;
    const meets =
      counts.sessions >= needSessions && counts.oneToOnes >= needOneToOnes;
    const cur = (m.dormancyStage ?? "active") as DormancyStage;
    let next: DormancyStage = cur;
    let reason = "";
    if (meets) {
      if (cur !== "active") {
        next = "active";
        reason = "Engagement standard met.";
      }
    } else if (anyActivity) {
      if (cur !== "at_risk") {
        next = "at_risk";
        reason = "Below the Engagement Standard this quarter.";
      }
    } else if (cur === "dormant") {
      next = "non_renewal";
      reason = "No engagement for two consecutive quarters.";
    } else {
      next = "dormant";
      reason = "No recorded engagement this quarter.";
    }
    if (next !== cur) {
      await setDormancyStage(m.id, cur, next, reason);
      transitions++;
    }
    // ML-04: keep the CRM lifecycle in step with engagement — auto-flag at-risk
    // and auto-clear on recovery, without disturbing onboarding/renewal/etc.
    const lc = (m as { lifecycleState?: string }).lifecycleState;
    if (
      lc === "active" &&
      (next === "at_risk" || next === "dormant" || next === "non_renewal")
    ) {
      await applyLifecycleTransition(m.id, "at_risk", {
        reason: reason || "Flagged at-risk by the engagement ladder.",
        audit: false,
      });
    } else if (lc === "at_risk" && next === "active") {
      await applyLifecycleTransition(m.id, "active", {
        reason: "Re-engaged — engagement ladder recovered",
        audit: false,
      });
    }
  }
  return { evaluated: all.length, transitions };
}

/** BRD 6.6 — intro eligibility: FRP complete + Active status. */
export async function introEligibility(
  memberId: number
): Promise<{ eligible: boolean; reasons: string[] }> {
  const db = getDb();
  const reasons: string[] = [];
  const m = (
    await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.id, memberId))
      .limit(1)
  ).at(0);
  if (!m) return { eligible: false, reasons: ["Not a member"] };
  if (m.status !== "active") reasons.push("Membership is not active");
  if ((m.dormancyStage ?? "active") !== "active")
    reasons.push("Engagement status is not Active");
  const completed = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.frpEnrolments)
    .where(
      and(
        eq(schema.frpEnrolments.memberId, memberId),
        eq(schema.frpEnrolments.status, "completed")
      )
    );
  if ((completed.at(0)?.n ?? 0) === 0) reasons.push("FRP not completed");
  return { eligible: reasons.length === 0, reasons };
}

/** Human-readable check-in code for event QR/door check-in. */
export function newCheckinCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 8; i++)
    s += chars[Math.floor(Math.random() * chars.length)];
  return s.slice(0, 4) + "-" + s.slice(4);
}

/** BRD 6.4 — promote the longest-waiting member when a seat frees up. */
export async function promoteWaitlist(eventId: number) {
  const db = getDb();
  const next = await db
    .select()
    .from(schema.eventRegs)
    .where(
      and(
        eq(schema.eventRegs.eventId, eventId),
        eq(schema.eventRegs.status, "waitlisted")
      )
    )
    .orderBy(asc(schema.eventRegs.createdAt))
    .limit(1);
  const reg = next.at(0);
  if (!reg) return;
  await db
    .update(schema.eventRegs)
    .set({ status: "registered", checkinCode: newCheckinCode() })
    .where(eq(schema.eventRegs.id, reg.id));
  const ev = (
    await db
      .select()
      .from(schema.events)
      .where(
        and(eq(schema.events.id, eventId), isNull(schema.events.deletedAt))
      )
      .limit(1)
  ).at(0);
  await notify(
    reg.memberId,
    `A seat opened up — you're registered for ${ev?.title ?? "the event"}.`,
    "event"
  );
}
