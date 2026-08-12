import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

function requiredSecret(name: string, minLength: number): string {
  const value = required(name);
  if (process.env.NODE_ENV === "production" && value.length < minLength) {
    throw new Error(
      `${name} must be at least ${minLength} characters in production`
    );
  }
  return value;
}

const appSecret = requiredSecret("APP_SECRET", 32);
const totpSecret = required("TOTP_SECRET") || appSecret;

export const env = {
  // Secret used to sign session JWTs. Must be high-entropy and at least 32 chars.
  appSecret,
  // Separate secret for signing short-lived 2FA login challenges. Falls back to
  // APP_SECRET for backwards compatibility, but should be set independently in
  // production so a session-key rotation does not invalidate in-flight 2FA flows.
  totpSecret,
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: required("DATABASE_URL"),
  // The account that signs up with this email is auto-granted admin (first admin).
  ownerEmail: process.env.OWNER_EMAIL ?? "",
  // Payment gateway (Stripe reference impl). Empty = online payment disabled.
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  // Outbound email (SMTP). Empty host = email disabled (leads still stored).
  smtpHost: process.env.SMTP_HOST ?? "",
  smtpPort: Number(process.env.SMTP_PORT ?? "587"),
  smtpSecure: process.env.SMTP_SECURE === "true",
  smtpUser: process.env.SMTP_USER ?? "",
  smtpPass: process.env.SMTP_PASS ?? "",
  // From: header for outbound mail. Falls back to the SMTP user.
  mailFrom: process.env.MAIL_FROM ?? "",
  // Where new-lead notifications are sent. Falls back to OWNER_EMAIL.
  leadNotifyEmail:
    process.env.LEAD_NOTIFY_EMAIL ?? process.env.OWNER_EMAIL ?? "",
  // Public base URL for absolute links in emails (e.g. the portal button).
  publicUrl: (
    process.env.PUBLIC_URL ??
    process.env.APP_URL ??
    "https://ehiveglobal.com"
  ).replace(/\/$/, ""),
  // Zoho ZeptoMail HTTP API — sends over HTTPS, so it works where hosts block
  // outbound SMTP ports (e.g. Railway). When the token is set it takes priority
  // over SMTP. Get the token from ZeptoMail → Mail Agent → SMTP/API → Send Mail.
  zeptoToken: process.env.ZEPTOMAIL_TOKEN ?? "",
  // Regional API host: api.zeptomail.com (default), api.zeptomail.eu, etc.
  zeptoApiUrl:
    process.env.ZEPTOMAIL_API_URL ?? "https://api.zeptomail.com/v1.1/email",
};
