import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env";

/** Email is available only when an SMTP server is configured. Without it the
 *  app still runs — leads are stored, mail is simply skipped (logged once). */
export function mailEnabled(): boolean {
  return !!(env.smtpHost && env.smtpUser && env.smtpPass);
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
    });
  }
  return transport;
}

const fromAddress = () => env.mailFrom || env.smtpUser;

export type MailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
};

/** Send one email. Never throws — logs and returns false on failure so a mail
 *  hiccup can't break the request that triggered it. */
export async function sendMail(input: MailInput): Promise<boolean> {
  if (!mailEnabled()) {
    console.warn("[mail] skipped (SMTP not configured):", input.subject, "->", input.to);
    return false;
  }
  try {
    await getTransport().sendMail({
      from: `eHive <${fromAddress()}>`,
      to: input.to,
      subject: input.subject,
      text: input.text ?? htmlToText(input.html),
      html: input.html,
      replyTo: input.replyTo,
    });
    return true;
  } catch (err) {
    console.error("[mail] send failed:", err);
    return false;
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Non-secret view of the mail configuration for the admin panel. Never exposes
 *  the SMTP password. */
export function mailStatus() {
  return {
    configured: mailEnabled(),
    host: env.smtpHost || null,
    port: env.smtpPort,
    secure: env.smtpSecure || env.smtpPort === 465,
    user: env.smtpUser || null,
    from: env.mailFrom || env.smtpUser || null,
    notifyTo: env.leadNotifyEmail || null,
  };
}

/**
 * Send a one-off test email so an admin can verify SMTP end-to-end from the
 * portal. Unlike sendMail this surfaces the real transport error (auth, port,
 * DNS…) so setup problems are diagnosable without server logs.
 */
export async function sendTestEmail(to: string): Promise<{ ok: boolean; error?: string }> {
  if (!mailEnabled()) {
    return { ok: false, error: "SMTP is not configured yet. Set SMTP_HOST, SMTP_USER and SMTP_PASS, then try again." };
  }
  const html = `<div style="font-family:Inter,Arial,sans-serif;padding:24px;background:#faf7f1">
    <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #efe9dd;border-radius:14px;overflow:hidden">
      <div style="background:#101d2c;padding:18px 24px"><span style="color:#f5efe2;font-family:Georgia,serif;font-size:18px;font-weight:600">eHive</span></div>
      <div style="padding:24px;color:#33465e;font-size:15px;line-height:1.55">
        <h1 style="font-family:Georgia,serif;font-size:20px;color:#101d2c;margin:0 0 12px">Your email is working ✓</h1>
        <p style="margin:0">This is a test message from your eHive portal. If it reached your inbox, outbound
        email (lead alerts, member confirmations, verification and password-reset emails) is configured correctly.</p>
        <p style="margin:16px 0 0;color:#8a97a6;font-size:12px">Sent from ${esc(fromAddress())} · ${esc(env.smtpHost)}:${env.smtpPort}</p>
      </div>
    </div>
  </div>`;
  try {
    await getTransport().sendMail({
      from: `eHive <${fromAddress()}>`,
      to,
      subject: "eHive test email — SMTP is working",
      text: "Your eHive portal email is working. If you can read this, outbound email is configured correctly.",
      html,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
