import { and, desc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import * as schema from "@db/schema";
import type { InvoiceLineItem } from "@db/schema";
import { getDb } from "./connection";
import type { withTransaction } from "./transaction";

/** Transaction handle passed from withTransaction. */
type Tx = Parameters<Parameters<typeof withTransaction>[0]>[0];

function todayStamp(d = new Date()) {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

function pad(n: number) {
  return String(n).padStart(4, "0");
}

/**
 * Atomically reserve the next daily sequence for a document prefix.
 * Uses an INSERT ... ON DUPLICATE KEY UPDATE so concurrent writers increment
 * the same counter row safely.
 */
export async function nextDocumentNumber(
  tx: Tx,
  prefix: "INV" | "CN",
  d = new Date()
): Promise<string> {
  const date = todayStamp(d);
  await tx
    .insert(schema.invoiceCounters)
    .values({ prefix, date, sequence: 1 })
    .onDuplicateKeyUpdate({
      set: { sequence: sql`${schema.invoiceCounters.sequence} + 1` },
    });
  const row = (
    await tx
      .select({ sequence: schema.invoiceCounters.sequence })
      .from(schema.invoiceCounters)
      .where(
        and(
          eq(schema.invoiceCounters.prefix, prefix),
          eq(schema.invoiceCounters.date, date)
        )
      )
      .limit(1)
  ).at(0);
  if (!row) {
    throw new Error(`Failed to reserve ${prefix} sequence for ${date}`);
  }
  return `${prefix}-${date}-${pad(row.sequence)}`;
}

/** Build default line items for a settled payment. */
export function buildInvoiceLineItems(payment: {
  purpose: string;
  tier: string | null;
  amount: number;
  note?: string | null;
}): InvoiceLineItem[] {
  const label = payment.tier
    ? `${payment.purpose} — ${payment.tier}`
    : payment.purpose;
  return [
    {
      label,
      description: payment.note || undefined,
      quantity: 1,
      amount: payment.amount,
    },
  ];
}

/** Resolve the memberId that belongs to a user, if any. */
async function memberIdForUser(tx: Tx, userId: number): Promise<number | null> {
  const row = (
    await tx
      .select({ id: schema.members.id })
      .from(schema.members)
      .where(eq(schema.members.userId, userId))
      .limit(1)
  ).at(0);
  return row?.id ?? null;
}

export type CreatedInvoice = {
  id: number;
  invoiceNumber: string;
  amount: number;
  currency: string;
};

/**
 * Create a paid invoice for a settled payment. Used by manual payment recording
 * and the Stripe webhook. Returns the generated invoice id/number.
 */
export async function createInvoiceFromPayment(
  tx: Tx,
  paymentRecord: {
    id: number;
    userId: number;
    purpose: string;
    tier: string | null;
    amount: number;
    currency: string;
    note?: string | null;
    paidAt?: Date | null;
  },
  opts: { status?: "open" | "paid"; dueDays?: number } = {}
): Promise<CreatedInvoice> {
  const status = opts.status ?? "paid";
  const billedAt = paymentRecord.paidAt ?? new Date();
  const dueAt =
    status === "paid"
      ? undefined
      : new Date(
          billedAt.getTime() + (opts.dueDays ?? 14) * 24 * 60 * 60 * 1000
        );
  const invoiceNumber = await nextDocumentNumber(tx, "INV", billedAt);
  const memberId = await memberIdForUser(tx, paymentRecord.userId);
  const lineItems = buildInvoiceLineItems(paymentRecord);

  const res = await tx.insert(schema.invoices).values({
    paymentRecordId: paymentRecord.id,
    memberId,
    userId: paymentRecord.userId,
    invoiceNumber,
    amount: paymentRecord.amount,
    currency: paymentRecord.currency,
    status,
    billedAt,
    dueAt,
    lineItems,
  });
  const id = Number((res as unknown as { insertId?: number }).insertId ?? 0);
  return {
    id,
    invoiceNumber,
    amount: paymentRecord.amount,
    currency: paymentRecord.currency,
  };
}

export type CreatedCreditNote = {
  id: number;
  creditNoteNumber: string;
  amount: number;
  currency: string;
};

/**
 * Create a credit note for a refund. If an invoice exists for the payment it is
 * linked for traceability.
 */
export async function createCreditNoteFromRefund(
  tx: Tx,
  paymentRecord: {
    id: number;
    userId: number;
    amount: number;
    currency: string;
  },
  refundAmount: number,
  reason: string
): Promise<CreatedCreditNote> {
  const invoice = (
    await tx
      .select({ id: schema.invoices.id })
      .from(schema.invoices)
      .where(eq(schema.invoices.paymentRecordId, paymentRecord.id))
      .limit(1)
  ).at(0);
  const creditNoteNumber = await nextDocumentNumber(tx, "CN");
  const memberId = await memberIdForUser(tx, paymentRecord.userId);

  const res = await tx.insert(schema.creditNotes).values({
    paymentRecordId: paymentRecord.id,
    invoiceId: invoice?.id ?? null,
    memberId,
    userId: paymentRecord.userId,
    creditNoteNumber,
    amount: refundAmount,
    currency: paymentRecord.currency,
    reason,
  });
  const id = Number((res as unknown as { insertId?: number }).insertId ?? 0);
  return {
    id,
    creditNoteNumber,
    amount: refundAmount,
    currency: paymentRecord.currency,
  };
}

export type InvoiceRow = {
  id: number;
  paymentRecordId: number;
  memberId: number | null;
  userId: number;
  invoiceNumber: string;
  amount: number;
  currency: string;
  status: string;
  billedAt: Date;
  dueAt: Date | null;
  payerName: string | null;
  payerEmail: string | null;
  lineItems: InvoiceLineItem[];
  createdAt: Date;
};

/** List invoices newest first, with an optional status filter. */
export async function listInvoices(
  opts: { status?: string; limit?: number } = {}
): Promise<InvoiceRow[]> {
  const db = getDb();
  const wheres = [];
  if (opts.status)
    wheres.push(eq(schema.invoices.status, opts.status as never));
  const rows = await db
    .select({
      id: schema.invoices.id,
      paymentRecordId: schema.invoices.paymentRecordId,
      memberId: schema.invoices.memberId,
      userId: schema.invoices.userId,
      invoiceNumber: schema.invoices.invoiceNumber,
      amount: schema.invoices.amount,
      currency: schema.invoices.currency,
      status: schema.invoices.status,
      billedAt: schema.invoices.billedAt,
      dueAt: schema.invoices.dueAt,
      payerName: schema.users.name,
      payerEmail: schema.users.email,
      createdAt: schema.invoices.createdAt,
    })
    .from(schema.invoices)
    .leftJoin(schema.users, eq(schema.users.id, schema.invoices.userId))
    .where(wheres.length ? and(...wheres) : undefined)
    .orderBy(desc(schema.invoices.createdAt))
    .limit(opts.limit ?? 200);
  return rows as InvoiceRow[];
}

/** Fetch a single invoice with payer details. */
export async function getInvoiceById(id: number) {
  const db = getDb();
  const row = (
    await db
      .select({
        invoice: schema.invoices,
        payerName: schema.users.name,
        payerEmail: schema.users.email,
      })
      .from(schema.invoices)
      .leftJoin(schema.users, eq(schema.users.id, schema.invoices.userId))
      .where(eq(schema.invoices.id, id))
      .limit(1)
  ).at(0);
  if (!row)
    throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found." });
  return row;
}

export type CreditNoteRow = {
  id: number;
  paymentRecordId: number;
  invoiceId: number | null;
  memberId: number | null;
  userId: number;
  creditNoteNumber: string;
  amount: number;
  currency: string;
  reason: string;
  payerName: string | null;
  payerEmail: string | null;
  createdAt: Date;
};

/** List credit notes newest first. */
export async function listCreditNotes(
  opts: { limit?: number } = {}
): Promise<CreditNoteRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.creditNotes.id,
      paymentRecordId: schema.creditNotes.paymentRecordId,
      invoiceId: schema.creditNotes.invoiceId,
      memberId: schema.creditNotes.memberId,
      userId: schema.creditNotes.userId,
      creditNoteNumber: schema.creditNotes.creditNoteNumber,
      amount: schema.creditNotes.amount,
      currency: schema.creditNotes.currency,
      reason: schema.creditNotes.reason,
      payerName: schema.users.name,
      payerEmail: schema.users.email,
      createdAt: schema.creditNotes.createdAt,
    })
    .from(schema.creditNotes)
    .leftJoin(schema.users, eq(schema.users.id, schema.creditNotes.userId))
    .orderBy(desc(schema.creditNotes.createdAt))
    .limit(opts.limit ?? 200);
  return rows as CreditNoteRow[];
}

/** Fetch a single credit note with payer details. */
export async function getCreditNoteById(id: number) {
  const db = getDb();
  const row = (
    await db
      .select({
        creditNote: schema.creditNotes,
        payerName: schema.users.name,
        payerEmail: schema.users.email,
      })
      .from(schema.creditNotes)
      .leftJoin(schema.users, eq(schema.users.id, schema.creditNotes.userId))
      .where(eq(schema.creditNotes.id, id))
      .limit(1)
  ).at(0);
  if (!row)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Credit note not found.",
    });
  return row;
}

const aed = (fils: number) =>
  "AED " +
  (fils / 100).toLocaleString("en-AE", {
    minimumFractionDigits: Number.isInteger(fils / 100) ? 0 : 2,
    maximumFractionDigits: 2,
  });

function esc(s: string | null | undefined) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Render a printable server-side HTML invoice. The page includes a print CTA and
 * is styled with inline CSS so it works without the SPA bundle.
 */
export function renderInvoiceHtml(invoice: {
  invoiceNumber: string;
  billedAt: Date;
  dueAt: Date | null;
  status: string;
  amount: number;
  currency: string;
  lineItems: InvoiceLineItem[];
  payerName: string | null;
  payerEmail: string | null;
}): string {
  const date = (d: Date) =>
    new Date(d).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

  const lineRows = invoice.lineItems
    .map(
      li => `
    <tr>
      <td>${esc(li.label)}${li.description ? `<br><span class="desc">${esc(li.description)}</span>` : ""}</td>
      <td class="num">${li.quantity ?? 1}</td>
      <td class="num">${aed(li.amount)}</td>
      <td class="num">${aed(li.amount * (li.quantity ?? 1))}</td>
    </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice ${esc(invoice.invoiceNumber)} — eHive</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;padding:0;font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#fff;color:#141312;line-height:1.45}
    .page{max-width:800px;margin:0 auto;padding:48px 40px}
    header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:40px}
    .brand{font-weight:800;font-size:1.5rem;letter-spacing:-0.02em}
    .brand span{color:#b8862e}
    .doc{text-align:right}
    .doc h1{margin:0;font-size:1.75rem;font-weight:700}
    .doc .num{color:#6b675d;font-size:.95rem;margin-top:4px}
    .meta{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:40px}
    .box{padding:18px;background:#f7f5ef;border-radius:10px}
    .box h2{margin:0 0 8px;font-size:.8rem;text-transform:uppercase;letter-spacing:.1em;color:#8a857a;font-weight:600}
    .box p{margin:0}
    table{width:100%;border-collapse:collapse;margin:24px 0}
    th{text-align:left;padding:12px 8px;border-bottom:2px solid #e3dfd5;font-size:.75rem;text-transform:uppercase;letter-spacing:.08em;color:#8a857a;font-weight:600}
    td{padding:14px 8px;border-bottom:1px solid #efe9dd;vertical-align:top}
    td.num, th.num{text-align:right;white-space:nowrap}
    .desc{color:#6b675d;font-size:.9rem}
    .total{display:flex;justify-content:flex-end;align-items:center;gap:16px;margin-top:24px;padding-top:18px;border-top:2px solid #e3dfd5}
    .total .label{font-size:.9rem;color:#6b675d}
    .total .amount{font-size:1.6rem;font-weight:800}
    .status{display:inline-block;padding:4px 10px;border-radius:20px;font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;background:#e8f5e9;color:#2e7d5b}
    .status.void{background:#f5f5f5;color:#6b675d}
    .status.open{background:#fff3e0;color:#b8862e}
    .cta{margin-top:40px;text-align:center}
    button{background:#101d2c;color:#f5efe2;border:0;padding:12px 24px;border-radius:8px;font-size:.95rem;font-weight:600;cursor:pointer}
    button:hover{background:#1a2d42}
    @media print{
      .cta{display:none}
      body{padding:0}
      .page{max-width:none;padding:0}
    }
  </style>
</head>
<body>
  <div class="page">
    <header>
      <div class="brand">eHive <span>Circle</span></div>
      <div class="doc">
        <h1>Tax Invoice</h1>
        <div class="num">${esc(invoice.invoiceNumber)}</div>
        <span class="status ${esc(invoice.status)}">${esc(invoice.status)}</span>
      </div>
    </header>
    <section class="meta">
      <div class="box">
        <h2>Billed to</h2>
        <p><strong>${esc(invoice.payerName ?? "—")}</strong></p>
        <p>${esc(invoice.payerEmail ?? "—")}</p>
      </div>
      <div class="box">
        <h2>Invoice details</h2>
        <p><strong>Date:</strong> ${date(invoice.billedAt)}</p>
        ${invoice.dueAt ? `<p><strong>Due:</strong> ${date(invoice.dueAt)}</p>` : ""}
        <p><strong>Currency:</strong> ${esc(invoice.currency.toUpperCase())}</p>
      </div>
    </section>
    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th class="num">Qty</th>
          <th class="num">Unit</th>
          <th class="num">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${lineRows}
      </tbody>
    </table>
    <div class="total">
      <span class="label">Total</span>
      <span class="amount">${aed(invoice.amount)}</span>
    </div>
    <div class="cta">
      <button onclick="window.print()">Print / Save as PDF</button>
    </div>
  </div>
</body>
</html>`;
}
