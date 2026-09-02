import { eq, and } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";

/** Fields that must never leave the system in a member data export. */
const EXPORT_DENYLIST = new Set([
  "passwordHash",
  "totpSecret",
  "tokenVersion",
  "resetToken",
  "resetTokenExpiresAt",
]);

/** Strip fields that must never leave the system in a member export. */
export function exportUser(user: typeof schema.users.$inferSelect) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(user)) {
    if (!EXPORT_DENYLIST.has(key)) out[key] = value;
  }
  return out as Omit<
    typeof schema.users.$inferSelect,
    | "passwordHash"
    | "totpSecret"
    | "tokenVersion"
    | "resetToken"
    | "resetTokenExpiresAt"
  >;
}

/** Returns true when the member already has an open request of the given kind. */
export async function hasOpenDataRequest(
  memberId: number,
  kind: "export" | "deletion"
) {
  const db = getDb();
  const row = await db
    .select({ id: schema.dataRequests.id })
    .from(schema.dataRequests)
    .where(
      and(
        eq(schema.dataRequests.memberId, memberId),
        eq(schema.dataRequests.kind, kind),
        eq(schema.dataRequests.status, "open")
      )
    )
    .limit(1);
  return row.length > 0;
}
