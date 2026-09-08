import { and, eq, inArray, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";

/* Follow-up SLA for the leads CRM (mirrors LEAD_SLA_HOURS in the scheduler):
   a "new" lead is due 24h after capture; a "contacted" lead is due 72h after
   its last touch. Won/lost/qualified leads are never "due". */
export const LEAD_NEW_SLA_HOURS = 24;
export const LEAD_CONTACTED_SLA_HOURS = 72;

/** SQL predicate selecting leads whose follow-up is overdue. A manually
 *  scheduled nextFollowUpAt wins; otherwise the age-based SLA applies
 *  (new >24h, contacted >72h). */
export function followUpDueCond(now: Date) {
  const newCutoff = new Date(
    now.getTime() - LEAD_NEW_SLA_HOURS * 60 * 60 * 1000
  );
  const contactedCutoff = new Date(
    now.getTime() - LEAD_CONTACTED_SLA_HOURS * 60 * 60 * 1000
  );
  return and(
    inArray(schema.leads.status, ["new", "contacted"]),
    sql`(
        (${schema.leads.nextFollowUpAt} is not null AND ${schema.leads.nextFollowUpAt} <= ${now})
        OR (${schema.leads.nextFollowUpAt} is null AND (
          (${schema.leads.status} = 'new' AND ${schema.leads.createdAt} <= ${newCutoff})
          OR (${schema.leads.status} = 'contacted' AND ${schema.leads.updatedAt} <= ${contactedCutoff})
        ))
      )`
  );
}

/**
 * Pick an owner for a freshly captured lead: any admin who can work the CRM
 * (full admin or holding the "finance" scope, where the leads CRM lives),
 * load-balanced by fewest open (new/contacted) leads. Deterministic tie-break
 * on lowest user id. Returns null when no eligible admin exists — the lead
 * stays unassigned rather than failing capture.
 */
export async function pickLeadOwner(): Promise<number | null> {
  const db = getDb();
  const candidates = await db
    .select({
      id: schema.users.id,
      n: sql<number>`(
        select count(*) from ${schema.leads}
        where ${schema.leads.ownerUserId} = ${schema.users.id}
          and ${schema.leads.status} in ('new','contacted')
      )`,
    })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.role, "admin"),
        sql`(${schema.users.adminScopes} = '' OR ${schema.users.adminScopes} = '*'
          OR ${schema.users.adminScopes} LIKE '%finance%')`
      )
    )
    .orderBy(sql`n asc, ${schema.users.id} asc`);
  return candidates.at(0)?.id ?? null;
}

/** Count of leads currently past their follow-up SLA. */
export async function countFollowUpDue(now = new Date()): Promise<number> {
  const rows = await getDb()
    .select({ n: sql<number>`count(*)` })
    .from(schema.leads)
    .where(followUpDueCond(now));
  return Number(rows.at(0)?.n ?? 0);
}

/** Best-effort product attribution for a lead (drives pipeline value by offer). */
export function leadProduct(
  lead: { form: string; payload: string | null },
  recommendation: string | null
): string {
  if (lead.form === "clarity-scorecard" && recommendation)
    return recommendation;
  if (lead.form === "brand-check") return "Brand 3D";
  try {
    const p = JSON.parse(lead.payload ?? "{}") as Record<string, unknown>;
    if (typeof p.product === "string" && p.product) return p.product;
  } catch {
    /* fall through */
  }
  return lead.form;
}

/** Consulting pipeline value — won leads reconciled against invoiced/paid
 *  cash, attributed by product. Powers the Admin Reports pipeline-value view. */
export async function leadPipelineReport() {
  const rows = await getDb()
    .select({
      lead: schema.leads,
      invoice: schema.invoices,
      recommendation: schema.scorecardResults.recommendationProduct,
    })
    .from(schema.leads)
    .leftJoin(schema.invoices, eq(schema.invoices.leadId, schema.leads.id))
    .leftJoin(
      schema.scorecardResults,
      eq(schema.scorecardResults.leadId, schema.leads.id)
    )
    .where(eq(schema.leads.status, "won"));

  const byProduct = new Map<
    string,
    { won: number; invoicedMinor: number; paidMinor: number }
  >();
  let invoicedMinor = 0;
  let paidMinor = 0;
  for (const r of rows) {
    const product = leadProduct(r.lead, r.recommendation);
    const bucket = byProduct.get(product) ?? {
      won: 0,
      invoicedMinor: 0,
      paidMinor: 0,
    };
    bucket.won += 1;
    if (r.invoice) {
      bucket.invoicedMinor += Number(r.invoice.amount);
      invoicedMinor += Number(r.invoice.amount);
      if (r.invoice.status === "paid") {
        bucket.paidMinor += Number(r.invoice.amount);
        paidMinor += Number(r.invoice.amount);
      }
    }
    byProduct.set(product, bucket);
  }
  return {
    won: rows.length,
    invoicedMinor,
    paidMinor,
    byProduct: [...byProduct.entries()]
      .map(([product, v]) => ({ product, ...v }))
      .sort((a, b) => b.invoicedMinor - a.invoicedMinor),
  };
}
