import { env } from "./env";
import { sendMailDetailed, mailEnabled } from "./mailer";

/* Human labels + confirmation copy per marketing form (public/app.js, the
   clarity scorecard, etc.). Anything not listed falls back to a generic note. */
const FORM_META: Record<
  string,
  { label: string; subject: string; intro: string }
> = {
  newsletter: {
    label: "Newsletter signup",
    subject: "You're on the eHive Journal list",
    intro:
      "Thanks for subscribing to the eHive Journal. You'll be among the first to get our essays on building, scaling and running businesses in the UAE.",
  },
  "get-started": {
    label: "Get Started enquiry",
    subject: "We've received your enquiry — eHive",
    intro:
      "Thanks for reaching out. We've received your enquiry and a member of the eHive team will get back to you within one working day.",
  },
  booking: {
    label: "Session booking request",
    subject: "Your eHive session request",
    intro:
      "Thanks for booking time with eHive. We've received your request and will confirm the slot by email shortly — you'll get a calendar invite once it's locked in.",
  },
  "calculator-breakdown": {
    label: "Business-setup estimate",
    subject: "Your UAE business setup estimate — eHive",
    intro:
      "Thanks for using our business-setup calculator. Your estimate is summarised below — reply to this email and we'll help you turn it into a concrete plan.",
  },
  "clarity-scorecard": {
    label: "Clarity Scorecard",
    subject: "Your eHive Clarity Scorecard results",
    intro:
      "Thank you for completing the eHive Clarity Scorecard. Your results are summarised below. One of our advisors will follow up with the recommended next step for your business.",
  },
  "brand-check": {
    label: "Brand Check",
    subject: "Thanks for completing the eHive Brand Check",
    intro:
      "Thank you for completing the eHive Brand Check. Once we've been through your answers, we'll share what we're seeing — where things are genuinely solid, and where the biggest opportunity sits. No cost, no obligation.",
  },
};

const GENERIC = {
  label: "Website lead",
  subject: "Thanks for reaching out — eHive",
  intro:
    "Thanks for getting in touch with eHive. We've received your details and will be in touch soon.",
};

const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] as string
  );

const prettyKey = (k: string) =>
  k.replace(/[_-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());

/* Keys that are plumbing rather than something a human wants to read. */
const HIDDEN_KEYS = new Set([
  "form",
  "source_page",
  "user_agent",
  "referrer",
  "timestamp",
]);

/** Brand Check "sections" → grouped question/answer rows (kept out of JSON.stringify). */
function sectionRows(sections: unknown[]): string {
  return sections
    .map(s => {
      if (!s || typeof s !== "object") return "";
      const sec = s as Record<string, unknown>;
      const head = `<tr><td colspan="2" style="padding:14px 12px 4px;color:#b8862e;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700">${esc(sec.title)}</td></tr>`;
      const items = Array.isArray(sec.items)
        ? (sec.items as unknown[])
            .map(it => {
              if (!it || typeof it !== "object") return "";
              const r = it as Record<string, unknown>;
              return `<tr>
                <td style="padding:6px 12px;color:#5d6f82;font-size:13px;vertical-align:top;width:48%">${esc(r.q)}</td>
                <td style="padding:6px 12px;color:#101d2c;font-size:14px;font-weight:600;white-space:pre-wrap">${esc(r.a)}</td>
              </tr>`;
            })
            .join("")
        : "";
      return head + items;
    })
    .join("");
}

/** One email-safe horizontal bar: a track table with a single fill cell whose
 *  width is the percentage. Uses nested tables + inline styles (Gmail-safe). */
function barCell(pct: number, weak: boolean): string {
  const w = Math.max(3, Math.min(100, Math.round(pct)));
  const fill = weak ? "#c0603a" : "#b8862e"; // terracotta flags a weak area, gold otherwise
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background:#eaddc4;border-radius:6px;">
    <tr><td style="width:${w}%;height:11px;background:${fill};border-radius:6px;font-size:0;line-height:0;">&nbsp;</td><td style="font-size:0;line-height:0;">&nbsp;</td></tr>
  </table>`;
}

/** Clarity Scorecard "domains" → a graphical per-area bar chart (never raw JSON). */
function domainRows(domains: unknown[]): string {
  const head = `<tr><td colspan="3" style="padding:16px 12px 6px;color:#b8862e;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700">Score by area</td></tr>`;
  const items = domains
    .map(d => {
      if (!d || typeof d !== "object") return "";
      const o = d as Record<string, unknown>;
      const pct =
        typeof o.pct === "number"
          ? o.pct
          : typeof o.raw === "number"
            ? Math.round((o.raw / 10) * 100)
            : 0;
      const weak = pct < 50;
      return `<tr>
        <td style="padding:6px 12px;color:#5d6f82;font-size:13px;white-space:nowrap;vertical-align:middle;width:130px">${esc(o.key)}</td>
        <td style="padding:6px 8px;vertical-align:middle;">${barCell(pct, weak)}</td>
        <td style="padding:6px 12px;color:${weak ? "#c0603a" : "#101d2c"};font-size:13px;font-weight:700;text-align:right;vertical-align:middle;width:44px">${pct}%</td>
      </tr>`;
    })
    .join("");
  return head + items;
}

function fieldRows(payload: Record<string, unknown>): string {
  return Object.entries(payload)
    .filter(([k, v]) => !HIDDEN_KEYS.has(k) && v !== "" && v != null)
    .map(([k, v]) => {
      if (k === "sections" && Array.isArray(v)) return sectionRows(v);
      if (k === "domains" && Array.isArray(v)) return domainRows(v);
      if (k === "total") {
        const n = Number(v) || 0;
        return `<tr><td colspan="3" style="padding:14px 12px 4px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background:#101d2c;border-radius:10px;">
            <tr>
              <td style="padding:16px 20px;color:#f5efe2;font-size:13px;letter-spacing:.1em;text-transform:uppercase;">Overall clarity score</td>
              <td style="padding:16px 20px;text-align:right;color:#ffffff;font-family:Georgia,serif;font-size:30px;font-weight:700;white-space:nowrap;">${n}<span style="font-size:16px;color:#c9b487;"> / 100</span></td>
            </tr>
          </table>
        </td></tr>`;
      }
      const val = typeof v === "object" ? JSON.stringify(v) : String(v);
      return `<tr>
        <td style="padding:6px 12px;color:#5d6f82;font-size:13px;white-space:nowrap;vertical-align:top">${esc(prettyKey(k))}</td>
        <td colspan="2" style="padding:6px 12px;color:#101d2c;font-size:14px;font-weight:600">${esc(val)}</td>
      </tr>`;
    })
    .join("");
}

function shell(bodyHtml: string): string {
  return `<div style="margin:0;padding:24px;background:#faf7f1;font-family:Inter,Arial,sans-serif">
    <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #efe9dd;border-radius:14px;overflow:hidden">
      <div style="background:#101d2c;padding:18px 24px">
        <span style="color:#f5efe2;font-family:Georgia,serif;font-size:18px;font-weight:600">eHive</span>
        <span style="color:#9aa7b6;font-size:11px;letter-spacing:.14em;text-transform:uppercase;margin-left:8px">Circle</span>
      </div>
      <div style="padding:24px">${bodyHtml}</div>
      <div style="padding:16px 24px;border-top:1px solid #efe9dd;color:#8a97a6;font-size:12px">
        eHive · Dubai, UAE · <a href="https://ehiveglobal.com" style="color:#b8862e;text-decoration:none">ehiveglobal.com</a>
      </div>
    </div>
  </div>`;
}

/**
 * Fire owner notification + submitter confirmation for a captured lead.
 * Returns the per-side delivery status so the request handler can tell the
 * frontend whether the confirmation email actually went out.
 */
export async function notifyLead(input: {
  form: string;
  email: string | null;
  payload: Record<string, unknown>;
  sourcePage: string | null;
}): Promise<{
  ok: boolean;
  ownerSent: boolean;
  confirmSent: boolean;
  error?: string;
}> {
  if (!mailEnabled()) {
    return {
      ok: false,
      ownerSent: false,
      confirmSent: false,
      error: "Email is not configured.",
    };
  }
  const meta = FORM_META[input.form] ?? GENERIC;
  const rows = fieldRows(input.payload);

  let ownerSent = false;
  let confirmSent = false;
  const errors: string[] = [];

  // 1) Notify the business.
  const notifyTo = env.leadNotifyEmail;
  if (notifyTo) {
    const ownerHtml = shell(`
      <p style="margin:0 0 4px;color:#b8862e;font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:700">New lead · ${esc(meta.label)}</p>
      <h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:20px;color:#101d2c;font-weight:600">${esc(input.email || "New enquiry")}</h1>
      <table style="width:100%;border-collapse:collapse;background:#faf7f1;border-radius:10px">${rows}</table>
      ${input.sourcePage ? `<p style="margin:16px 0 0;color:#8a97a6;font-size:12px">From: ${esc(input.sourcePage)}</p>` : ""}
    `);
    const r = await sendMailDetailed({
      to: notifyTo,
      subject: `New eHive lead — ${meta.label}${input.email ? ` (${input.email})` : ""}`,
      html: ownerHtml,
      replyTo: input.email || undefined,
    });
    ownerSent = r.ok;
    if (!r.ok && r.error) errors.push(r.error);
  }

  // 2) Confirm to the person who filled the form (if they gave an email).
  if (input.email) {
    const name =
      typeof input.payload.name === "string"
        ? input.payload.name.split(" ")[0]
        : "";
    const confirmHtml = shell(`
      <h1 style="margin:0 0 12px;font-family:Georgia,serif;font-size:22px;color:#101d2c;font-weight:600">${name ? `Thank you, ${esc(name)}.` : "Thank you."}</h1>
      <p style="margin:0 0 18px;color:#33465e;font-size:15px;line-height:1.55">${esc(meta.intro)}</p>
      ${
        rows
          ? `<p style="margin:0 0 8px;color:#5d6f82;font-size:12px;letter-spacing:.1em;text-transform:uppercase;font-weight:700">What you sent us</p>
      <table style="width:100%;border-collapse:collapse;background:#faf7f1;border-radius:10px">${rows}</table>`
          : ""
      }
      <p style="margin:20px 0 0;color:#33465e;font-size:14px;line-height:1.55">Warm regards,<br/><strong>The eHive team</strong></p>
    `);
    const r = await sendMailDetailed({
      to: input.email,
      subject: meta.subject,
      html: confirmHtml,
      replyTo: notifyTo || undefined,
    });
    confirmSent = r.ok;
    if (!r.ok && r.error) errors.push(r.error);
  }

  const ok = ownerSent && (!input.email || confirmSent);
  return {
    ok,
    ownerSent,
    confirmSent,
    error: errors.length ? errors.join("; ") : undefined,
  };
}
