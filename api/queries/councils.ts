import { desc, eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";

/** Meetings + decisions for a council (org unit), newest first. */
export async function listCouncil(unitId: number) {
  const db = getDb();
  const [meetings, decisions] = await Promise.all([
    db.select().from(schema.councilMeetings)
      .where(eq(schema.councilMeetings.unitId, unitId))
      .orderBy(desc(schema.councilMeetings.scheduledAt), desc(schema.councilMeetings.createdAt)).limit(100),
    db.select().from(schema.councilDecisions)
      .where(eq(schema.councilDecisions.unitId, unitId))
      .orderBy(desc(schema.councilDecisions.createdAt)).limit(200),
  ]);
  return { meetings, decisions };
}

export async function createCouncilMeeting(
  unitId: number, input: { title: string; scheduledAt?: Date | null; agenda?: string | null },
): Promise<number> {
  const res = await getDb().insert(schema.councilMeetings).values({
    unitId, title: input.title.slice(0, 255),
    scheduledAt: input.scheduledAt ?? null, agenda: input.agenda ?? null,
  });
  return Number((res as unknown as { insertId?: number }).insertId ?? 0);
}

export async function updateCouncilMeeting(
  id: number, patch: { status?: "scheduled" | "held" | "cancelled"; agenda?: string; minutes?: string },
): Promise<void> {
  const set: Record<string, unknown> = {};
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.agenda !== undefined) set.agenda = patch.agenda;
  if (patch.minutes !== undefined) set.minutes = patch.minutes;
  if (Object.keys(set).length) {
    await getDb().update(schema.councilMeetings).set(set).where(eq(schema.councilMeetings.id, id));
  }
}

export async function logDecision(
  unitId: number, input: { meetingId?: number | null; title: string; detail?: string | null },
): Promise<number> {
  const res = await getDb().insert(schema.councilDecisions).values({
    unitId, meetingId: input.meetingId ?? null,
    title: input.title.slice(0, 255), detail: input.detail ?? null, status: "proposed",
  });
  return Number((res as unknown as { insertId?: number }).insertId ?? 0);
}

/** Record the outcome of a motion. A resolved status stamps decidedAt. */
export async function updateDecision(
  id: number, status: "proposed" | "carried" | "failed" | "deferred",
): Promise<void> {
  await getDb().update(schema.councilDecisions)
    .set({ status, decidedAt: status === "proposed" ? null : new Date() })
    .where(eq(schema.councilDecisions.id, id));
}
