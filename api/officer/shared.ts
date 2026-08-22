import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import { getMemberByUserId } from "../queries/circle";

/**
 * Resolve the caller's chapter-officer context: the member must hold an active
 * leadership role in their home chapter. Everything an officer does is scoped to
 * that one chapter — never another. Throws FORBIDDEN if they're not an officer.
 */
export async function requireOfficer(userId: number) {
  const member = await getMemberByUserId(userId);
  if (!member)
    throw new TRPCError({ code: "FORBIDDEN", message: "No membership" });
  if (!member.homeChapterId)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You don't lead a chapter.",
    });
  const roles = await getDb()
    .select()
    .from(schema.chapterRoles)
    .where(
      and(
        eq(schema.chapterRoles.memberId, member.id),
        eq(schema.chapterRoles.chapterId, member.homeChapterId),
        eq(schema.chapterRoles.status, "active")
      )
    );
  if (!roles.length)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You don't hold a chapter leadership role.",
    });
  return {
    member,
    chapterId: member.homeChapterId,
    roleKeys: roles.map(r => r.role),
  };
}

/** Enforce that the caller holds at least one of the required officer roles. */
export function assertRoles(
  held: string[],
  required: string[],
  message = "Your chapter role can't do this."
) {
  if (!required.some(r => held.includes(r))) {
    throw new TRPCError({ code: "FORBIDDEN", message });
  }
}

/** A member of the officer's chapter — used to validate every target. */
export async function inChapter(memberId: number, chapterId: number) {
  const m = (
    await getDb()
      .select()
      .from(schema.members)
      .where(eq(schema.members.id, memberId))
      .limit(1)
  ).at(0);
  if (!m || m.homeChapterId !== chapterId)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "That member isn't in your chapter.",
    });
  return m;
}

/** Verify a chapter-scoped resource belongs to the officer's chapter. */
export async function assertChapterOwner<
  T extends { chapterId: number | null },
>(row: T | undefined, chapterId: number, label: string): Promise<T> {
  if (!row || row.chapterId !== chapterId)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `That ${label} isn't in your chapter.`,
    });
  return row;
}
