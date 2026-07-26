import { and, eq, inArray } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";
import {
  CADENCE_TEMPLATES, recentPeriodKeys, type Frequency, type CadenceStatus,
} from "@contracts/cadence";

const WINDOW = 8; // completed periods adherence is measured over

export type CadenceView = {
  id: number; type: string; title: string; frequency: string; ownerRole: string | null; sop: string | null;
  currentKey: string; currentStatus: CadenceStatus | "open";
  kept: number; expected: number; missed: number; adherence: number; // over the last WINDOW periods
};

/** Set a chapter up to standard — seed the standard cadences it's missing. */
export async function ensureCadenceTemplates(chapterId: number): Promise<number> {
  const db = getDb();
  const existing = await db.select().from(schema.cadences).where(eq(schema.cadences.chapterId, chapterId));
  const have = new Set(existing.map((c) => c.type));
  const toAdd = CADENCE_TEMPLATES.filter((t) => !have.has(t.type));
  if (toAdd.length) {
    await db.insert(schema.cadences).values(toAdd.map((t) => ({
      chapterId, type: t.type, title: t.title, frequency: t.freq, ownerRole: t.owner, sop: t.sop,
    })));
  }
  return toAdd.length;
}

/** List a chapter's cadences with current status + rolling adherence. */
export async function listCadences(chapterId: number, now = new Date()): Promise<{ cadences: CadenceView[]; adherence: number }> {
  const db = getDb();
  const rows = await db.select().from(schema.cadences)
    .where(and(eq(schema.cadences.chapterId, chapterId), eq(schema.cadences.active, 1)));
  if (!rows.length) return { cadences: [], adherence: 100 };

  const ids = rows.map((r) => r.id);
  const logs = await db.select().from(schema.cadenceLog).where(inArray(schema.cadenceLog.cadenceId, ids));
  const byCadence = new Map<number, Map<string, CadenceStatus>>();
  for (const l of logs) {
    if (!byCadence.has(l.cadenceId)) byCadence.set(l.cadenceId, new Map());
    byCadence.get(l.cadenceId)!.set(l.periodKey, l.status as CadenceStatus);
  }

  let totalKept = 0, totalExpected = 0;
  const out: CadenceView[] = rows.map((c) => {
    const { current, history } = recentPeriodKeys(c.frequency as Frequency, now, WINDOW);
    const log = byCadence.get(c.id) ?? new Map<string, CadenceStatus>();
    // A past period counts as kept if it was recorded kept or rescheduled.
    let kept = 0;
    for (const k of history) { const s = log.get(k); if (s === "kept" || s === "rescheduled") kept++; }
    const expected = history.length;
    const missed = expected - kept;
    const currentStatus = (log.get(current) ?? "open") as CadenceStatus | "open";
    totalKept += kept; totalExpected += expected;
    return {
      id: c.id, type: c.type, title: c.title, frequency: c.frequency, ownerRole: c.ownerRole, sop: c.sop,
      currentKey: current, currentStatus, kept, expected, missed,
      adherence: expected ? Math.round((kept / expected) * 100) : 100,
    };
  });
  return { cadences: out, adherence: totalExpected ? Math.round((totalKept / totalExpected) * 100) : 100 };
}

/** Record the current period of a cadence as kept / rescheduled / missed. */
export async function recordCadence(cadenceId: number, status: CadenceStatus, note: string | undefined, actorMemberId: number | null, now = new Date()): Promise<{ chapterId: number }> {
  const db = getDb();
  const cad = (await db.select().from(schema.cadences).where(eq(schema.cadences.id, cadenceId)).limit(1)).at(0);
  if (!cad) throw new Error("cadence not found");
  const { current } = recentPeriodKeys(cad.frequency as Frequency, now, 0);
  await db.delete(schema.cadenceLog)
    .where(and(eq(schema.cadenceLog.cadenceId, cadenceId), eq(schema.cadenceLog.periodKey, current)));
  await db.insert(schema.cadenceLog).values({ cadenceId, periodKey: current, status, note, actorMemberId });
  return { chapterId: cad.chapterId };
}
