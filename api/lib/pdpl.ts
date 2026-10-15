import { eq, and } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import { displayIdNumber } from "./id-seal";

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

/** Shape a member_kyc row for a member data export: idNumber is stored
 *  aes-256-gcm sealed, so decrypt it for the data subject (legacy plaintext
 *  rows pass through; undecryptable rows export as null, never raw
 *  ciphertext). */
export function exportKyc(row: typeof schema.memberKyc.$inferSelect) {
  return { ...row, idNumber: displayIdNumber(row.idNumber) };
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
