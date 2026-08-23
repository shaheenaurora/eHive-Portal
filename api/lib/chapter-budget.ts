import { eq, and, isNull, inArray, ne } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";

/**
 * Compute how much approved chapter budget is still uncommitted for events.
 *
 * Approved income = allocation + sponsorship rows with status 'approved'.
 * Approved outgo   = spend rows with status 'approved'.
 * Committed events = sum of event.costAed for non-deleted chapter events.
 *
 * When checking an update, pass the event id as `excludeEventId` so its own
 * cost doesn't count against the remaining budget.
 */
export async function chapterEventBudgetRemaining(
  chapterId: number,
  excludeEventId?: number
): Promise<number> {
  const db = getDb();

  const [incomeRows, spendRows, eventRows] = await Promise.all([
    db
      .select({ amount: schema.chapterBudgets.amount })
      .from(schema.chapterBudgets)
      .where(
        and(
          eq(schema.chapterBudgets.chapterId, chapterId),
          eq(schema.chapterBudgets.status, "approved"),
          inArray(schema.chapterBudgets.kind, ["allocation", "sponsorship"])
        )
      ),
    db
      .select({ amount: schema.chapterBudgets.amount })
      .from(schema.chapterBudgets)
      .where(
        and(
          eq(schema.chapterBudgets.chapterId, chapterId),
          eq(schema.chapterBudgets.status, "approved"),
          eq(schema.chapterBudgets.kind, "spend")
        )
      ),
    db
      .select({ costAed: schema.events.costAed })
      .from(schema.events)
      .where(
        and(
          eq(schema.events.chapterId, chapterId),
          isNull(schema.events.deletedAt),
          ...(excludeEventId ? [ne(schema.events.id, excludeEventId)] : [])
        )
      ),
  ]);

  const allocated = incomeRows.reduce((sum, r) => sum + (r.amount ?? 0), 0);
  const spent = spendRows.reduce((sum, r) => sum + (r.amount ?? 0), 0);
  const committedEvents = eventRows.reduce(
    (sum, r) => sum + (r.costAed ?? 0),
    0
  );

  return allocated - spent - committedEvents;
}
