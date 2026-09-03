import { eq, and, lt, sql } from "drizzle-orm";
import { getDb } from "./connection";
import * as schema from "@db/schema";

export async function createUserSession(input: {
  userId: number;
  tokenVersion: number;
  fingerprint?: string;
  ip?: string;
  userAgent?: string;
  expiresAt: Date;
}): Promise<schema.UserSession> {
  const res = await getDb()
    .insert(schema.userSessions)
    .values({
      userId: input.userId,
      tokenVersion: input.tokenVersion,
      fingerprint: input.fingerprint ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      expiresAt: input.expiresAt,
    });
  const id = Number((res as unknown as [{ insertId: number }])[0].insertId);
  const row = (
    await getDb()
      .select()
      .from(schema.userSessions)
      .where(eq(schema.userSessions.id, id))
      .limit(1)
  )[0];
  if (!row) throw new Error("Session insert failed");
  return row;
}

export async function getUserSessionById(
  id: number
): Promise<schema.UserSession | undefined> {
  return (
    await getDb()
      .select()
      .from(schema.userSessions)
      .where(eq(schema.userSessions.id, id))
      .limit(1)
  )[0];
}

export async function revokeUserSession(id: number): Promise<void> {
  await getDb()
    .update(schema.userSessions)
    .set({ revokedAt: new Date() })
    .where(eq(schema.userSessions.id, id));
}

export async function revokeAllUserSessions(
  userId: number,
  exceptSessionId?: number
): Promise<void> {
  await getDb()
    .update(schema.userSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.userSessions.userId, userId),
        exceptSessionId
          ? sql`${schema.userSessions.id} != ${exceptSessionId}`
          : undefined
      )
    );
}

export async function pruneExpiredUserSessions(
  before: Date = new Date()
): Promise<number> {
  const res = await getDb()
    .delete(schema.userSessions)
    .where(lt(schema.userSessions.expiresAt, before));
  return (res as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
}

export function isSessionValid(
  session: schema.UserSession,
  userTokenVersion: number
): boolean {
  if (session.revokedAt) return false;
  if (session.expiresAt.getTime() < Date.now()) return false;
  if (session.tokenVersion !== userTokenVersion) return false;
  return true;
}
