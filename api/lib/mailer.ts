import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env";
import { maskEmail } from "./audit";

/** Which transport (if any) is active. ZeptoMail's HTTPS API takes priority —
 *  it works where hosts block outbound SMTP ports. */
export type MailProvider = "zeptomail" | "smtp" | null;
function smtpConfigured(): boolean {
  return !!(env.smtpHost && env.smtpUser && env.smtpPass);
}
export function mailProvider(): MailProvider {
  if (env.zeptoToken) return "zeptomail";
  if (smtpConfigured()) return "smtp";
  return null;
}

/** Email is available when either the ZeptoMail API or SMTP is configured.
 *  Without either the app still runs — leads are stored, mail is skipped. */
export function mailEnabled(): boolean {
  return mailProvider() !== null;
}

let transport: Transporter | null = null;
function getTransport(): Transporter {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      // Port 465 is implicit TLS; 587/others use STARTTLS. Honour explicit flag.
      secure: env.smtpSecure || env.smtpPort === 465,
      auth: { user: env.smtpUser, pass: env.smtpPass },
      // Fail fast instead of hanging ~2min when a host blocks outbound SMTP.
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
    });
  }
  return transport;
}

/** Sender address. For ZeptoMail this must be a verified domain, so we don't
 *  fall back to the SMTP user (which may be unverified in ZeptoMail). */
const fromAddress = () => {
  if (env.mailFrom) return env.mailFrom;
  if (mailProvider() === "smtp") return env.smtpUser || "";
  return "";
};

export type MailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
};

/** Normalize a ZeptoMail token: the API header needs just the token value, but
 *  users often paste the whole `Zoho-enczapikey …` string. Strip the prefix and
 *  whitespace so either form works. */
function zeptoToken(): string {
  return env.zeptoToken.replace(/^Zoho-enczapikey\s*/i, "").replace(/\s+/g, "");
}

/** Send via Zoho ZeptoMail's REST API over HTTPS. Surfaces the API's error text
 *  so misconfiguration (unverified sender, bad token) is diagnosable. */
async function sendViaZepto(
  input: MailInput
): Promise<{ ok: boolean; error?: string }> {
  const from = fromAddress();
  if (!from)
    return {
      ok: false,
      error: "Set MAIL_FROM to a sender address verified in ZeptoMail.",
    };
  const token = zeptoToken();
  if (!token)
    return {
      ok: false,
      error: "ZEPTOMAIL_TOKEN is empty.",
    };
  let res: Response;
  try {
    res = await fetch(env.zeptoApiUrl, {
      method: "POST",
      headers: {
        Authorization: `Zoho-enczapikey ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        from: { address: from, name: "eHive" },
        to: [{ email_address: { address: input.to } }],
        subject: input.subject,
        htmlbody: input.html,
        textbody: input.text ?? htmlToText(input.html),
        ...(input.replyTo ? { reply_to: [{ address: input.replyTo }] } : {}),
      }),
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  const bodyText = await res.text().catch(() => "");
  if (res.ok) return { ok: true };
  // Log the raw response (with recipient masked) so production logs capture
  // the full ZeptoMail rejection reason even if parsing fails.
  console.warn(
    "[mail] ZeptoMail rejected send to",
    maskEmail(input.to),
    "— status:",
    res.status,
    "body:",
    bodyText.slice(0, 1000)
  );
  let detail = `${res.status} ${res.statusText}`;
  try {
    const j = JSON.parse(bodyText) as {
      message?: string;
      error?: { message?: string };
      details?: { message?: string; target?: string }[];
      data?: { message?: string };
    };
    detail = j.message || j.error?.message || j.data?.message || detail;
    if (j.details?.length)
      detail +=
        " — " +
        j.details
          .map(d => d.message || d.target || "")
          .filter(Boolean)
          .join("; ");
  } catch {
    if (bodyText) detail = bodyText.slice(0, 300);
  }
  return { ok: false, error: `ZeptoMail: ${detail}` };
}

/** Single delivery path used by both sendMail and the admin test send. Routes
 *  to ZeptoMail when configured, otherwise SMTP. Returns the real error text. */
async function deliver(
  input: MailInput
): Promise<{ ok: boolean; error?: string }> {
  const provider = mailProvider();
  if (provider === "zeptomail") return sendViaZepto(input);
  if (provider === "smtp") {
    try {
      await getTransport().sendMail({
        from: `eHive <${fromAddress()}>`,
        to: input.to,
        subject: input.subject,
        text: input.text ?? htmlToText(input.html),
        html: input.html,
        replyTo: input.replyTo,
      });
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
  return { ok: false, error: "No email transport configured." };
}

/** Send one email and return the real transport result (including any error
 *  message). Never throws so callers can decide whether to surface the failure. */
export async function sendMailDetailed(
  input: MailInput
): Promise<{ ok: boolean; error?: string }> {
  if (!mailEnabled()) {
    console.warn(
      "[mail] skipped (email not configured):",
      input.subject,
      "->",
      maskEmail(input.to)
    );
    return { ok: false, error: "Email is not configured." };
  }
  return deliver(input);
}

/** Send one email. Never throws — logs and returns false on failure so a mail
 *  hiccup can't break the request that triggered it. */
export async function sendMail(input: MailInput): Promise<boolean> {
  const r = await sendMailDetailed(input);
  if (!r.ok) console.error("[mail] send failed:", r.error);
  return r.ok;
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Non-secret view of the mail configuration for the admin panel. Never exposes
 *  the SMTP password or the ZeptoMail token. */
export function mailStatus() {
  const provider = mailProvider();
  return {
    configured: provider !== null,
    provider,
    host: provider === "zeptomail" ? env.zeptoApiUrl : env.smtpHost || null,
    port: env.smtpPort,
    secure: env.smtpSecure || env.smtpPort === 465,
    user: env.smtpUser || null,
    from: env.mailFrom || env.smtpUser || null,
    notifyTo: env.leadNotifyEmail || null,
  };
}

/**
 * Send a one-off test email so an admin can verify email end-to-end from the
 * portal. Unlike sendMail this surfaces the real transport error (auth, port,
 * unverified sender…) so setup problems are diagnosable without server logs.
 */
export async function sendTestEmail(
  to: string
): Promise<{ ok: boolean; error?: string }> {
  const provider = mailProvider();
  if (!provider) {
    return {
      ok: false,
      error:
        "Email isn't configured yet. Set ZEPTOMAIL_TOKEN (recommended), or SMTP_HOST/SMTP_USER/SMTP_PASS, then try again.",
    };
  }
  const via =
    provider === "zeptomail"
      ? "ZeptoMail API"
      : `${env.smtpHost}:${env.smtpPort}`;
  const html = `<div style="font-family:Inter,Arial,sans-serif;padding:24px;background:#faf7f1">
    <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #efe9dd;border-radius:14px;overflow:hidden">
      <div style="background:#101d2c;padding:18px 24px"><span style="color:#f5efe2;font-family:Georgia,serif;font-size:18px;font-weight:600">eHive</span></div>
      <div style="padding:24px;color:#33465e;font-size:15px;line-height:1.55">
        <h1 style="font-family:Georgia,serif;font-size:20px;color:#101d2c;margin:0 0 12px">Your email is working ✓</h1>
        <p style="margin:0">This is a test message from your eHive portal. If it reached your inbox, outbound
        email (lead alerts, member confirmations, verification and password-reset emails) is configured correctly.</p>
        <p style="margin:16px 0 0;color:#8a97a6;font-size:12px">Sent from ${esc(fromAddress())} · ${esc(via)}</p>
      </div>
    </div>
  </div>`;
  return deliver({
    to,
    subject: "eHive test email — your email is working",
    text: "Your eHive portal email is working. If you can read this, outbound email is configured correctly.",
    html,
  });
}

const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] as string
  );
