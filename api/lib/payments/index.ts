import { env } from "../env";
import type { PaymentProvider } from "./provider";
import { StripeProvider } from "./stripe";

let cached: PaymentProvider | null = null;

/** Online payment is available only when a gateway is configured. */
export function paymentsEnabled(): boolean {
  return !!env.stripeSecretKey;
}

/** The active payment provider. Throws if payments aren't configured. */
export function getPaymentProvider(): PaymentProvider {
  if (!paymentsEnabled()) throw new Error("Payments are not configured");
  if (!cached) cached = new StripeProvider();
  return cached;
}

export type { PaymentProvider, CheckoutInput, WebhookResult } from "./provider";
