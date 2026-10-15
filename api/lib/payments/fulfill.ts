import { and, eq, isNull, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../../queries/connection";
import { withTransaction } from "../../queries/transaction";
import { createInvoiceFromPayment } from "../../queries/invoicing";
import {
  activateMembership,
  newCheckinCode,
  notify,
  renewMembership,
  upgradeMembership,
} from "../../queries/circle";
import { refundPayment } from "../../queries/finance";
import { sendInvoiceReady } from "../lead-mail";
import { recordAnalyticsEvent } from "../../queries/analytics";
import { logger } from "../log";

/** The payment_records row this fulfillment belongs to. */
export type PaymentRecordRow = typeof schema.paymentRecords.$inferSelect;

export type FulfillmentResult = {
  /** True when another caller already won the pending→paid race — nothing was
   *  granted, so this delivery is a no-op. */
  duplicate: boolean;
  invoiceNumber: string | null;
};

/**
 * B7 — the shared post-payment fulfillment. Every code path that learns a
 * payment settled (Stripe webhook, scheduler reconciliation) routes through
 * here, so a record can never be marked paid without its entitlement being
 * delivered.
 *
 * Compare-and-swap pending→paid runs inside the same transaction as the
 * invoice, exactly like the original webhook: the first concurrent caller
 * (webhook vs reconciler, or a Stripe retry) wins the CAS, everyone else gets
 * { duplicate: true } and double-grants stay impossible. Side effects
 * (renewal/upgrade/activation/ticket registration) run after the transaction
 * commits, as before.
 *
 * On entitlement-delivery failure the record is flipped paid→failed (money
 * settled but nothing was delivered — "paid" would hide it from finance ops and
 * kill dunning) and the error rethrows so callers can alert/respond.
 */
export async function fulfillPayment(
  record: PaymentRecordRow
): Promise<FulfillmentResult> {
  const paidAt = new Date();
  const invoiceResult = await withTransaction(async tx => {
    const paidUpdate = await tx
      .update(schema.paymentRecords)
      .set({ status: "paid", paidAt })
      .where(
        and(
          eq(schema.paymentRecords.id, record.id),
          eq(schema.paymentRecords.status, "pending")
        )
      );
    if (
      (paidUpdate as unknown as [{ affectedRows: number }])[0].affectedRows ===
      0
    ) {
      return { duplicate: true as const };
    }
    const invoice = await createInvoiceFromPayment(
      tx,
      {
        id: record.id,
        userId: record.userId,
        purpose: record.purpose,
        tier: record.tier ?? null,
        amount: record.amount,
        currency: record.currency,
        paidAt,
      },
      { status: "paid" }
    );
    return {
      duplicate: false as const,
      invoiceNumber: invoice.invoiceNumber,
    };
  });
  if (invoiceResult.duplicate) {
    return { duplicate: true, invoiceNumber: null };
  }
  try {
    await deliverEntitlements(record);
  } catch (err) {
    logger.error("payment fulfillment failed; marking record failed", {
      paymentRecordId: record.id,
      purpose: record.purpose,
      error: err,
    });
    await getDb()
      .update(schema.paymentRecords)
      .set({ status: "failed" })
      .where(
        and(
          eq(schema.paymentRecords.id, record.id),
          eq(schema.paymentRecords.status, "paid")
        )
      );
    throw err;
  }
  const payer = (
    await getDb()
      .select({ name: schema.users.name, email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, record.userId))
      .limit(1)
  ).at(0);
  if (payer?.email && invoiceResult.invoiceNumber) {
    sendInvoiceReady({
      email: payer.email,
      name: payer.name,
      invoiceNumber: invoiceResult.invoiceNumber,
      amount: record.amount / 100,
      currency: record.currency,
    }).catch(() => {
      /* non-fatal */
    });
  }
  void recordAnalyticsEvent("payment_succeeded", {
    userId: record.userId,
    properties: {
      purpose: record.purpose,
      tier: record.tier,
      amount: record.amount,
      currency: record.currency,
    },
  });
  return { duplicate: false, invoiceNumber: invoiceResult.invoiceNumber };
}

/** Purpose-specific entitlement delivery. Mirrors the webhook branches: the
 *  stored record is authoritative, so a tampered session can't activate the
 *  wrong membership. */
async function deliverEntitlements(record: PaymentRecordRow): Promise<void> {
  if (record.purpose === "renewal") {
    await renewMembership(record.userId, "Renewed via online payment");
  } else if (record.purpose === "upgrade" && record.tier) {
    await upgradeMembership(
      record.userId,
      record.tier,
      "Upgraded via online payment"
    );
  } else if (record.purpose === "event_ticket" && record.eventId) {
    /* Paid event seat: write the registration inside a transaction that
     * locks the event row, exactly like free registration. If the event
     * sold out between checkout and payment, refund automatically — a
     * paid seat can never oversell capacity. */
    const ticketEventId = record.eventId;
    const memberRow = (
      await getDb()
        .select({ id: schema.members.id })
        .from(schema.members)
        .where(eq(schema.members.userId, record.userId))
        .limit(1)
    ).at(0);
    if (memberRow) {
      const outcome = await getDb().transaction(async tx => {
        const ev = (
          await tx
            .select()
            .from(schema.events)
            .where(
              and(
                eq(schema.events.id, ticketEventId),
                isNull(schema.events.deletedAt)
              )
            )
            .for("update")
        ).at(0);
        if (!ev) return "gone" as const;
        const existing = await tx
          .select()
          .from(schema.eventRegs)
          .where(
            and(
              eq(schema.eventRegs.eventId, ev.id),
              eq(schema.eventRegs.memberId, memberRow.id)
            )
          )
          .limit(1);
        if (existing.length && existing[0].status !== "cancelled")
          return "duplicate" as const;
        const count = await tx
          .select({ n: sql<number>`count(*)` })
          .from(schema.eventRegs)
          .where(
            and(
              eq(schema.eventRegs.eventId, ev.id),
              sql`${schema.eventRegs.status} in ('registered','attended')`
            )
          );
        if ((count.at(0)?.n ?? 0) >= ev.capacity) return "full" as const;
        if (existing.length) {
          await tx
            .update(schema.eventRegs)
            .set({
              status: "registered",
              checkinCode: newCheckinCode(),
              paymentRecordId: record.id,
            })
            .where(eq(schema.eventRegs.id, existing[0].id));
        } else {
          await tx.insert(schema.eventRegs).values({
            eventId: ev.id,
            memberId: memberRow.id,
            checkinCode: newCheckinCode(),
            paymentRecordId: record.id,
          });
        }
        return "registered" as const;
      });
      if (outcome === "full" || outcome === "gone") {
        try {
          await refundPayment(
            { id: record.userId, email: "system@ehive" },
            record.id,
            outcome === "full"
              ? "Event sold out before ticket payment settled — auto refund"
              : "Event removed before ticket payment settled — auto refund"
          );
        } catch (err) {
          logger.error("event ticket auto-refund failed", {
            error: err,
            paymentRecordId: record.id,
          });
        }
        await notify(
          memberRow.id,
          outcome === "full"
            ? "The event sold out before your payment settled — you've been refunded automatically. 💳"
            : "This event is no longer running — you've been refunded automatically. 💳",
          "event"
        ).catch(() => {});
      } else if (outcome === "registered") {
        await notify(
          memberRow.id,
          "Your ticket is confirmed — see you at the event. 🎟️",
          "event"
        ).catch(() => {});
      }
    }
  } else if (record.tier) {
    await activateMembership(
      record.userId,
      record.tier,
      "Membership activated via online payment"
    );
  }
}
