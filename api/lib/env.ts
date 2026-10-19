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
// TOTP_SECRET is optional and falls back to APP_SECRET. It must NOT go through
// required(), which throws in production when unset — that would crash-loop the
// whole app on boot just because this optional var isn't configured. Setting a
// distinct TOTP_SECRET is still recommended so rotating the session key doesn't
// invalidate in-flight 2FA challenges.
const totpSecret = (process.env.TOTP_SECRET ?? "").trim() || appSecret;

export function parsePositiveInt(
  input: string | undefined,
  fallback: number
): number {
  const n = Number(input);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

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
  // Launch offer for the paid assessment reports (Brand Check / Clarity
  // Scorecard full report). DEFAULT ON: while Stripe is not set up and the
  // firm is not yet legally registered, the full report is FREE for everyone
  // — the AED 99 price still shows (anchoring) but charging is impossible:
  // /api/report/checkout and /api/report/request-invoice return 403
  // "launch_offer" and the engine unlocks the full report for every visitor.
  // Set REPORT_LAUNCH_OFFER=false once Stripe is live AND the firm is
  // registered to start charging.
  reportLaunchOffer: process.env.REPORT_LAUNCH_OFFER !== "false",
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
  // Optional dedicated desks for partner / franchise enquiries. When unset,
  // those enquiries fall back to the general lead inbox above.
  partnersNotifyEmail: process.env.PARTNERS_NOTIFY_EMAIL ?? undefined,
  franchiseNotifyEmail: process.env.FRANCHISE_NOTIFY_EMAIL ?? undefined,
  // Public base URL for absolute links in emails (e.g. the portal button),
  // checkout redirect URLs, robots.txt and the sitemap. ehiveglobal.com is the
  // custom domain — set PUBLIC_URL when serving on it; the fallback is the
  // known-live railway origin.
  publicUrl: (
    process.env.PUBLIC_URL ??
    process.env.APP_URL ??
    "https://ehive-portal-production.up.railway.app"
  ).replace(/\/$/, ""),
  // Zoho ZeptoMail HTTP API — sends over HTTPS, so it works where hosts block
  // outbound SMTP ports (e.g. Railway). When the token is set it takes priority
  // over SMTP. Get the token from ZeptoMail → Mail Agent → SMTP/API → Send Mail.
  zeptoToken: process.env.ZEPTOMAIL_TOKEN ?? "",
  // Regional API host: api.zeptomail.com (default), api.zeptomail.eu, etc.
  zeptoApiUrl:
    process.env.ZEPTOMAIL_API_URL ?? "https://api.zeptomail.com/v1.1/email",
  // Operational alerting. Either or both can be set; ALERT_WEBHOOK_URL receives
  // a JSON payload, SENTRY_DSN posts a lightweight event to Sentry's store API.
  sentryDsn: process.env.SENTRY_DSN ?? "",
  alertWebhookUrl: process.env.ALERT_WEBHOOK_URL ?? "",
  // Optional ClamAV REST endpoint for receipt malware scanning. Empty = only
  // magic-byte validation is performed and the upload is logged as un-scanned.
  clamavUrl: process.env.CLAMAV_URL ?? "",
  clamavToken: process.env.CLAMAV_TOKEN ?? "",
  // AI narrative layer for the paid assessment reports (POST /api/report/compose).
  // Empty AI_API_KEY = the feature is disabled: compose returns 503 and clients
  // keep the deterministic template narrative. Kimi (Moonshot AI) OpenAI-compatible
  // API — get a key at https://platform.kimi.ai (API Keys section).
  aiApiKey: process.env.AI_API_KEY ?? "",
  // International endpoint. The legacy .cn endpoint (api.moonshot.cn) serves
  // mainland accounts; keep the default unless your key was issued there.
  aiBaseUrl: (process.env.AI_BASE_URL ?? "https://api.moonshot.ai/v1").replace(
    /\/+$/,
    ""
  ),
  // Current model identifiers: kimi-k3 (flagship, default), kimi-k2.6
  // (general-purpose, cheaper/faster), kimi-k2.7-code (coding-focused).
  // moonshot-v1-* and kimi-k2.5 were retired by Moonshot on 2026-08-31.
  aiModel: process.env.AI_MODEL ?? "kimi-k3",
  // API keys for the read-only integration API (/api/integrations/v1/*) that an
  // external ERP / accounting app polls. Empty = the whole integration API is
  // disabled (returns 503).
  //
  // Format supports two styles:
  //   - Plain: <random-key>  (legacy, full access)
  //   - Scoped: <name>:<scopes>:<random-key>
  //     scopes = "*" or comma-separated resource names (payments, expenses, members)
  // Multiple keys can be configured at once to allow rotation/cutover.
  integrationApiKeys: parseIntegrationKeys(
    process.env.INTEGRATION_API_KEYS ?? ""
  ),
  // Per-user rate limits for authenticated tRPC procedures. These are applied
  // in addition to the per-IP limit in boot.ts, so a shared office IP can't
  // exhaust one user's budget and one scripted user can't exhaust the server.
  trpcMutationRateLimit: parsePositiveInt(
    process.env.TRPC_MUTATION_RATE_LIMIT,
    120
  ),
  trpcQueryRateLimit: parsePositiveInt(process.env.TRPC_QUERY_RATE_LIMIT, 600),
  // When true, the Content-Security-Policy header is sent as Report-Only so you
  // can collect violations without breaking the site. Use this while migrating
  // away from 'unsafe-inline' for style-src.
  cspReportOnly: process.env.CSP_REPORT_ONLY === "true",
  // Escape hatch for the "Load full demo" admin procedure, which otherwise
  // refuses to run when NODE_ENV=production. Demo accounts use a publicly
  // documented password, so this must stay unset on any paid/production
  // environment. "Remove demo data" is never gated by this.
  allowDemoData: process.env.ALLOW_DEMO_DATA === "true",
};

export type IntegrationApiKey = {
  name: string;
  scopes: string[];
  value: string;
};

function parseIntegrationKeys(raw: string): IntegrationApiKey[] {
  return raw
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .map((entry, idx) => {
      const parts = entry.split(":");
      if (parts.length >= 3) {
        const [name, scopeStr, ...rest] = parts;
        const value = rest.join(":");
        const scopes =
          scopeStr === "*"
            ? ["*"]
            : scopeStr
                .split(",")
                .map(s => s.trim())
                .filter(Boolean);
        return {
          name: name || `key-${idx + 1}`,
          scopes: scopes.length ? scopes : ["*"],
          value,
        };
      }
      return { name: `legacy-${idx + 1}`, scopes: ["*"], value: entry };
    });
}
