import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import type { User } from "@db/schema";

/** Append a row to the admin audit trail. Fire-and-forget: never throws into
 *  the caller (an audit write must not break the action it records). */
export async function audit(
  actor: Pick<User, "id" | "email">,
  action: string,
  target?: { type?: string; id?: string | number; detail?: string },
): Promise<void> {
  try {
    await getDb().insert(schema.adminAuditLog).values({
      actorUserId: actor.id,
      actorEmail: actor.email ?? null,
      action,
      targetType: target?.type ?? null,
      targetId: target?.id != null ? String(target.id) : null,
      detail: target?.detail ?? null,
    });
  } catch (e) {
    console.error("audit write failed", e);
  }
}
