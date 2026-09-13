import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import { withTransaction } from "../queries/transaction";
import { nextDocumentNumber } from "../queries/invoicing";
import { logger } from "./log";

/** System user id for scheduler-written rows (invoices.userId is NOT NULL and
 *  carries no FK; 0 = "the platform"). */
const SYSTEM_USER_ID = 0;

async function getConfig(key: string): Promise<string | null> {
  const row = (
    await getDb()
      .select({ value: schema.appConfig.value })
      .from(schema.appConfig)
      .where(eq(schema.appConfig.key, key))
      .limit(1)
  ).at(0);
  return row?.value ?? null;
}

/** Previous calendar month as { period: "YYYY-MM", from, to }. */
export function previousMonth(now = new Date()) {
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const from = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() - 1, 1));
  const to = first;
  const period = `${from.getUTCFullYear()}-${String(from.getUTCMonth() + 1).padStart(2, "0")}`;
  return { period, from, to };
}

export type RoyaltyConfig = { enabled: boolean; pct: number };

export async function royaltyConfig(): Promise<RoyaltyConfig> {
  const enabled = (await getConfig("royalty.enabled")) === "true";
  const pctRaw = Number(await getConfig("royalty.pct"));
  const pct = Number.isFinite(pctRaw) ? Math.min(Math.max(pctRaw, 0), 100) : 10;
  return { enabled, pct };
}

/**
 * Franchise royalty invoicing (V4-B4). Runs monthly; fully idempotent — an
 * existing invoice for (chapter, period) is never duplicated, so the
 * scheduler can re-run freely.
 *
 * Royalty base = the chapter's share of paid platform revenue collected in
 * the period (payments by members whose home chapter is the chapter).
 */
export async function jobFranchiseRoyalty(now = new Date()): Promise<{
  invoiced: number;
  skipped: number;
  period: string;
}> {
  const cfg = await royaltyConfig();
  const { period, from, to } = previousMonth(now);
  if (!cfg.enabled) return { invoiced: 0, skipped: 0, period };

  const db = getDb();
  const chapters = await db
    .select({ id: schema.chapters.id, name: schema.chapters.name })
    .from(schema.chapters)
    .where(inArray(schema.chapters.status, ["chartered", "mature", "at_risk"]));

  let invoiced = 0;
  let skipped = 0;

  for (const ch of chapters) {
    /* Monthly chapter revenue: paid payments by members of this chapter. */
    const revenue = (
      await db
        .select({ total: sql<number>`coalesce(sum(${schema.paymentRecords.amount}),0)` })
        .from(schema.paymentRecords)
        .innerJoin(
          schema.members,
          eq(schema.members.userId, schema.paymentRecords.userId)
        )
        .where(
          and(
            eq(schema.members.homeChapterId, ch.id),
            eq(schema.paymentRecords.status, "paid"),
            gte(schema.paymentRecords.paidAt, from),
            lt(schema.paymentRecords.paidAt, to)
          )
        )
    ).at(0);
    const revenueAed = Number(revenue?.total ?? 0) / 100;
    if (revenueAed <= 0) {
      skipped++;
      continue;
    }
    const royaltyAed = Math.round(revenueAed * cfg.pct) / 1;
    if (royaltyAed <= 0) {
      skipped++;
      continue;
    }

    /* Idempotency: one royalty invoice per (chapter, period), ever. */
    const existing = (
      await db
        .select({ id: schema.invoices.id })
        .from(schema.invoices)
        .where(
          and(
            eq(schema.invoices.royaltyPeriod, period),
            eq(schema.invoices.payerName, ch.name)
          )
        )
        .limit(1)
    ).at(0);
    if (existing) {
      skipped++;
      continue;
    }

    const amountMinor = Math.round(royaltyAed * 100);
    await withTransaction(async tx => {
      const invoiceNumber = await nextDocumentNumber(tx, "INV", now);
      await tx.insert(schema.invoices).values({
        userId: SYSTEM_USER_ID,
        payerName: ch.name,
        invoiceNumber,
        amount: amountMinor,
        currency: "aed",
        status: "open",
        billedAt: now,
        dueAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
        royaltyPeriod: period,
        lineItems: [
          {
            label: `Franchise royalty — ${period} (${cfg.pct}% of AED ${revenueAed.toLocaleString()} chapter revenue)`,
            quantity: 1,
            amount: amountMinor,
          },
        ],
      });
    });
    invoiced++;
    logger.info(`franchise royalty invoiced: ${ch.name} ${period} AED ${royaltyAed}`, {
      chapterId: ch.id,
      period,
    });
  }

  return { invoiced, skipped, period };
}
