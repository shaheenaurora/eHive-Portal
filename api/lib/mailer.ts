import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env";
import { maskEmail } from "./audit";
import { logger } from "./log";

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

export type MailAttachment = {
  filename: string;
  content: Buffer;
  contentType: string;
};

export type MailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  attachments?: MailAttachment[];
};

/* ---- live delivery health ----
 * ZeptoMail has no cheap "ping" that doesn't spend a credit, so instead of a
 * synthetic probe we track the outcome of real sends. The first hard rejection
 * (e.g. credit exhausted, unverified sender, auth) flips the health check red so
 * /api/health surfaces the outage — the exact failure mode that was previously
 * invisible. A subsequent success clears it. */
type MailHealth = {
  lastOkAt: number | null;
  lastFailAt: number | null;
  lastError: string | null;
  lastVia: MailProvider | "smtp-fallback" | null;
  consecutiveFails: number;
};
const health: MailHealth = {
  lastOkAt: null,
  lastFailAt: null,
  lastError: null,
  lastVia: null,
  consecutiveFails: 0,
};
function recordSendResult(
  ok: boolean,
  via: MailHealth["lastVia"],
  error?: string
): void {
  const now = Date.now();
  health.lastVia = via;
  if (ok) {
    health.lastOkAt = now;
    health.lastError = null;
    health.consecutiveFails = 0;
  } else {
    health.lastFailAt = now;
    health.lastError = error ?? "unknown";
    health.consecutiveFails++;
  }
}
/** Snapshot of live delivery health for the admin panel / health endpoint. */
export function mailHealth(): Readonly<MailHealth> {
  return { ...health };
}

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
        attachments:
          input.attachments?.map(a => ({
            file_name: a.filename,
            file_type: a.contentType,
            file_cache: a.content.toString("base64"),
          })) ?? undefined,
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
  logger.warn("[mail] ZeptoMail rejected send", {
    to: maskEmail(input.to),
    status: res.status,
    body: bodyText.slice(0, 1000),
  });
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

/** Send via the configured SMTP relay (also the fallback for ZeptoMail). */
async function sendViaSmtp(
  input: MailInput
): Promise<{ ok: boolean; error?: string }> {
  const from = fromAddress() || env.smtpUser || "";
  if (!from)
    return { ok: false, error: "Set MAIL_FROM or SMTP_USER for the sender." };
  try {
    await getTransport().sendMail({
      from: `eHive <${from}>`,
      to: input.to,
      subject: input.subject,
      text: input.text ?? htmlToText(input.html),
      html: input.html,
      replyTo: input.replyTo,
      attachments: input.attachments?.map(a => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Single delivery path used by both sendMail and the admin test send. Routes
 *  to ZeptoMail when configured, otherwise SMTP. When ZeptoMail is primary and
 *  rejects a send (credit exhausted, transient 5xx, unverified sender…) and SMTP
 *  is also configured, the message is retried over SMTP so a single-provider
 *  outage doesn't silently drop transactional mail. Records the outcome so the
 *  health check reflects live delivery state. */
async function deliver(
  input: MailInput
): Promise<{ ok: boolean; error?: string }> {
  const provider = mailProvider();
  if (!provider) {
    const r = { ok: false, error: "No email transport configured." };
    recordSendResult(false, null, r.error);
    return r;
  }
  if (provider === "smtp") {
    const r = await sendViaSmtp(input);
    recordSendResult(r.ok, "smtp", r.error);
    return r;
  }
  // provider === "zeptomail"
  const primary = await sendViaZepto(input);
  if (primary.ok) {
    recordSendResult(true, "zeptomail");
    return primary;
  }
  // Primary rejected — fall back to SMTP if it's independently configured.
  if (smtpConfigured()) {
    logger.warn("[mail] ZeptoMail rejected — falling back to SMTP", {
      to: maskEmail(input.to),
      error: primary.error,
    });
    const fallback = await sendViaSmtp(input);
    if (fallback.ok) {
      recordSendResult(true, "smtp-fallback");
      return fallback;
    }
    const combined = {
      ok: false,
      error: `${primary.error} (SMTP fallback also failed: ${fallback.error})`,
    };
    recordSendResult(false, "smtp-fallback", combined.error);
    return combined;
  }
  recordSendResult(false, "zeptomail", primary.error);
  return primary;
}

/** Send one email and return the real transport result (including any error
 *  message). Never throws so callers can decide whether to surface the failure. */
export async function sendMailDetailed(
  input: MailInput
): Promise<{ ok: boolean; error?: string }> {
  if (!mailEnabled()) {
    logger.warn("[mail] skipped (email not configured)", {
      subject: input.subject,
      to: maskEmail(input.to),
    });
    return { ok: false, error: "Email is not configured." };
  }
  return deliver(input);
}

/** Send one email. Never throws — logs and returns false on failure so a mail
 *  hiccup can't break the request that triggered it. */
export async function sendMail(input: MailInput): Promise<boolean> {
  const r = await sendMailDetailed(input);
  if (!r.ok) logger.error("[mail] send failed", { error: r.error });
  return r.ok;
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lightweight transport verification for health checks. Does not send email.
 *  If a recent real send hard-failed (e.g. ZeptoMail credit exhausted), that is
 *  reported as unhealthy — this is what makes an ongoing delivery outage visible
 *  on /api/health instead of silently dropping mail. SMTP is additionally probed
 *  with a short-timeout connection verify so a misconfigured relay is caught even
 *  before the first send. */
export async function verifyMailTransport(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const provider = mailProvider();
  if (!provider) return { ok: false, error: "No email transport configured." };
  // A live delivery failure trumps any static "configured" signal.
  if (health.consecutiveFails > 0)
    return {
      ok: false,
      error: `Last ${health.consecutiveFails} send(s) failed: ${health.lastError ?? "unknown"}`,
    };
  if (provider === "zeptomail") return { ok: true };
  try {
    await Promise.race([
      getTransport().verify(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("SMTP verify timeout")), 5000)
      ),
    ]);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
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
    fallback: provider === "zeptomail" && smtpConfigured() ? "smtp" : null,
    health: {
      lastOkAt: health.lastOkAt
        ? new Date(health.lastOkAt).toISOString()
        : null,
      lastFailAt: health.lastFailAt
        ? new Date(health.lastFailAt).toISOString()
        : null,
      lastError: health.lastError,
      lastVia: health.lastVia,
      consecutiveFails: health.consecutiveFails,
    },
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
