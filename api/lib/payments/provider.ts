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
  /** Amount the gateway actually settled, in minor units. Lets the webhook
   *  assert it matches the amount fixed server-side at checkout. */
  amount?: number;
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
  /** Refund a captured payment. Omit amountMinor for a full refund, or pass a
   *  smaller value (in minor units, e.g. fils) for a partial refund. */
  refund(providerRef: string, amountMinor?: number): Promise<void>;
  /** Retrieve a checkout session by provider ref so the scheduler can reconcile
   *  payments that never received a webhook. */
  retrieveCheckoutSession(
    providerRef: string
  ): Promise<{ status: "paid" | "failed"; amount?: number } | null>;
}
