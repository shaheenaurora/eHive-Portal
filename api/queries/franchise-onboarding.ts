import { and, eq, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";
import {
  evaluateFranchiseReadiness,
  readinessScore,
} from "../lib/franchise-readiness";

export async function ensureFranchiseOnboarding(chapterId: number) {
  const db = getDb();
  const chapter = (
    await db
      .select({
        id: schema.chapters.id,
        status: schema.chapters.status,
        charterDate: schema.chapters.charterDate,
        zoneId: schema.chapters.zoneId,
      })
      .from(schema.chapters)
      .where(eq(schema.chapters.id, chapterId))
      .limit(1)
  ).at(0);
  if (!chapter) return;

  const [[memberRow], roles, budgetRows, cadenceRows] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.members)
      .where(eq(schema.members.homeChapterId, chapterId)),
    db
      .select({ role: schema.chapterRoles.role })
      .from(schema.chapterRoles)
      .where(
        and(
          eq(schema.chapterRoles.chapterId, chapterId),
          eq(schema.chapterRoles.status, "active")
        )
      ),
    db
      .select({ amount: schema.chapterBudgets.amount })
      .from(schema.chapterBudgets)
      .where(
        and(
          eq(schema.chapterBudgets.chapterId, chapterId),
          eq(schema.chapterBudgets.status, "approved"),
          eq(schema.chapterBudgets.kind, "allocation")
        )
      ),
    db
      .select({ id: schema.cadences.id })
      .from(schema.cadences)
      .where(
        and(
          eq(schema.cadences.chapterId, chapterId),
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
    approvedBudgetAed: budgetRows.reduce((s, r) => s + (r.amount ?? 0), 0),
    activeCadenceCount: cadenceRows.length,
  });

  const existing = await db
    .select({ itemKey: schema.franchiseOnboardingChecklists.itemKey })
    .from(schema.franchiseOnboardingChecklists)
    .where(eq(schema.franchiseOnboardingChecklists.chapterId, chapterId));
  const existingKeys = new Set(existing.map(r => r.itemKey));

  for (const item of items) {
    if (existingKeys.has(item.key)) continue;
    await db.insert(schema.franchiseOnboardingChecklists).values({
      chapterId,
      itemKey: item.key,
      label: item.label,
      status: item.ok ? "done" : "pending",
    });
  }
}

export async function listFranchiseOnboarding(chapterId: number) {
  await ensureFranchiseOnboarding(chapterId);
  return getDb()
    .select()
    .from(schema.franchiseOnboardingChecklists)
    .where(eq(schema.franchiseOnboardingChecklists.chapterId, chapterId))
    .orderBy(schema.franchiseOnboardingChecklists.createdAt);
}

export async function updateFranchiseOnboardingItem(
  chapterId: number,
  itemKey: string,
  patch: {
    status?: "pending" | "in_progress" | "done" | "skipped";
    assignedMemberId?: number | null;
    dueAt?: Date | null;
    notes?: string | null;
  }
) {
  const db = getDb();
  await db
    .update(schema.franchiseOnboardingChecklists)
    .set({
      ...patch,
      completedAt:
        patch.status === "done"
          ? new Date()
          : patch.status != null
            ? null
            : undefined,
    })
    .where(
      and(
        eq(schema.franchiseOnboardingChecklists.chapterId, chapterId),
        eq(schema.franchiseOnboardingChecklists.itemKey, itemKey)
      )
    );
}

export { readinessScore };
