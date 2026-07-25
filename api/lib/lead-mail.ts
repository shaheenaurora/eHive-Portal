import { env } from "./env";
import { sendMail, mailEnabled } from "./mailer";

/* Human labels + confirmation copy per marketing form (public/app.js, the
   clarity scorecard, etc.). Anything not listed falls back to a generic note. */
const FORM_META: Record<string, { label: string; subject: string; intro: string }> = {
  newsletter: {
    label: "Newsletter signup",
    subject: "You're on the eHive Journal list",
    intro: "Thanks for subscribing to the eHive Journal. You'll be among the first to get our essays on building, scaling and running businesses in the UAE.",
  },
  "get-started": {
    label: "Get Started enquiry",
    subject: "We've received your enquiry — eHive",
    intro: "Thanks for reaching out. We've received your enquiry and a member of the eHive team will get back to you within one working day.",
  },
  booking: {
    label: "Session booking request",
    subject: "Your eHive session request",
    intro: "Thanks for booking time with eHive. We've received your request and will confirm the slot by email shortly — you'll get a calendar invite once it's locked in.",
  },
  "calculator-breakdown": {
    label: "Business-setup estimate",
    subject: "Your UAE business setup estimate — eHive",
    intro: "Thanks for using our business-setup calculator. Your estimate is summarised below — reply to this email and we'll help you turn it into a concrete plan.",
  },
  "clarity-scorecard": {
    label: "Clarity Scorecard",
    subject: "Your eHive Clarity Scorecard results",
    intro: "Thank you for completing the eHive Clarity Scorecard. Your results are summarised below. One of our advisors will follow up with the recommended next step for your business.",
  },
};

const GENERIC = {
  label: "Website lead",
  subject: "Thanks for reaching out — eHive",
  intro: "Thanks for getting in touch with eHive. We've received your details and will be in touch soon.",
};

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

const prettyKey = (k: string) =>
  k.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/* Keys that are plumbing rather than something a human wants to read. */
const HIDDEN_KEYS = new Set(["form", "source_page", "user_agent", "referrer", "timestamp"]);

function fieldRows(payload: Record<string, unknown>): string {
  return Object.entries(payload)
    .filter(([k, v]) => !HIDDEN_KEYS.has(k) && v !== "" && v != null)
    .map(([k, v]) => {
      const val = typeof v === "object" ? JSON.stringify(v) : String(v);
      return `<tr>
        <td style="padding:6px 12px;color:#5d6f82;font-size:13px;white-space:nowrap;vertical-align:top">${esc(prettyKey(k))}</td>
        <td style="padding:6px 12px;color:#101d2c;font-size:14px;font-weight:600">${esc(val)}</td>
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
 * Fire-and-forget from the request handler; never throws.
 */
export async function notifyLead(input: {
  form: string;
  email: string | null;
  payload: Record<string, unknown>;
  sourcePage: string | null;
}): Promise<void> {
  if (!mailEnabled()) return;
  const meta = FORM_META[input.form] ?? GENERIC;
  const rows = fieldRows(input.payload);

  // 1) Notify the business.
  const notifyTo = env.leadNotifyEmail;
  if (notifyTo) {
    const ownerHtml = shell(`
      <p style="margin:0 0 4px;color:#b8862e;font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:700">New lead · ${esc(meta.label)}</p>
      <h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:20px;color:#101d2c;font-weight:600">${esc(input.email || "New enquiry")}</h1>
      <table style="width:100%;border-collapse:collapse;background:#faf7f1;border-radius:10px">${rows}</table>
      ${input.sourcePage ? `<p style="margin:16px 0 0;color:#8a97a6;font-size:12px">From: ${esc(input.sourcePage)}</p>` : ""}
    `);
    await sendMail({
      to: notifyTo,
      subject: `New eHive lead — ${meta.label}${input.email ? ` (${input.email})` : ""}`,
      html: ownerHtml,
      replyTo: input.email || undefined,
    });
  }

  // 2) Confirm to the person who filled the form (if they gave an email).
  if (input.email) {
    const name = typeof input.payload.name === "string" ? input.payload.name.split(" ")[0] : "";
    const confirmHtml = shell(`
      <h1 style="margin:0 0 12px;font-family:Georgia,serif;font-size:22px;color:#101d2c;font-weight:600">${name ? `Thank you, ${esc(name)}.` : "Thank you."}</h1>
      <p style="margin:0 0 18px;color:#33465e;font-size:15px;line-height:1.55">${esc(meta.intro)}</p>
      ${rows ? `<p style="margin:0 0 8px;color:#5d6f82;font-size:12px;letter-spacing:.1em;text-transform:uppercase;font-weight:700">What you sent us</p>
      <table style="width:100%;border-collapse:collapse;background:#faf7f1;border-radius:10px">${rows}</table>` : ""}
      <p style="margin:20px 0 0;color:#33465e;font-size:14px;line-height:1.55">Warm regards,<br/><strong>The eHive team</strong></p>
    `);
    await sendMail({
      to: input.email,
      subject: meta.subject,
      html: confirmHtml,
      replyTo: notifyTo || undefined,
    });
  }
}
