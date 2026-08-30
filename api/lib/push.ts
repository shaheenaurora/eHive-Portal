import webpush from "web-push";
import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import * as schema from "@db/schema";
import { env } from "./env";
import { logger } from "./log";

let ready: { publicKey: string; privateKey: string } | null = null;

/** Load the VAPID keypair from app_config, generating and persisting it on first
 *  use — so web push works with zero environment setup. */
async function ensureVapid() {
  if (ready) return ready;
  const db = getDb();
  const row = (
    await db
      .select()
      .from(schema.appConfig)
      .where(eq(schema.appConfig.key, "vapid"))
      .limit(1)
  ).at(0);
  let keys: { publicKey: string; privateKey: string };
  if (row?.value) {
    keys = JSON.parse(row.value);
  } else {
    keys = webpush.generateVAPIDKeys();
    await db
      .insert(schema.appConfig)
      .values({ key: "vapid", value: JSON.stringify(keys) })
      .onDuplicateKeyUpdate({ set: { value: JSON.stringify(keys) } });
  }
  const subject = env.ownerEmail
    ? `mailto:${env.ownerEmail}`
    : "mailto:hello@ehiveglobal.com";
  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
  ready = keys;
  return keys;
}

export async function getVapidPublicKey(): Promise<string> {
  return (await ensureVapid()).publicKey;
}

type PushPayload = { title: string; body: string; url?: string; tag?: string };

/** Send a push to every device a member has registered, honouring per-category
 *  opt-outs. Dead subscriptions (404/410) are pruned. Never throws. */
export async function pushToMember(
  memberId: number,
  payload: PushPayload,
  category?: string
): Promise<void> {
  try {
    await ensureVapid();
    const db = getDb();
    const subs = await db
      .select()
      .from(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.memberId, memberId));
    if (!subs.length) return;
    const body = JSON.stringify(payload);
    await Promise.all(
      subs.map(async s => {
        if (category && s.categories) {
          try {
            const cats = JSON.parse(s.categories) as string[];
            if (Array.isArray(cats) && !cats.includes(category)) return;
          } catch {
            /* malformed → treat as all-on */
          }
        }
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body
          );
        } catch (err) {
          const code = (err as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) {
            await db
              .delete(schema.pushSubscriptions)
              .where(eq(schema.pushSubscriptions.id, s.id));
          }
        }
      })
    );
  } catch (e) {
    logger.error("pushToMember failed", { error: e });
  }
}
