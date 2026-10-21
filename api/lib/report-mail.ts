import { env } from "./env";
import { sendMailDetailed, mailEnabled } from "./mailer";
import {
  REPORT_TOOLS,
  REPORT_TOOL_LABEL,
  type ReportTool,
} from "@contracts/constants";

/* Paid assessment-report emails: the unlock email a customer gets when their
   full report is paid for, and the owner-inbox notification when someone
   requests an invoice instead of card payment. Deliberately a separate file
   from lead-mail.ts — these are transactional purchase emails, not lead
   nurture, and the flow that sends them lives in api/report-routes.ts and the
   Stripe webhook branch in api/boot.ts. Template style mirrors lead-mail.ts
 * (its shell() is module-private, so a local copy keeps the same look). */

const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] as string
  );

function shell(bodyHtml: string): string {
  return `<div style="margin:0;padding:24px;background:#faf7f1;font-family:Inter,Arial,sans-serif">
    <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #efe9dd;border-radius:14px;overflow:hidden">
      <div style="background:#101d2c;padding:18px 24px">
        <span style="color:#f5efe2;font-family:Georgia,serif;font-size:18px;font-weight:600">eHive</span>
        <span style="color:#9aa7b6;font-size:11px;letter-spacing:.14em;text-transform:uppercase;margin-left:8px">Circle</span>
      </div>
      <div style="padding:24px">${bodyHtml}</div>
      <div style="padding:16px 24px;border-top:1px solid #efe9dd;color:#8a97a6;font-size:12px">
        eHive · Dubai, UAE · <a href="${env.publicUrl}" style="color:#b8862e;text-decoration:none">${env.publicUrl.replace(/^https:\/\//, "")}</a>
      </div>
    </div>
  </div>`;
}

/** Tool label for any stored slug (rows in the DB predate constant changes). */
function labelFor(tool: string): string {
  return (REPORT_TOOLS as readonly string[]).includes(tool)
    ? REPORT_TOOL_LABEL[tool as ReportTool]
    : tool;
}

/** The tool page a report link points at (`brand-check` → brand-check.html). */
export function reportToolPage(tool: string): string {
  return `${tool}.html`;
}

/**
 * Unlock email — sent when a report checkout settles (Stripe webhook). The
 * link carries the report token + unlocked=1 so the tool page opens the full
 * report. Non-fatal: delivery failure is reported, never thrown.
 */
export async function sendReportUnlocked(input: {
  email: string;
  name: string | null;
  tool: string;
  token: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!mailEnabled()) {
    return { ok: false, error: "Email is not configured." };
  }
  const label = labelFor(input.tool);
  const reportUrl = `${env.publicUrl}/${reportToolPage(input.tool)}?report=${encodeURIComponent(input.token)}&unlocked=1`;
  const first = input.name ? esc(input.name.split(" ")[0]) : "";
  const html = shell(`
    <h1 style="margin:0 0 12px;font-family:Georgia,serif;font-size:22px;color:#101d2c;font-weight:600">${first ? `Hi ${first},` : "Hi there,"}</h1>
    <p style="margin:0 0 18px;color:#33465e;font-size:15px;line-height:1.55">Thank you for your payment. Your full <strong style="color:#101d2c">${esc(label)}</strong> report is ready — the complete breakdown, every dimension, and the recommended next steps.</p>
    <p style="margin:20px 0 0"><a href="${reportUrl}" style="display:inline-block;background:#101d2c;color:#f5efe2;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">View your full report →</a></p>
    <p style="margin:18px 0 0;color:#5d6f82;font-size:13px;line-height:1.55">This link is private to you — it works for a full year. If it ever stops opening your report, just complete the ${esc(label)} again and we'll refresh it.</p>
    <p style="margin:20px 0 0;color:#33465e;font-size:14px;line-height:1.55">Warm regards,<br/><strong>The eHive team</strong><br/><a href="mailto:info@ehiveglobal.com" style="color:#b8862e;text-decoration:none">info@ehiveglobal.com</a></p>
  `);
  const r = await sendMailDetailed({
    to: input.email,
    subject: "Your full eHive report is ready",
    html,
    replyTo: env.leadNotifyEmail || undefined,
  });
  return { ok: r.ok, error: r.error };
}

/**
 * Post-assessment summary email — the owner wants the mail SHORT (a summary)
 * with the full designed PDF attached, not the detailed in-line results the
 * generic lead confirmation used to carry. Sent once per report, after the
 * client has generated + uploaded the PDF (we send without attachment if the
 * upload never arrived, with the online link as the fallback).
 */
export async function sendReportSummary(input: {
  tool: string;
  email: string;
  name: string | null;
  total: number;
  band: string | null;
  weakestDimLabel: string | null;
  productLabel: string | null;
  token: string;
  pdfBase64: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!mailEnabled()) {
    return { ok: false, error: "Email is not configured." };
  }
  const label = labelFor(input.tool);
  const first = input.name ? esc(input.name.split(" ")[0]) : "";
  const reportUrl = `${env.publicUrl}/${reportToolPage(input.tool)}?report=${encodeURIComponent(input.token)}`;
  const bandLine = input.band
    ? `You scored <strong style="color:#101d2c">${esc(input.total)}/100 — ${esc(input.band)}</strong>.`
    : `You scored <strong style="color:#101d2c">${esc(input.total)}/100</strong>.`;
  const readLine = input.pdfBase64
    ? `Your full report is <strong>attached as a PDF</strong> — your dimension-by-dimension analysis, watch-outs and your 90-day roadmap.`
    : `Your full report — dimension-by-dimension analysis, watch-outs and your 90-day roadmap — is ready:`;
  const weakestLine = input.weakestDimLabel
    ? `Your clearest gap sits in <strong style="color:#101d2c">${esc(input.weakestDimLabel)}</strong>${
        input.productLabel
          ? ` — and the most direct next step from here is ${esc(input.productLabel)}`
          : ""
      }.`
    : "";
  const html = shell(`
    <h1 style="margin:0 0 12px;font-family:Georgia,serif;font-size:22px;color:#101d2c;font-weight:600">${first ? `Hi ${first},` : "Hi there,"}</h1>
    <p style="margin:0 0 14px;color:#33465e;font-size:15px;line-height:1.55">Thank you for completing the eHive ${esc(label)}. ${bandLine}</p>
    ${weakestLine ? `<p style="margin:0 0 14px;color:#33465e;font-size:15px;line-height:1.55">${weakestLine}</p>` : ""}
    <p style="margin:0 0 18px;color:#33465e;font-size:15px;line-height:1.55">${readLine}</p>
    <p style="margin:20px 0 0"><a href="${reportUrl}" style="display:inline-block;background:#101d2c;color:#f5efe2;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">Open your report online →</a></p>
    <p style="margin:20px 0 0;color:#33465e;font-size:14px;line-height:1.55">If you'd like to talk any of it through, reply to this email or book a free discovery call at <a href="${env.publicUrl}/book.html" style="color:#b23a2e;text-decoration:underline">${env.publicUrl.replace(/^https:\/\//, "")}/book.html</a>.</p>
    <p style="margin:20px 0 0;color:#33465e;font-size:14px;line-height:1.55">Warm regards,<br/><strong>The eHive team</strong><br/><a href="mailto:info@ehiveglobal.com" style="color:#b8862e;text-decoration:none">info@ehiveglobal.com</a></p>
  `);
  const r = await sendMailDetailed({
    to: input.email,
    subject: `Your eHive ${label} report`,
    html,
    replyTo: env.leadNotifyEmail || undefined,
    ...(input.pdfBase64
      ? {
          attachments: [
            {
              filename: `ehive-${input.tool}-report.pdf`,
              content: Buffer.from(input.pdfBase64, "base64"),
              contentType: "application/pdf",
            },
          ],
        }
      : {}),
  });
  return { ok: r.ok, error: r.error };
}

/**
 * Owner notification for the invoice path — a customer asked to be invoiced
 * for the full report instead of paying by card. Plain summary to the lead
 * inbox with reply-to set to the requester so the team can reply directly.
 */
export async function sendReportInvoiceRequested(input: {
  tool: string;
  email: string;
  name: string | null;
  token: string;
}): Promise<{ ok: boolean; error?: string }> {
  const notifyTo = env.leadNotifyEmail;
  if (!notifyTo || !mailEnabled()) {
    return { ok: false, error: "Email is not configured." };
  }
  const label = labelFor(input.tool);
  const reportUrl = `${env.publicUrl}/${reportToolPage(input.tool)}?report=${encodeURIComponent(input.token)}`;
  const html = shell(`
    <p style="margin:0 0 4px;color:#b8862e;font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:700">Full report requested</p>
    <h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:20px;color:#101d2c;font-weight:600">${esc(label)} — ${esc(input.email)}</h1>
    <table style="width:100%;border-collapse:collapse;background:#faf7f1;border-radius:10px">
      <tr><td style="padding:6px 12px;color:#5d6f82;font-size:13px">Tool</td><td style="padding:6px 12px;color:#101d2c;font-size:14px;font-weight:600">${esc(label)}</td></tr>
      <tr><td style="padding:6px 12px;color:#5d6f82;font-size:13px">Email</td><td style="padding:6px 12px;color:#101d2c;font-size:14px;font-weight:600">${esc(input.email)}</td></tr>
      ${input.name ? `<tr><td style="padding:6px 12px;color:#5d6f82;font-size:13px">Name</td><td style="padding:6px 12px;color:#101d2c;font-size:14px;font-weight:600">${esc(input.name)}</td></tr>` : ""}
      <tr><td style="padding:6px 12px;color:#5d6f82;font-size:13px;vertical-align:top">Report</td><td style="padding:6px 12px;color:#101d2c;font-size:14px;font-weight:600"><a href="${reportUrl}" style="color:#b23a2e;text-decoration:underline">Open their saved report</a></td></tr>
    </table>
    <p style="margin:16px 0 0;color:#33465e;font-size:14px;line-height:1.55">They chose "request an invoice" on the results page — reply to this email to arrange payment, then mark the report paid once it settles.</p>
  `);
  const r = await sendMailDetailed({
    to: notifyTo,
    subject: `Full report requested — ${label} — ${input.email}`,
    html,
    replyTo: input.email,
  });
  return { ok: r.ok, error: r.error };
}
