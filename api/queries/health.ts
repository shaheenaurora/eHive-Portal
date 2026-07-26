import { and, eq, gte, inArray, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";
import { HEALTH_COMPONENTS, healthBand, type HealthBand } from "@contracts/constants";

export type HealthComponents = {
  retention: number; engagement: number; growth: number;
  programme: number; leadership: number; governance: number;
};
export type ChapterHealth = {
  total: number; band: HealthBand; components: HealthComponents; memberCount: number;
};

const W = Object.fromEntries(HEALTH_COMPONENTS.map((c) => [c.key, c.weight])) as Record<keyof HealthComponents, number>;
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const DAY = 86_400_000;

/**
 * Compute a chapter's health index live from data the platform already captures
 * (Operations Manual §4.4 / CH-06). Six components, each 0–100, blended by the
 * weights in HEALTH_COMPONENTS. Everything is chapter-scoped by homeChapterId.
 */
export async function computeChapterHealth(chapterId: number): Promise<ChapterHealth> {
  const db = getDb();
  const members = await db.select().from(schema.members).where(eq(schema.members.homeChapterId, chapterId));
  const memberCount = members.length;
  const active = members.filter((m) => m.status === "active");
  const churned = members.filter((m) => m.status === "cancelled" || m.lifecycleState === "lapsed" || m.lifecycleState === "alumni");

  // Retention — active vs churned. An all-active chapter scores full marks.
  const retDenom = active.length + churned.length;
  const retention = retDenom ? clamp((active.length / retDenom) * 100) : (memberCount ? 100 : 0);

  // Engagement — share of active members meeting the Engagement Standard
  // (dormancy still "active" rather than at-risk/dormant).
  const engaged = active.filter((m) => (m.dormancyStage ?? "active") === "active");
  const engagement = active.length ? clamp((engaged.length / active.length) * 100) : 0;

  // Growth — joins in the last quarter as a rate against active size; 15% = full.
  const now = Date.now();
  const recent = members.filter((m) => now - new Date(m.joinedAt).getTime() <= 90 * DAY).length;
  const growthRate = active.length ? recent / active.length : (recent ? 1 : 0);
  const growth = clamp((growthRate / 0.15) * 100);

  // Programme — event attendances by chapter members in the last quarter,
  // per active member; ~2 per quarter = full marks.
  let programme = 0;
  if (active.length) {
    const ids = members.map((m) => m.id);
    const [row] = await db.select({ n: sql<number>`count(*)` })
      .from(schema.eventRegs)
      .innerJoin(schema.events, eq(schema.events.id, schema.eventRegs.eventId))
      .where(and(
        inArray(schema.eventRegs.memberId, ids),
        eq(schema.eventRegs.status, "attended"),
        gte(schema.events.startsAt, new Date(now - 90 * DAY)),
      ));
    programme = clamp(((Number(row?.n ?? 0) / active.length) / 2) * 100);
  }

  // Leadership pipeline — board seats filled (≈6 officers = healthy) plus a
  // bonus for a genuinely contested election.
  const roles = await db.select().from(schema.chapterRoles)
    .where(and(eq(schema.chapterRoles.chapterId, chapterId), eq(schema.chapterRoles.status, "active")));
  const roleKeys = new Set(roles.map((r) => r.role));
  let contested = false;
  const elections = await db.select().from(schema.elections).where(eq(schema.elections.chapterId, chapterId));
  if (elections.length) {
    const counts = await db.select({ electionId: schema.candidates.electionId, n: sql<number>`count(*)` })
      .from(schema.candidates)
      .where(inArray(schema.candidates.electionId, elections.map((e) => e.id)))
      .groupBy(schema.candidates.electionId);
    contested = counts.some((c) => Number(c.n) > 1);
  }
  const leadership = clamp(Math.min(1, roles.length / 6) * 80 + (contested ? 20 : 0));

  // Governance & finance — an election has been run + an approved budget exists
  // + the three fiduciary officers are in place.
  const ranElection = elections.some((e) => e.status === "closed");
  const budgets = await db.select().from(schema.chapterBudgets).where(eq(schema.chapterBudgets.chapterId, chapterId));
  const approvedBudget = budgets.some((b) => b.status === "approved" || b.status === "spent");
  const coreOfficers = ["president", "secretary", "treasurer"].filter((k) => roleKeys.has(k)).length;
  const governance = clamp((ranElection ? 40 : 0) + (approvedBudget ? 30 : 0) + (coreOfficers / 3) * 30);

  const components: HealthComponents = { retention, engagement, growth, programme, leadership, governance };
  const total = clamp(
    (retention * W.retention + engagement * W.engagement + growth * W.growth +
      programme * W.programme + leadership * W.leadership + governance * W.governance) / 100,
  );
  return { total, band: healthBand(total), components, memberCount };
}
