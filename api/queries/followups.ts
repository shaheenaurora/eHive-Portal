import { and, asc, eq, inArray } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";

/** Hours a guest follow-up is due within (CH-01: 48-hour deadline). */
export const GUEST_FOLLOWUP_HOURS = 48;

export async function createFollowUp(input: {
  title: string; chapterId?: number | null; prospectId?: number | null;
  ownerUserId?: number | null; dueInHours?: number;
}): Promise<number> {
  const dueAt = input.dueInHours != null ? new Date(Date.now() + input.dueInHours * 3600_000) : null;
  const res = await getDb().insert(schema.followUps).values({
    title: input.title.slice(0, 255),
    chapterId: input.chapterId ?? null, prospectId: input.prospectId ?? null,
    ownerUserId: input.ownerUserId ?? null, dueAt,
  });
  return Number((res as unknown as { insertId?: number }).insertId ?? 0);
}

/** Auto-create the guest follow-up when a prospect is captured (CH-01/CH-03). */
export async function openGuestFollowUp(prospectId: number, name: string, chapterId?: number | null, ownerUserId?: number | null): Promise<number> {
  return createFollowUp({
    title: `Follow up with ${name}`.slice(0, 255),
    prospectId, chapterId, ownerUserId, dueInHours: GUEST_FOLLOWUP_HOURS,
  });
}

export type FollowUpRow = {
  id: number; title: string; chapterId: number | null; chapterName: string | null;
  prospectId: number | null; ownerUserId: number | null; ownerName: string | null;
  dueAt: Date | null; overdue: boolean; status: "open" | "done" | "dismissed"; createdAt: Date;
};

export async function listFollowUps(opts: { status?: "open" | "all"; chapterId?: number } = {}): Promise<FollowUpRow[]> {
  const conds = [];
  if ((opts.status ?? "open") === "open") conds.push(eq(schema.followUps.status, "open"));
  if (opts.chapterId != null) conds.push(eq(schema.followUps.chapterId, opts.chapterId));
  const rows = await getDb().select({
    id: schema.followUps.id, title: schema.followUps.title,
    chapterId: schema.followUps.chapterId, chapterName: schema.chapters.name,
    prospectId: schema.followUps.prospectId,
    ownerUserId: schema.followUps.ownerUserId, ownerName: schema.users.name,
    dueAt: schema.followUps.dueAt, status: schema.followUps.status, createdAt: schema.followUps.createdAt,
  }).from(schema.followUps)
    .leftJoin(schema.chapters, eq(schema.chapters.id, schema.followUps.chapterId))
    .leftJoin(schema.users, eq(schema.users.id, schema.followUps.ownerUserId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(schema.followUps.dueAt)).limit(300);
  const now = Date.now();
  return rows.map((r) => ({ ...r, overdue: r.dueAt ? new Date(r.dueAt).getTime() < now : false }));
}

export async function setFollowUpStatus(id: number, status: "done" | "dismissed"): Promise<void> {
  await getDb().update(schema.followUps)
    .set({ status, doneAt: status === "done" ? new Date() : null })
    .where(and(eq(schema.followUps.id, id), inArray(schema.followUps.status, ["open"])));
}
