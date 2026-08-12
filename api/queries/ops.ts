import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";

/** The jobs the daily automation pass runs (for display in the ops cockpit). */
export const DAILY_JOBS = [
  "At-risk / dormancy evaluation",
  "Renewal window + lapse",
  "Onboarding-slip nudges",
  "Chapter cadence reminders",
  "Officer-term retirement",
  "Chapter-health alerts",
];

/** "Is the machine running?" — every operational signal in one aggregate. */
export async function opsOverview() {
  const db = getDb();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  const [sched] = await db
    .select({ value: schema.appConfig.value })
    .from(schema.appConfig)
    .where(eq(schema.appConfig.key, "scheduler:lastDaily"))
    .limit(1);

  const [followOpen] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.followUps)
    .where(eq(schema.followUps.status, "open"));
  const [followOverdue] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.followUps)
    .where(
      and(eq(schema.followUps.status, "open"), lt(schema.followUps.dueAt, now))
    );

  const [savesOpen] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.memberSaveCases)
    .where(inArray(schema.memberSaveCases.status, ["open", "working"]));

  const [dataOpen] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.dataRequests)
    .where(eq(schema.dataRequests.status, "open"));

  const [atRisk] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.members)
    .where(
      and(
        eq(schema.members.status, "active"),
        eq(schema.members.lifecycleState, "at_risk")
      )
    );
  const [dormant] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.members)
    .where(
      and(
        eq(schema.members.status, "active"),
        inArray(schema.members.dormancyStage, ["dormant", "non_renewal"])
      )
    );

  // Chapters below the health bar, from the latest snapshot each.
  const snaps = await db
    .select({
      chapterId: schema.healthSnapshots.chapterId,
      total: schema.healthSnapshots.total,
    })
    .from(schema.healthSnapshots)
    .orderBy(desc(schema.healthSnapshots.createdAt));
  const seen = new Set<number>();
  let belowBar = 0;
  for (const s of snaps) {
    if (seen.has(s.chapterId)) continue;
    seen.add(s.chapterId);
    if (s.total < 65) belowBar++;
  }

  return {
    scheduler: {
      lastDaily: sched?.value ?? null,
      ranToday: sched?.value === today,
    },
    followUps: {
      open: Number(followOpen?.n ?? 0),
      overdue: Number(followOverdue?.n ?? 0),
    },
    saves: { open: Number(savesOpen?.n ?? 0) },
    dataRequests: { open: Number(dataOpen?.n ?? 0) },
    members: {
      atRisk: Number(atRisk?.n ?? 0),
      dormant: Number(dormant?.n ?? 0),
    },
    chapters: { belowBar },
    jobs: DAILY_JOBS,
  };
}
