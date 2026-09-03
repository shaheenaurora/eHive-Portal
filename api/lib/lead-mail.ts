import { env } from "./env";
import { sendMailDetailed, mailEnabled } from "./mailer";
import { calendarLinks, generateIcs } from "./ics";

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
  booking: {
    label: "Session booking request",
    subject: "Your eHive session request",
    intro:
      "Thanks for booking time with eHive. We've received your request and will confirm the slot by email shortly — you'll get a calendar invite once it's locked in.",
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
  "membership-application": {
    label: "Membership application",
    subject: "We've received your application — eHive",
    intro:
      "Thank you for applying to join eHive. Our team will review your application and be in touch within a few days. We're glad you're here.",
  },
  "partner-enquiry": {
    label: "Partner enquiry",
    subject: "We've received your partnership enquiry — eHive",
    intro:
      "Thank you for your interest in partnering with eHive. We partner with a select few, so every enquiry is read personally — someone from the partnerships team will be in touch.",
  },
  "franchise-enquiry": {
    label: "Franchise / operator enquiry",
    subject: "We've received your franchise enquiry — eHive",
    intro:
      "Thank you for your interest in bringing eHive to your market. We're selective about who leads a chapter, so we'll review your background and market carefully and be in touch.",
  },
  contact: {
    label: "Contact enquiry",
    subject: "We've received your message — eHive",
    intro:
      "Thanks for getting in touch with eHive. We've received your message and the right person on the team will reply personally.",
  },
};

/* Which enquiry types route to a dedicated owner when one is configured.
   Falls back to the general lead inbox (env.leadNotifyEmail) otherwise. */
const OWNER_ENV: Record<string, string | undefined> = {
  "partner-enquiry": env.partnersNotifyEmail,
  "franchise-enquiry": env.franchiseNotifyEmail,
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
 * Notify a member that their invoice is ready. Non-fatal: a missing mail config
 * or delivery failure is logged but does not block the payment flow.
 */
export async function sendInvoiceReady(input: {
  email: string;
  name: string | null;
  invoiceNumber: string;
  amount: number;
  currency: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!mailEnabled()) {
    return { ok: false, error: "Email is not configured." };
  }
  const firstName = input.name ? esc(input.name.split(" ")[0]) : "";
  const amount =
    input.currency.toUpperCase() +
    " " +
    input.amount.toLocaleString("en-AE", {
      minimumFractionDigits: Number.isInteger(input.amount) ? 0 : 2,
      maximumFractionDigits: 2,
    });
  const body = shell(`
    <h1 style="margin:0 0 12px;font-family:Georgia,serif;font-size:22px;color:#101d2c;font-weight:600">${firstName ? `Hi ${firstName},` : "Hi there,"}</h1>
    <p style="margin:0 0 18px;color:#33465e;font-size:15px;line-height:1.55">Thanks for your payment. Your eHive invoice <strong style="color:#101d2c">${esc(input.invoiceNumber)}</strong> is ready.</p>
    <p style="margin:0 0 18px;color:#33465e;font-size:15px;line-height:1.55">Amount: <strong style="color:#101d2c">${amount}</strong></p>
    <p style="margin:0 0 18px;color:#33465e;font-size:15px;line-height:1.55">You can view and print it from the eHive portal at any time.</p>
    <p style="margin:20px 0 0;color:#33465e;font-size:14px;line-height:1.55">Warm regards,<br/><strong>The eHive team</strong></p>
  `);
  const r = await sendMailDetailed({
    to: input.email,
    subject: `Your eHive invoice ${esc(input.invoiceNumber)}`,
    html: body,
  });
  return { ok: r.ok, error: r.error };
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

  // 1) Notify the business — routed to a dedicated desk when configured.
  const notifyTo = OWNER_ENV[input.form] || env.leadNotifyEmail;
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

/** Alert the owning desk that a high-value enquiry is still un-actioned past its
 *  SLA. High-intent leads convert best with a fast reply, so a lead sitting in
 *  "new" gets one nudge to the partner/franchise inbox. */
export async function sendLeadSlaAlert(input: {
  leadId: number;
  form: string;
  email: string | null;
  payload: Record<string, unknown>;
  ageHours: number;
}): Promise<{ ok: boolean; error?: string }> {
  if (!mailEnabled()) return { ok: false, error: "Email is not configured." };
  const meta = FORM_META[input.form] ?? GENERIC;
  const notifyTo = OWNER_ENV[input.form] || env.leadNotifyEmail;
  if (!notifyTo) return { ok: false, error: "No owner inbox configured." };
  const rows = fieldRows(input.payload);
  const html = shell(`
    <p style="margin:0 0 4px;color:#b23b2e;font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:700">Action needed · still un-actioned</p>
    <h1 style="margin:0 0 12px;font-family:Georgia,serif;font-size:20px;color:#101d2c;font-weight:600">${esc(meta.label)} waiting ${input.ageHours}h</h1>
    <p style="margin:0 0 18px;color:#33465e;font-size:15px;line-height:1.55">This enquiry is still marked “new” ${input.ageHours} hours after it came in. High-intent enquiries convert best with a fast, personal reply — please reach out, or update its status in the admin console so it stops chasing you.</p>
    <table style="width:100%;border-collapse:collapse;background:#faf7f1;border-radius:10px">${rows}</table>
    ${input.email ? `<p style="margin:16px 0 0;color:#8a97a6;font-size:12px">Reply to: ${esc(input.email)}</p>` : ""}
  `);
  return sendMailDetailed({
    to: notifyTo,
    subject: `Un-actioned ${meta.label} (${input.ageHours}h) — eHive`,
    html,
    replyTo: input.email || undefined,
  });
}

/** Send a personalised follow-up to a scorecard submission based on its stored
 *  recommendation. Updates the caller with delivery status so the admin UI can
 *  reflect whether the nurture email actually left the server. */
export async function sendScorecardFollowUp(input: {
  email: string;
  name: string | null;
  total: number;
  recommendationProduct: string | null;
  recommendationWhy: string | null;
  stage: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!mailEnabled()) {
    return { ok: false, error: "Email is not configured." };
  }
  const notifyTo = env.leadNotifyEmail;
  const name = input.name ? esc(input.name.split(" ")[0]) : "";
  const product = esc(
    input.recommendationProduct ?? "the right eHive engagement"
  );
  const why = esc(
    input.recommendationWhy ??
      "Based on your scorecard, we'd recommend a short conversation to confirm the best next step."
  );
  const PRODUCT_SLUG: Record<string, string> = {
    "Clarity Sprint": "clarity-sprint",
    "Strategy Sprint": "strategy-sprint",
    "Brand 3D": "brand-3d",
    OpsBlueprint: "opsblueprint",
    GapNavigator: "gapnavigator",
    Momentum90: "momentum90",
  };
  const slug = PRODUCT_SLUG[input.recommendationProduct ?? ""] ?? "consulting";
  const cta =
    input.stage === "follow_up_1"
      ? `Book your ${product} call →`
      : "Reply and let us know the best time to talk →";
  const subject =
    input.stage === "follow_up_1"
      ? "A quick follow-up on your Clarity Scorecard — eHive"
      : "Still thinking it over? — eHive";
  const bookingUrl = `${env.publicUrl}/book.html?product=${encodeURIComponent(slug)}&src=scorecard`;
  const body = shell(`
    <h1 style="margin:0 0 12px;font-family:Georgia,serif;font-size:22px;color:#101d2c;font-weight:600">${name ? `Hi ${name},` : "Hi there,"}</h1>
    <p style="margin:0 0 18px;color:#33465e;font-size:15px;line-height:1.55">A little while ago you completed the eHive Clarity Scorecard and scored <strong style="color:#101d2c">${input.total}/100</strong>.</p>
    <p style="margin:0 0 18px;color:#33465e;font-size:15px;line-height:1.55">The recommendation that came out of your answers was <strong style="color:#101d2c">${product}</strong>. ${why}</p>
    <p style="margin:0 0 18px;color:#33465e;font-size:15px;line-height:1.55">If that still resonates, the next step is a short conversation — no pitch, just a read of what's actually going on.</p>
    <p style="margin:20px 0 0"><a href="${bookingUrl}" style="display:inline-block;background:#101d2c;color:#f5efe2;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">${cta}</a></p>
    <p style="margin:20px 0 0;color:#33465e;font-size:14px;line-height:1.55">Warm regards,<br/><strong>The eHive team</strong></p>
  `);
  const r = await sendMailDetailed({
    to: input.email,
    subject,
    html: body,
    replyTo: notifyTo || undefined,
  });
  return { ok: r.ok, error: r.error };
}

/** Send a booking request confirmation. The submitter gets a polite "request
 *  received" note; the owner gets the full details so they can confirm manually
 *  until automated calendar sync is wired in. */
export async function sendBookingConfirmation(input: {
  name: string;
  email: string;
  product: string;
  when: string;
  format: string;
  phone?: string | null;
  notes?: string | null;
  confirmed: boolean;
  scheduledAt?: Date | null;
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
  const notifyTo = env.leadNotifyEmail;
  const errors: string[] = [];

  const ownerHtml = shell(`
    <p style="margin:0 0 4px;color:#b8862e;font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:700">New booking request</p>
    <h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:20px;color:#101d2c;font-weight:600">${esc(input.product)} — ${esc(input.email)}</h1>
    <table style="width:100%;border-collapse:collapse;background:#faf7f1;border-radius:10px">
      <tr><td style="padding:6px 12px;color:#5d6f82;font-size:13px">Name</td><td style="padding:6px 12px;color:#101d2c;font-size:14px;font-weight:600">${esc(input.name)}</td></tr>
      <tr><td style="padding:6px 12px;color:#5d6f82;font-size:13px">Email</td><td style="padding:6px 12px;color:#101d2c;font-size:14px;font-weight:600">${esc(input.email)}</td></tr>
      <tr><td style="padding:6px 12px;color:#5d6f82;font-size:13px">When</td><td style="padding:6px 12px;color:#101d2c;font-size:14px;font-weight:600">${esc(input.when)}</td></tr>
      <tr><td style="padding:6px 12px;color:#5d6f82;font-size:13px">Format</td><td style="padding:6px 12px;color:#101d2c;font-size:14px;font-weight:600">${esc(input.format)}</td></tr>
      ${input.phone ? `<tr><td style="padding:6px 12px;color:#5d6f82;font-size:13px">Phone</td><td style="padding:6px 12px;color:#101d2c;font-size:14px;font-weight:600">${esc(input.phone)}</td></tr>` : ""}
      ${input.notes ? `<tr><td style="padding:6px 12px;color:#5d6f82;font-size:13px;vertical-align:top">Notes</td><td style="padding:6px 12px;color:#101d2c;font-size:14px;font-weight:600;white-space:pre-wrap">${esc(input.notes)}</td></tr>` : ""}
    </table>
  `);

  let ownerSent = false;
  if (notifyTo) {
    const r = await sendMailDetailed({
      to: notifyTo,
      subject: `Booking request — ${input.product} (${input.name})`,
      html: ownerHtml,
      replyTo: input.email,
    });
    ownerSent = r.ok;
    if (!r.ok && r.error) errors.push(r.error);
  }

  let confirmSent = false;
  const firstName = input.name.split(" ")[0];

  const calendarExtras =
    input.confirmed && input.scheduledAt
      ? (() => {
          const links = calendarLinks({
            title: `${input.product} — eHive`,
            start: input.scheduledAt,
            durationMin: Number(input.format.match(/^(\d+)/)?.[1] ?? 60),
            location: "eHive — Dubai, UAE (details by email)",
            description: `Confirmed ${input.product} session with eHive.`,
          });
          return `
            <p style="margin:0 0 18px;color:#33465e;font-size:15px;line-height:1.55">Add to your calendar: <a href="${links.google}" style="color:#b23a2e;text-decoration:underline">Google</a> · <a href="${links.outlook}" style="color:#b23a2e;text-decoration:underline">Outlook</a></p>
          `;
        })()
      : "";

  const confirmHtml = shell(`
    <h1 style="margin:0 0 12px;font-family:Georgia,serif;font-size:22px;color:#101d2c;font-weight:600">${firstName ? `Thank you, ${esc(firstName)}.` : "Thank you."}</h1>
    <p style="margin:0 0 18px;color:#33465e;font-size:15px;line-height:1.55">We've received your request for a <strong style="color:#101d2c">${esc(input.product)}</strong> on <strong style="color:#101d2c">${esc(input.when)}</strong>.</p>
    <p style="margin:0 0 18px;color:#33465e;font-size:15px;line-height:1.55">${input.confirmed ? "Your slot is confirmed. A calendar invite (.ics) is attached." : "A member of the team will confirm your slot within one business day and send you a calendar invitation."}</p>
    ${calendarExtras}
    <p style="margin:0 0 18px;color:#33465e;font-size:15px;line-height:1.55">If you need to reschedule, just reply to this email.</p>
    <p style="margin:20px 0 0;color:#33465e;font-size:14px;line-height:1.55">Warm regards,<br/><strong>The eHive team</strong></p>
  `);

  const attachments =
    input.confirmed && input.scheduledAt
      ? [
          {
            filename: "ehive-session.ics",
            content: generateIcs({
              title: `${input.product} — eHive`,
              start: input.scheduledAt,
              durationMin: Number(input.format.match(/^(\d+)/)?.[1] ?? 60),
              location: "eHive — Dubai, UAE (details by email)",
              description: `Confirmed ${input.product} session with eHive.`,
              organizer: notifyTo
                ? { name: "eHive", email: notifyTo }
                : undefined,
              attendee: { name: input.name, email: input.email },
            }),
            contentType: "text/calendar; method=PUBLISH",
          },
        ]
      : undefined;

  const r = await sendMailDetailed({
    to: input.email,
    subject: input.confirmed
      ? `Confirmed — ${input.product} on ${esc(input.when)}`
      : `Booking request received — ${input.product}`,
    html: confirmHtml,
    replyTo: notifyTo || undefined,
    attachments,
  });
  confirmSent = r.ok;
  if (!r.ok && r.error) errors.push(r.error);

  return {
    ok: ownerSent && confirmSent,
    ownerSent,
    confirmSent,
    error: errors.length ? errors.join("; ") : undefined,
  };
}

/** Send a booking cancellation notice to the visitor. */
export async function sendBookingCancellation(input: {
  name: string;
  email: string;
  product: string;
  when: string;
  reason?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!mailEnabled()) {
    return { ok: false, error: "Email is not configured." };
  }
  const firstName = input.name.split(" ")[0];
  const html = shell(`
    <h1 style="margin:0 0 12px;font-family:Georgia,serif;font-size:22px;color:#101d2c;font-weight:600">${firstName ? `Hi ${esc(firstName)},` : "Hi,"}</h1>
    <p style="margin:0 0 18px;color:#33465e;font-size:15px;line-height:1.55">Your <strong style="color:#101d2c">${esc(input.product)}</strong> on <strong style="color:#101d2c">${esc(input.when)}</strong> has been cancelled.</p>
    ${input.reason ? `<p style="margin:0 0 18px;color:#33465e;font-size:15px;line-height:1.55">Reason: ${esc(input.reason)}</p>` : ""}
    <p style="margin:0 0 18px;color:#33465e;font-size:15px;line-height:1.55">If you'd like to reschedule, just reply to this email or book a new time.</p>
    <p style="margin:20px 0 0;color:#33465e;font-size:14px;line-height:1.55">Warm regards,<br/><strong>The eHive team</strong></p>
  `);
  const r = await sendMailDetailed({
    to: input.email,
    subject: `Cancelled — ${input.product}`,
    html,
    replyTo: env.leadNotifyEmail || undefined,
  });
  return { ok: r.ok, error: r.error };
}
