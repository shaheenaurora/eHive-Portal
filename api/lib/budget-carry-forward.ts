/**
 * Fiscal year-end budget carry-forward.
 *
 * At the start of a new year, any chapter that ended the previous year with a
 * positive operating surplus (approved allocations minus approved/spent
 * expenses) receives an automatic allocation row for the new year so unspent
 * money is not lost. The operation is idempotent: it skips chapters that already
 * have a carry-forward allocation for the target year.
 */

import { and, eq, inArray, lte, ne, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import { logger } from "./log";
import { fiscalYearRange } from "./chapter-pnl";

export type CarryForwardResult = {
  year: number;
  processed: number;
  carried: number;
  skipped: number;
};

/** Return the surplus (approved allocations minus approved/spent expenses)
 *  for a chapter up to and including the given date. */
async function chapterSurplusUpTo(
  chapterId: number,
  upTo: Date
): Promise<number> {
  const db = getDb();
  const [allocRows, spendRows] = await Promise.all([
    db
      .select({ amount: schema.chapterBudgets.amount })
      .from(schema.chapterBudgets)
      .where(
        and(
          eq(schema.chapterBudgets.chapterId, chapterId),
          eq(schema.chapterBudgets.status, "approved"),
          eq(schema.chapterBudgets.kind, "allocation"),
          lte(schema.chapterBudgets.createdAt, upTo)
        )
      ),
    db
      .select({ amount: schema.chapterBudgets.amount })
      .from(schema.chapterBudgets)
      .where(
        and(
          eq(schema.chapterBudgets.chapterId, chapterId),
          inArray(schema.chapterBudgets.status, ["approved", "spent"]),
          eq(schema.chapterBudgets.kind, "spend"),
          lte(schema.chapterBudgets.createdAt, upTo)
        )
      ),
  ]);
  const allocated = allocRows.reduce((s, r) => s + (r.amount ?? 0), 0);
  const spent = spendRows.reduce((s, r) => s + (r.amount ?? 0), 0);
  return allocated - spent;
}

/**
 * Run the carry-forward pass for the calendar year that `now` falls into.
 * The surplus is calculated as of the last moment of the previous year.
 */
export async function carryForwardBudgets(
  now = new Date()
): Promise<CarryForwardResult> {
  const db = getDb();
  const currentYear = now.getUTCFullYear();
  const previousYear = currentYear - 1;
  const { to: previousYearEnd } = fiscalYearRange(previousYear);

  // Find chapters that already have a carry-forward allocation for the current
  // year so we never double-create.
  const existing = await db
    .select({ chapterId: schema.chapterBudgets.chapterId })
    .from(schema.chapterBudgets)
    .where(
      and(
        eq(schema.chapterBudgets.kind, "allocation"),
        eq(schema.chapterBudgets.status, "approved"),
        sql`${schema.chapterBudgets.label} like ${`Carried forward from FY${previousYear}%`}`,
        sql`${schema.chapterBudgets.createdAt} >= ${new Date(
          `${currentYear}-01-01T00:00:00.000Z`
        )}`
      )
    );
  const existingChapterIds = new Set(existing.map(r => r.chapterId));

  const chapters = await db
    .select({ id: schema.chapters.id, name: schema.chapters.name })
    .from(schema.chapters)
    .where(ne(schema.chapters.status, "seed"));

  let carried = 0;
  let skipped = 0;
  for (const chapter of chapters) {
    if (existingChapterIds.has(chapter.id)) {
      skipped++;
      continue;
    }
    const surplus = await chapterSurplusUpTo(chapter.id, previousYearEnd);
    if (surplus > 0) {
      await db.insert(schema.chapterBudgets).values({
        chapterId: chapter.id,
        label: `Carried forward from FY${previousYear}`,
        kind: "allocation",
        amount: surplus,
        status: "approved",
        note: `Year-end surplus automatically carried forward into FY${currentYear}`,
      });
      logger.info(
        `budget carry-forward: ${chapter.name} FY${previousYear} → FY${currentYear} AED ${surplus}`,
        {
          chapterId: chapter.id,
          fromYear: previousYear,
          toYear: currentYear,
          amount: surplus,
        }
      );
      carried++;
    }
  }

  return { year: currentYear, processed: chapters.length, carried, skipped };
}
