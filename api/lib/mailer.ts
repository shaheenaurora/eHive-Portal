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
