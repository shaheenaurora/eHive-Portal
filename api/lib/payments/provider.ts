import type { Tier } from "@contracts/constants";

/** What every payment call site needs to start a checkout. */
export type CheckoutInput = {
  tier: Tier;
  userId: number;
  email: string;
  amount: number; // minor units (e.g. fils)
  currency: string; // e.g. "aed"
  successUrl: string;
  cancelUrl: string;
};

/** Normalized outcome of a provider webhook, gateway-agnostic. */
export type WebhookResult = {
  providerRef: string;
  status: "paid" | "failed";
  userId?: number;
  tier?: Tier;
} | null;

/**
 * The single interface the Portal uses to charge people (SRS INT-01). No call
 * site ever touches a specific gateway SDK — swapping Stripe for Telr/PayTabs/
 * Network International later means implementing this once, nothing else changes.
 */
export interface PaymentProvider {
  readonly name: string;
  createCheckoutSession(
    input: CheckoutInput
  ): Promise<{ url: string; providerRef: string }>;
  handleWebhook(rawBody: string, signature: string): Promise<WebhookResult>;
  refund(providerRef: string): Promise<void>;
}
