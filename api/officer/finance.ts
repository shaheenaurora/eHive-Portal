import { z } from "zod";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import { createRouter, authedQuery } from "../middleware";
import { audit } from "../lib/audit";
import {
  listExpenses,
  recordExpense as recordExpenseSvc,
} from "../queries/finance";
import { rollupBudgets } from "../lib/finance-calc";
import { EXPENSE_CATEGORY_KEYS } from "@contracts/constants";
import { requireOfficer, assertRoles } from "./shared";

export const officerFinanceRouter = createRouter({
  chapterFinance: authedQuery.query(async ({ ctx }) => {
    const { chapterId, roleKeys } = await requireOfficer(ctx.user.id);
    assertRoles(
      roleKeys,
      ["treasurer", "president"],
      "Finance actions require Treasurer or President."
    );
    const db = getDb();
    const [budgetRows, expenses] = await Promise.all([
      db
        .select({
          kind: schema.chapterBudgets.kind,
          amount: schema.chapterBudgets.amount,
          status: schema.chapterBudgets.status,
        })
        .from(schema.chapterBudgets)
        .where(eq(schema.chapterBudgets.chapterId, chapterId)),
      listExpenses({ chapterId, limit: 100 }),
    ]);
    return {
      ...rollupBudgets(budgetRows),
      expenses,
    };
  }),

  recordExpense: authedQuery
    .input(
      z.object({
        label: z.string().min(2).max(255),
        amountAed: z.number().positive().max(1_000_000),
        category: z
          .enum(EXPENSE_CATEGORY_KEYS as [string, ...string[]])
          .optional(),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { chapterId, roleKeys } = await requireOfficer(ctx.user.id);
      assertRoles(
        roleKeys,
        ["treasurer", "president"],
        "Finance actions require Treasurer or President."
      );
      const result = await recordExpenseSvc(ctx.user, {
        chapterId,
        label: input.label,
        amountAed: input.amountAed,
        category: input.category,
        note: input.note,
      });
      await audit(ctx.user, "officer.finance.expense", {
        type: "chapterBudget",
        id: chapterId,
        detail: `${input.label} · AED ${input.amountAed}`,
      });
      return result;
    }),
});
