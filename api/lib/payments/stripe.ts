import Stripe from "stripe";
import type { Tier } from "@contracts/constants";
import { env } from "../env";
import type { PaymentProvider, CheckoutInput, WebhookResult } from "./provider";

/** Stripe reference implementation of PaymentProvider (SRS INT-03).
 *  Uses inline price_data so no Stripe products need to be pre-created. */
export class StripeProvider implements PaymentProvider {
  readonly name = "stripe";
  private stripe: Stripe;

  constructor() {
    this.stripe = new Stripe(env.stripeSecretKey);
  }

  async createCheckoutSession(input: CheckoutInput) {
    const session = await this.stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: input.email || undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: input.currency,
            unit_amount: input.amount,
            product_data: {
              name: `eHive Circle — ${input.tier} membership (1 year)`,
            },
          },
        },
      ],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: { userId: String(input.userId), tier: input.tier },
    });
    return { url: session.url ?? "", providerRef: session.id };
  }

  async handleWebhook(
    rawBody: string,
    signature: string
  ): Promise<WebhookResult> {
    const event = this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      env.stripeWebhookSecret
    );
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      const s = event.data.object as Stripe.Checkout.Session;
      return {
        providerRef: s.id,
        status: s.payment_status === "paid" ? "paid" : "failed",
        userId: s.metadata?.userId ? Number(s.metadata.userId) : undefined,
        tier: (s.metadata?.tier as Tier) || undefined,
      };
    }
    if (
      event.type === "checkout.session.async_payment_failed" ||
      event.type === "checkout.session.expired"
    ) {
      const s = event.data.object as Stripe.Checkout.Session;
      return { providerRef: s.id, status: "failed" };
    }
    return null;
  }

  async refund(providerRef: string) {
    const session = await this.stripe.checkout.sessions.retrieve(providerRef);
    const pi =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id;
    if (pi) await this.stripe.refunds.create({ payment_intent: pi });
  }
}
