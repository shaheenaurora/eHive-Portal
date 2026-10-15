import { env } from "../env";
import type { PaymentProvider } from "./provider";
import { StripeProvider } from "./stripe";

let cached: PaymentProvider | null = null;

/** Online payment is available only when a gateway is configured. */
export function paymentsEnabled(): boolean {
  return !!env.stripeSecretKey;
}

/** B6 — production boot gate for the payment gateway. Without a webhook secret
 *  checkout still charges cards while every settlement webhook 400s; test keys
 *  in production charge real cards into a throwaway Stripe account. Both must
 *  fail loudly at boot instead. No-op when payments are disabled or outside
 *  production (dev/test run with partial or no gateway config by design). */
export function assertPaymentConfig(): void {
  if (!env.isProduction || !env.stripeSecretKey) return;
  if (!env.stripeWebhookSecret)
    throw new Error(
      "STRIPE_WEBHOOK_SECRET is required in production when STRIPE_SECRET_KEY is set — payment webhooks cannot be verified without it"
    );
  if (env.stripeSecretKey.startsWith("sk_test_"))
    throw new Error(
      "STRIPE_SECRET_KEY is a test key (sk_test_…) — refusing to boot production against the Stripe test environment"
    );
}

/** The active payment provider. Throws if payments aren't configured. */
export function getPaymentProvider(): PaymentProvider {
  if (!paymentsEnabled()) throw new Error("Payments are not configured");
  if (!cached) cached = new StripeProvider();
  return cached;
}

export type { PaymentProvider, CheckoutInput, WebhookResult } from "./provider";
