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
  if (user.role === "admin") return user;
  const owner = env.ownerEmail.trim().toLowerCase();
  if (owner && (user.email ?? "").toLowerCase() === owner) {
    await getDb().update(schema.users).set({ role: "admin" }).where(eq(schema.users.id, user.id));
    return { ...user, role: "admin" };
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
  const role = env.ownerEmail && email === env.ownerEmail.toLowerCase() ? "admin" : "user";
  await getDb().insert(schema.users).values({
    unionId,
    email,
    name: input.name,
    passwordHash: input.passwordHash,
    role,
    consentAt: new Date(),
    lastSignInAt: new Date(),
  });
  return findUserByUnionId(unionId);
}

export async function touchLastSignIn(userId: number) {
  await getDb()
    .update(schema.users)
    .set({ lastSignInAt: new Date() })
    .where(eq(schema.users.id, userId));
}
