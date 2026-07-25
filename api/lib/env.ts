import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

export const env = {
  // Secret used to sign session JWTs and hash-compare passwords' tokens.
  appSecret: required("APP_SECRET"),
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
  leadNotifyEmail: process.env.LEAD_NOTIFY_EMAIL ?? process.env.OWNER_EMAIL ?? "",
};
