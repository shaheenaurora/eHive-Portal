import { and, desc, eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";

/* Data access for the paid assessment-report flow (Brand Check / Clarity
   Scorecard full reports). The routes in api/report-routes.ts do validation
   and token handling; this layer is plain persistence. One row per
   (tool, email) — enforced by the unique index — so "latest row per tool+email"
   is simply "the row". */

export type AssessmentReportRow = typeof schema.assessmentReports.$inferSelect;

/** Look up the report row for a tool + email. Email is stored lowercased. */
export async function findReportByToolEmail(
  tool: string,
  email: string
): Promise<AssessmentReportRow | undefined> {
  return (
    await getDb()
      .select()
      .from(schema.assessmentReports)
      .where(
        and(
          eq(schema.assessmentReports.tool, tool),
          eq(schema.assessmentReports.email, email.trim().toLowerCase())
        )
      )
      .orderBy(desc(schema.assessmentReports.createdAt))
      .limit(1)
  ).at(0);
}

export async function findReportById(
  id: number
): Promise<AssessmentReportRow | undefined> {
  return (
    await getDb()
      .select()
      .from(schema.assessmentReports)
      .where(eq(schema.assessmentReports.id, id))
      .limit(1)
  ).at(0);
}

export type NewReportData = {
  tool: string;
  token: string;
  email: string;
  contact: unknown;
  answers: unknown;
  dims: unknown;
  total: number;
  band: string | null;
};

export async function insertReport(data: NewReportData): Promise<number> {
  const res = await getDb().insert(schema.assessmentReports).values({
    tool: data.tool,
    token: data.token,
    email: data.email.trim().toLowerCase(),
    contact: data.contact,
    answers: data.answers,
    dims: data.dims,
    total: data.total,
    band: data.band,
  });
  return Number((res as unknown as [{ insertId: number }])[0].insertId);
}

/** Overwrite the assessment data of an existing row. Deliberately does NOT
 *  touch token, paid, or stripeSessionId — a retake keeps the customer's
 *  unlock link and any payment already in flight. */
export async function updateReportData(
  id: number,
  data: Omit<NewReportData, "tool" | "token" | "email">
): Promise<void> {
  await getDb()
    .update(schema.assessmentReports)
    .set({
      contact: data.contact,
      answers: data.answers,
      dims: data.dims,
      total: data.total,
      band: data.band,
    })
    .where(eq(schema.assessmentReports.id, id));
}

/** free → requested (invoice path). Never downgrades an already-paid row. */
export async function markReportRequested(id: number): Promise<void> {
  await getDb()
    .update(schema.assessmentReports)
    .set({ paid: "requested" })
    .where(
      and(
        eq(schema.assessmentReports.id, id),
        eq(schema.assessmentReports.paid, "free")
      )
    );
}

export async function setReportStripeSession(
  id: number,
  stripeSessionId: string
): Promise<void> {
  await getDb()
    .update(schema.assessmentReports)
    .set({ stripeSessionId })
    .where(eq(schema.assessmentReports.id, id));
}

/** Replace the provisional token with the signed access token once the row id
 *  is known (the token payload is `id.exp.hmac`). Called once, right after
 *  insert — afterwards the token never changes. */
export async function setReportToken(id: number, token: string): Promise<void> {
  await getDb()
    .update(schema.assessmentReports)
    .set({ token })
    .where(eq(schema.assessmentReports.id, id));
}

/** Find the report a settled Stripe checkout session belongs to. Report
 *  checkouts store the session id on the row when the session is created, so
 *  the webhook can join a paid event back to its report without trusting
 *  webhook metadata. */
export async function findReportBySession(
  stripeSessionId: string
): Promise<AssessmentReportRow | undefined> {
  return (
    await getDb()
      .select()
      .from(schema.assessmentReports)
      .where(eq(schema.assessmentReports.stripeSessionId, stripeSessionId))
      .limit(1)
  ).at(0);
}

/** Extract a display name from a stored contact JSON blob. */
export function reportContactName(contact: unknown): string | null {
  if (!contact || typeof contact !== "object" || Array.isArray(contact))
    return null;
  const name = (contact as Record<string, unknown>).name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

/** Store (or replace) the base64 PDF for a report — generated client-side and
 *  uploaded so the summary email can attach the exact report the founder saw. */
export async function saveReportPdf(
  id: number,
  pdfBase64: string
): Promise<void> {
  await getDb()
    .update(schema.assessmentReports)
    .set({ pdf: pdfBase64 })
    .where(eq(schema.assessmentReports.id, id));
}

/** One-way mark: the summary email has been sent for this report. */
export async function markReportEmailed(id: number): Promise<void> {
  await getDb()
    .update(schema.assessmentReports)
    .set({ reportEmailedAt: new Date() })
    .where(eq(schema.assessmentReports.id, id));
}
