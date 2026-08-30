import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import { logger } from "./log";
import type { User } from "@db/schema";

/** Mask an email address for logs/audit trails so a leaked log doesn't expose
 *  the full mailbox. `a****@example.com` keeps enough to identify in support. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const visible = local.slice(0, 1).toLowerCase();
  const masked =
    local.length > 1 ? "*".repeat(Math.min(local.length - 1, 8)) : "";
  return `${visible}${masked}@${domain.toLowerCase()}`;
}

/** Append a row to the admin audit trail. Fire-and-forget: never throws into
 *  the caller (an audit write must not break the action it records). */
export async function audit(
  actor: Pick<User, "id" | "email">,
  action: string,
  target?: { type?: string; id?: string | number; detail?: string }
): Promise<void> {
  try {
    await getDb()
      .insert(schema.adminAuditLog)
      .values({
        actorUserId: actor.id,
        actorEmail: actor.email ?? null,
        action,
        targetType: target?.type ?? null,
        targetId: target?.id != null ? String(target.id) : null,
        detail: target?.detail ?? null,
      });
  } catch (e) {
    logger.error("audit write failed", { error: e });
  }
}
