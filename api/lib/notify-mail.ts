import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import { sendMail, mailEnabled } from "./mailer";
import { env } from "./env";

const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] as string
  );

/* Subject line per notification kind — keeps the inbox scannable. */
const KIND_SUBJECT: Record<string, string> = {
  connect: "A connection update — eHive Circle",
  membership: "A membership update — eHive Circle",
  renewal: "Your renewal — eHive Circle",
  conduct: "An update on your membership — eHive Circle",
  event: "An event update — eHive Circle",
  onboarding: "Your onboarding — eHive Circle",
  health: "A chapter update — eHive Circle",
  score: "Your Hive Score — eHive Circle",
  dormancy: "We've missed you — eHive Circle",
  info: "An update from eHive Circle",
};
const KIND_EYEBROW: Record<string, string> = {
  connect: "Connect",
  membership: "Membership",
  renewal: "Renewal",
  conduct: "Membership",
  event: "Events",
  onboarding: "Onboarding",
  health: "Chapter",
  score: "Hive Score",
  dormancy: "Engagement",
  info: "Update",
};

/* Ledger-styled email shell (paper / ink-navy / vermilion). */
function shell(name: string, text: string, kind: string): string {
  const first = (name || "").split(" ")[0] || "there";
  const eyebrow = KIND_EYEBROW[kind] ?? "Update";
  const portal = `${env.publicUrl}/portal`;
  return `<div style="margin:0;padding:24px;background:#F3F1EA;font-family:'Hanken Grotesk',Arial,sans-serif">
    <div style="max-width:520px;margin:0 auto;background:#FBFAF6;border:1px solid #D8D2C4;border-radius:6px;overflow:hidden">
      <div style="background:#16264C;padding:18px 24px">
        <span style="color:#FBFAF6;font-family:Archivo,Arial,sans-serif;font-weight:800;font-size:19px;letter-spacing:-.01em">eHive</span>
        <span style="color:#DA3A22;font-weight:800">.</span>
      </div>
      <div style="padding:26px 24px;color:#141312">
        <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#DA3A22">${esc(eyebrow)}</p>
        <p style="margin:0 0 14px;font-size:17px;color:#141312">Hi ${esc(first)},</p>
        <p style="margin:0 0 22px;font-size:16px;line-height:1.55;color:#141312">${esc(text)}</p>
        <a href="${esc(portal)}" style="display:inline-block;background:#DA3A22;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:4px;font-size:15px">Open the portal</a>
      </div>
      <div style="padding:16px 24px;border-top:1px solid #E4DECF;color:#8A8578;font-size:12px;line-height:1.5">
        You're receiving this because email updates are on for your eHive Circle membership.
        You can turn them off anytime in the portal under Membership → notifications.
      </div>
    </div>
  </div>`;
}

async function markDelivery(
  deliveryId: number,
  patch: Partial<typeof schema.notificationDeliveries.$inferInsert>
) {
  try {
    await getDb()
      .update(schema.notificationDeliveries)
      .set(patch)
      .where(eq(schema.notificationDeliveries.id, deliveryId));
  } catch {
    /* best-effort tracking; never breaks the email send */
  }
}

/** Email a copy of an in-app notification to the member — non-blocking and
 *  best-effort. Skips when email isn't configured, the member has no address,
 *  or they've opted out (members.emailNotify). Tracks status in
 *  notification_deliveries when deliveryId is provided. Never throws. */
export async function emailNotification(
  memberId: number,
  text: string,
  kind: string,
  deliveryId?: number
): Promise<void> {
  try {
    if (!mailEnabled()) {
      if (deliveryId)
        await markDelivery(deliveryId, {
          status: "failed",
          error: "Mail not enabled",
        });
      return;
    }
    const row = (
      await getDb()
        .select({
          email: schema.users.email,
          name: schema.users.name,
          emailNotify: schema.members.emailNotify,
        })
        .from(schema.members)
        .innerJoin(schema.users, eq(schema.users.id, schema.members.userId))
        .where(eq(schema.members.id, memberId))
        .limit(1)
    ).at(0);
    if (!row?.email || !row.emailNotify) {
      if (deliveryId)
        await markDelivery(deliveryId, {
          status: "failed",
          error: !row?.email ? "No email address" : "Member opted out",
        });
      return;
    }
    await sendMail({
      to: row.email,
      subject: KIND_SUBJECT[kind] ?? KIND_SUBJECT.info,
      html: shell(row.name ?? "", text, kind),
    });
    if (deliveryId)
      await markDelivery(deliveryId, { status: "sent", sentAt: new Date() });
  } catch (err) {
    if (deliveryId)
      await markDelivery(deliveryId, {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    /* email is best-effort; never breaks the triggering action */
  }
}

/** Retry a failed email delivery. Reads the original notification text/kind from
 *  the joined notification row and re-attempts send, incrementing retryCount. */
export async function retryEmailDelivery(deliveryId: number): Promise<void> {
  const db = getDb();
  const row = (
    await db
      .select({
        memberId: schema.notificationDeliveries.memberId,
        status: schema.notificationDeliveries.status,
        retryCount: schema.notificationDeliveries.retryCount,
        text: schema.notifications.text,
        kind: schema.notifications.kind,
      })
      .from(schema.notificationDeliveries)
      .innerJoin(
        schema.notifications,
        eq(
          schema.notifications.id,
          schema.notificationDeliveries.notificationId
        )
      )
      .where(eq(schema.notificationDeliveries.id, deliveryId))
      .limit(1)
  ).at(0);
  if (!row) throw new Error("Delivery not found.");
  if (row.status === "sent") return;
  await db
    .update(schema.notificationDeliveries)
    .set({ retryCount: (row.retryCount ?? 0) + 1 })
    .where(eq(schema.notificationDeliveries.id, deliveryId));
  await emailNotification(
    row.memberId,
    row.text ?? "",
    row.kind ?? "info",
    deliveryId
  );
}
