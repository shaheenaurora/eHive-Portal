import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as schema from "@db/schema";
import type { User } from "@db/schema";
import { getDb } from "./connection";
import { env } from "../lib/env";

/**
 * Promote a user to admin if their email matches OWNER_EMAIL. Runs on every
 * authenticated request so the owner account becomes admin even if it was
 * created before OWNER_EMAIL was set. No-op once the user is already admin.
 */
export async function ensureOwnerRole(user: User): Promise<User> {
  const owner = env.ownerEmail.trim().toLowerCase();
  const isOwner = !!owner && (user.email ?? "").toLowerCase() === owner;
  if (user.role === "admin") {
    // Owner always holds the full "*" scope even if promoted before scopes existed.
    if (isOwner && user.adminScopes !== "*") {
      await getDb().update(schema.users).set({ adminScopes: "*" }).where(eq(schema.users.id, user.id));
      return { ...user, adminScopes: "*" };
    }
    return user;
  }
  if (isOwner) {
    await getDb().update(schema.users).set({ role: "admin", adminScopes: "*" }).where(eq(schema.users.id, user.id));
    return { ...user, role: "admin", adminScopes: "*" };
  }
  return user;
}

export async function findUserByUnionId(unionId: string) {
  const rows = await getDb()
    .select()
    .from(schema.users)
    .where(eq(schema.users.unionId, unionId))
    .limit(1);
  return rows.at(0);
}

export async function findUserByEmail(email: string) {
  const rows = await getDb()
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email.toLowerCase()))
    .limit(1);
  return rows.at(0);
}

/**
 * Create a new email/password account. The account whose email matches
 * OWNER_EMAIL is granted admin automatically (bootstraps the first admin).
 */
export async function createUser(input: { email: string; passwordHash: string; name: string }) {
  const email = input.email.toLowerCase();
  const unionId = nanoid();
  const isOwner = !!env.ownerEmail && email === env.ownerEmail.toLowerCase();
  await getDb().insert(schema.users).values({
    unionId,
    email,
    name: input.name,
    passwordHash: input.passwordHash,
    role: isOwner ? "admin" : "user",
    adminScopes: isOwner ? "*" : "",
    consentAt: new Date(),
    lastSignInAt: new Date(),
  });
  return findUserByUnionId(unionId);
}

export async function findUserById(id: number) {
  const rows = await getDb().select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
  return rows.at(0);
}

export async function setUserPassword(userId: number, passwordHash: string) {
  await getDb().update(schema.users).set({ passwordHash }).where(eq(schema.users.id, userId));
}

export async function markEmailVerified(userId: number) {
  await getDb().update(schema.users).set({ emailVerifiedAt: new Date() }).where(eq(schema.users.id, userId));
}

export async function setTotpSecret(userId: number, secret: string) {
  // Store the pending secret; not active until the user confirms a code.
  await getDb().update(schema.users).set({ totpSecret: secret, totpEnabled: 0 }).where(eq(schema.users.id, userId));
}

export async function setTotpEnabled(userId: number, enabled: boolean) {
  await getDb().update(schema.users)
    .set(enabled ? { totpEnabled: 1 } : { totpEnabled: 0, totpSecret: null })
    .where(eq(schema.users.id, userId));
}

export async function touchLastSignIn(userId: number) {
  await getDb()
    .update(schema.users)
    .set({ lastSignInAt: new Date() })
    .where(eq(schema.users.id, userId));
}
