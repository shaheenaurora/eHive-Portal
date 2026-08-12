import { and, eq, gte, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";
import {
  HEALTH_COMPONENTS,
  healthBand,
  type HealthBand,
} from "@contracts/constants";

export type HealthComponents = {
  retention: number;
  engagement: number;
  growth: number;
  programme: number;
  leadership: number;
  governance: number;
};
export type ChapterHealth = {
  total: number;
  band: HealthBand;
  components: HealthComponents;
  memberCount: number;
};

const W = Object.fromEntries(
  HEALTH_COMPONENTS.map(c => [c.key, c.weight])
) as Record<keyof HealthComponents, number>;
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const DAY = 86_400_000;

/**
 * Compute a chapter's health index live from data the platform already captures
 * (Operations Manual §4.4 / CH-06). Six components, each 0–100, blended by the
 * weights in HEALTH_COMPONENTS. Everything is chapter-scoped by homeChapterId.
 *
 * This implementation pushes as much counting/aggregation as possible into MySQL
 * so it scales with chapter size.
 */
export async function computeChapterHealth(
  chapterId: number
): Promise<ChapterHealth> {
  const db = getDb();
  const since = new Date(Date.now() - 90 * DAY);

  // Aggregate member statuses in a single query.
  const [memberAgg] = await db
    .select({
      total: sql<number>`count(*)`,
      active: sql<number>`sum(case when ${schema.members.status} = 'active' then 1 else 0 end)`,
      churned: sql<number>`sum(case when ${schema.members.status} = 'cancelled' or ${schema.members.lifecycleState} in ('lapsed','alumni') then 1 else 0 end)`,
      engaged: sql<number>`sum(case when ${schema.members.status} = 'active' and ${schema.members.dormancyStage} = 'active' then 1 else 0 end)`,
      recent: sql<number>`sum(case when ${schema.members.joinedAt} >= ${since} then 1 else 0 end)`,
    })
    .from(schema.members)
    .where(eq(schema.members.homeChapterId, chapterId));

  const memberCount = Number(memberAgg?.total ?? 0);
  const activeCount = Number(memberAgg?.active ?? 0);
  const churnedCount = Number(memberAgg?.churned ?? 0);
  const engagedCount = Number(memberAgg?.engaged ?? 0);
  const recentCount = Number(memberAgg?.recent ?? 0);

  // Retention — active vs churned. An all-active chapter scores full marks.
  const retDenom = activeCount + churnedCount;
  const retention = retDenom
    ? clamp((activeCount / retDenom) * 100)
    : memberCount
      ? 100
      : 0;

  // Engagement — share of active members meeting the Engagement Standard.
  const engagement = activeCount
    ? clamp((engagedCount / activeCount) * 100)
    : 0;

  // Growth — joins in the last quarter as a rate against active size; 15% = full.
  const growthRate = activeCount
    ? recentCount / activeCount
    : recentCount
      ? 1
      : 0;
  const growth = clamp((growthRate / 0.15) * 100);

  // Programme — event attendances by chapter members in the last quarter,
  // per active member; ~2 per quarter = full marks.
  let programme = 0;
  if (activeCount) {
    const [row] = await db
      .select({ n: sql<number>`count(*)` })
      .from(schema.eventRegs)
      .innerJoin(schema.events, eq(schema.events.id, schema.eventRegs.eventId))
      .innerJoin(
        schema.members,
        eq(schema.members.id, schema.eventRegs.memberId)
      )
      .where(
        and(
          eq(schema.members.homeChapterId, chapterId),
          eq(schema.eventRegs.status, "attended"),
          gte(schema.events.startsAt, since)
        )
      );
    programme = clamp((Number(row?.n ?? 0) / activeCount / 2) * 100);
  }

  // Leadership pipeline — board seats filled (≈6 officers = healthy) plus a
  // bonus for a genuinely contested election.
  const roles = await db
    .select({ role: schema.chapterRoles.role })
    .from(schema.chapterRoles)
    .where(
      and(
        eq(schema.chapterRoles.chapterId, chapterId),
        eq(schema.chapterRoles.status, "active")
      )
    );
  const roleKeys = new Set(roles.map(r => r.role));
  const elections = await db
    .select({ id: schema.elections.id, status: schema.elections.status })
    .from(schema.elections)
    .where(eq(schema.elections.chapterId, chapterId));
  let contested = false;
  if (elections.length) {
    const counts = await db
      .select({
        electionId: schema.candidates.electionId,
        n: sql<number>`count(*)`,
      })
      .from(schema.candidates)
      .where(
        sql`${schema.candidates.electionId} in (${sql.join(
          elections.map(e => sql`${e.id}`),
          sql`, `
        )})`
      )
      .groupBy(schema.candidates.electionId);
    contested = counts.some(c => Number(c.n) > 1);
  }
  const leadership = clamp(
    Math.min(1, roles.length / 6) * 80 + (contested ? 20 : 0)
  );

  // Governance & finance — an election has been run + an approved budget exists
  // + the three fiduciary officers are in place.
  const ranElection = elections.some(e => e.status === "closed");
  const [budgetAgg] = await db
    .select({
      approved: sql<number>`sum(case when ${schema.chapterBudgets.status} in ('approved','spent') then 1 else 0 end)`,
    })
    .from(schema.chapterBudgets)
    .where(eq(schema.chapterBudgets.chapterId, chapterId));
  const approvedBudget = Number(budgetAgg?.approved ?? 0) > 0;
  const coreOfficers = ["president", "secretary", "treasurer"].filter(k =>
    roleKeys.has(k)
  ).length;
  const governance = clamp(
    (ranElection ? 40 : 0) + (approvedBudget ? 30 : 0) + (coreOfficers / 3) * 30
  );

  const components: HealthComponents = {
    retention,
    engagement,
    growth,
    programme,
    leadership,
    governance,
  };
  const total = clamp(
    (retention * W.retention +
      engagement * W.engagement +
      growth * W.growth +
      programme * W.programme +
      leadership * W.leadership +
      governance * W.governance) /
      100
  );
  return { total, band: healthBand(total), components, memberCount };
}
