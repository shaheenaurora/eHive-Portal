import { randomBytes, createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Mint a single-use token of the given kind. Returns the RAW token (goes in
 *  the emailed link); only its hash is persisted. */
export async function createAuthToken(
  userId: number,
  kind: "verify" | "reset",
  ttlMs: number
): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  await getDb()
    .insert(schema.authTokens)
    .values({
      userId,
      kind,
      tokenHash: sha256(raw),
      expiresAt: new Date(Date.now() + ttlMs),
    });
  return raw;
}

/** Consume a token: valid, unused, unexpired, matching kind. Returns the userId
 *  and marks it used, or null if invalid. */
export async function consumeAuthToken(
  raw: string,
  kind: "verify" | "reset"
): Promise<number | null> {
  const db = getDb();
  const row = (
    await db
      .select()
      .from(schema.authTokens)
      .where(
        and(
          eq(schema.authTokens.tokenHash, sha256(raw)),
          eq(schema.authTokens.kind, kind),
          isNull(schema.authTokens.usedAt),
          gt(schema.authTokens.expiresAt, new Date())
        )
      )
      .limit(1)
  ).at(0);
  if (!row) return null;
  await db
    .update(schema.authTokens)
    .set({ usedAt: new Date() })
    .where(eq(schema.authTokens.id, row.id));
  return row.userId;
}
