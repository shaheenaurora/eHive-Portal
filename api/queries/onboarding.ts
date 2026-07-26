import { and, eq, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";
import { ONBOARDING_MILESTONES, ONBOARDING_DAYS } from "@contracts/constants";

const DAY = 86_400_000;

export type OnboardingMilestone = { key: string; label: string; stage: number; auto: boolean; done: boolean };
export type OnboardingProgress = {
  milestones: OnboardingMilestone[];
  doneCount: number; total: number; percent: number;
  dayCount: number; stage: number; complete: boolean;
};

/**
 * Compute a member's onboarding progress (ML-03). Auto milestones are derived
 * from real activity (profile filled, meeting attended, buddy paired, POD
 * placement, first POD meeting); the rest come from the manual check-off table.
 */
export async function computeOnboarding(member: schema.Member): Promise<OnboardingProgress> {
  const db = getDb();
  const mid = member.id;

  const [attended, buddy, pod, session, manualRows] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(schema.eventRegs)
      .where(and(eq(schema.eventRegs.memberId, mid), eq(schema.eventRegs.status, "attended"))),
    db.select({ n: sql<number>`count(*)` }).from(schema.buddies).where(eq(schema.buddies.newMemberId, mid)),
    db.select({ n: sql<number>`count(*)` }).from(schema.podMembers).where(eq(schema.podMembers.memberId, mid)),
    db.select({ n: sql<number>`count(*)` }).from(schema.attendance)
      .where(and(eq(schema.attendance.memberId, mid), eq(schema.attendance.status, "attended"))),
    db.select().from(schema.onboardingMilestones).where(eq(schema.onboardingMilestones.memberId, mid)),
  ]);
  const manual = new Set(manualRows.map((r) => r.milestone));

  const auto: Record<string, boolean> = {
    profile_complete: !!(member.company && member.title),
    first_meeting: Number(attended.at(0)?.n ?? 0) > 0,
    buddy_assigned: Number(buddy.at(0)?.n ?? 0) > 0,
    pod_placed: Number(pod.at(0)?.n ?? 0) > 0,
    pod_meeting: Number(session.at(0)?.n ?? 0) > 0,
  };

  const milestones: OnboardingMilestone[] = ONBOARDING_MILESTONES.map((m) => ({
    key: m.key, label: m.label, stage: m.stage, auto: m.auto,
    done: m.auto ? (auto[m.key] ?? false) : manual.has(m.key),
  }));

  const doneCount = milestones.filter((m) => m.done).length;
  const total = milestones.length;
  const dayCount = Math.max(0, Math.floor((Date.now() - new Date(member.joinedAt).getTime()) / DAY));
  const stage = dayCount <= 30 ? 1 : dayCount <= 60 ? 2 : 3;
  return {
    milestones, doneCount, total,
    percent: Math.round((doneCount / total) * 100),
    dayCount: Math.min(dayCount, ONBOARDING_DAYS + 999), stage,
    complete: doneCount === total,
  };
}
