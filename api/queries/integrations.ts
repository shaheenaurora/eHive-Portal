/**
 * Data access for the read-only integration API. Keyset pagination by ascending
 * id (cursor = last id seen) plus an optional `updatedSince` filter so an
 * external ERP can do incremental syncs. Payments and members carry a real
 * updatedAt (bumped on every change, including status/refund updates); chapter
 * expenses are append-oriented and filter on createdAt.
 */
import { and, asc, eq, gt, gte, isNotNull } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";
import type {
  IntegrationPaymentRow,
  IntegrationExpenseRow,
  IntegrationMemberRow,
} from "../lib/integration";

export interface PageOpts {
  cursor?: number;
  limit: number;
  updatedSince?: Date;
}

export async function fetchPayments(
  opts: PageOpts
): Promise<IntegrationPaymentRow[]> {
  const db = getDb();
  const conds = [gt(schema.paymentRecords.id, opts.cursor ?? 0)];
  if (opts.updatedSince)
    conds.push(gte(schema.paymentRecords.updatedAt, opts.updatedSince));
  const rows = await db
    .select({
      id: schema.paymentRecords.id,
      userId: schema.paymentRecords.userId,
      provider: schema.paymentRecords.provider,
      providerRef: schema.paymentRecords.providerRef,
      purpose: schema.paymentRecords.purpose,
      tier: schema.paymentRecords.tier,
      amount: schema.paymentRecords.amount,
      currency: schema.paymentRecords.currency,
      status: schema.paymentRecords.status,
      refundedAmount: schema.paymentRecords.refundedAmount,
      paidAt: schema.paymentRecords.paidAt,
      refundedAt: schema.paymentRecords.refundedAt,
      createdAt: schema.paymentRecords.createdAt,
      updatedAt: schema.paymentRecords.updatedAt,
      payerName: schema.users.name,
      payerEmail: schema.users.email,
      consentAt: schema.users.consentAt,
    })
    .from(schema.paymentRecords)
    .leftJoin(schema.users, eq(schema.users.id, schema.paymentRecords.userId))
    .where(and(...conds))
    .orderBy(asc(schema.paymentRecords.id))
    .limit(opts.limit);
  return rows as IntegrationPaymentRow[];
}

export async function fetchExpenses(
  opts: PageOpts
): Promise<IntegrationExpenseRow[]> {
  const db = getDb();
  const conds = [
    gt(schema.chapterBudgets.id, opts.cursor ?? 0),
    eq(schema.chapterBudgets.kind, "spend"),
  ];
  if (opts.updatedSince)
    conds.push(gte(schema.chapterBudgets.createdAt, opts.updatedSince));
  const rows = await db
    .select({
      id: schema.chapterBudgets.id,
      chapterId: schema.chapterBudgets.chapterId,
      label: schema.chapterBudgets.label,
      category: schema.chapterBudgets.category,
      amount: schema.chapterBudgets.amount,
      status: schema.chapterBudgets.status,
      note: schema.chapterBudgets.note,
      createdAt: schema.chapterBudgets.createdAt,
    })
    .from(schema.chapterBudgets)
    .where(and(...conds))
    .orderBy(asc(schema.chapterBudgets.id))
    .limit(opts.limit);
  return rows as IntegrationExpenseRow[];
}

export async function fetchMembers(
  opts: PageOpts
): Promise<IntegrationMemberRow[]> {
  const db = getDb();
  const conds = [
    gt(schema.members.id, opts.cursor ?? 0),
    isNotNull(schema.users.consentAt),
  ];
  if (opts.updatedSince)
    conds.push(gte(schema.members.updatedAt, opts.updatedSince));
  const rows = await db
    .select({
      id: schema.members.id,
      userId: schema.members.userId,
      name: schema.users.name,
      email: schema.users.email,
      tier: schema.members.tier,
      status: schema.members.status,
      lifecycleState: schema.members.lifecycleState,
      homeChapterId: schema.members.homeChapterId,
      joinedAt: schema.members.joinedAt,
      updatedAt: schema.members.updatedAt,
    })
    .from(schema.members)
    .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
    .where(and(...conds))
    .orderBy(asc(schema.members.id))
    .limit(opts.limit);
  return rows as IntegrationMemberRow[];
}
