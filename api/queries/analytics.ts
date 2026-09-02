import { eq, gte, lte, sql, and, desc } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";
import { logger } from "../lib/log";

export type AnalyticsEventName =
  | "lead_submitted"
  | "booking_requested"
  | "user_registered"
  | "email_verified"
  | "application_submitted"
  | "application_approved"
  | "payment_started"
  | "payment_succeeded"
  | "payment_failed"
  | "member_onboarding_complete"
  | "event_registered"
  | "event_attended"
  | "pod_joined"
  | "deal_posted"
  | "referral_submitted";

export type AnalyticsProperties = Record<string, unknown>;

/** Record a business analytics event. Fire-and-forget from hot paths. */
export async function recordAnalyticsEvent(
  event: AnalyticsEventName,
  opts: {
    visitorId?: string | null;
    userId?: number | null;
    properties?: AnalyticsProperties;
    url?: string | null;
  } = {}
): Promise<void> {
  try {
    await getDb()
      .insert(schema.analyticsEvents)
      .values({
        event,
        visitorId: opts.visitorId ?? null,
        userId: opts.userId ?? null,
        properties: opts.properties ? JSON.stringify(opts.properties) : null,
        url: opts.url ?? null,
      });
  } catch (e) {
    // Analytics must never break the user-facing action.
    logger.error("analytics event failed", { event, error: e });
  }
}

export type FunnelRange = { from?: Date; to?: Date };

/** Count each funnel event over a date range. */
export async function funnelCounts(
  range?: FunnelRange
): Promise<Record<AnalyticsEventName | "_total", number>> {
  const conds = [];
  if (range?.from)
    conds.push(gte(schema.analyticsEvents.createdAt, range.from));
  if (range?.to) conds.push(lte(schema.analyticsEvents.createdAt, range.to));

  const rows = await getDb()
    .select({
      event: schema.analyticsEvents.event,
      n: sql<number>`count(*)`,
    })
    .from(schema.analyticsEvents)
    .where(conds.length ? and(...conds) : undefined)
    .groupBy(schema.analyticsEvents.event);

  const out: Record<string, number> = { _total: 0 };
  for (const r of rows) {
    const count = Number(r.n);
    out[r.event] = count;
    out._total += count;
  }
  return out as Record<AnalyticsEventName | "_total", number>;
}

/** Recent events for admin inspection / debugging. */
export async function recentAnalyticsEvents(
  event?: AnalyticsEventName,
  limit = 100
) {
  const conds = [];
  if (event) conds.push(eq(schema.analyticsEvents.event, event));
  return getDb()
    .select()
    .from(schema.analyticsEvents)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.analyticsEvents.createdAt))
    .limit(limit);
}
