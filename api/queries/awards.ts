import { and, desc, eq, sql, isNull, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import * as schema from "@db/schema";
import { getDb } from "./connection";
import type {
  AwardCycleStatus,
  AwardNominationStatus,
} from "@contracts/constants";

/** All award cycles, newest first, with a nomination count each. */
export async function listCycles() {
  const db = getDb();
  const cycles = await db
    .select()
    .from(schema.awardCycles)
    .orderBy(desc(schema.awardCycles.createdAt))
    .limit(50);
  const counts = await db
    .select({
      cycleId: schema.awardNominations.cycleId,
      n: sql<number>`count(*)`,
    })
    .from(schema.awardNominations)
    .groupBy(schema.awardNominations.cycleId);
  const byId = new Map(counts.map(c => [c.cycleId, Number(c.n)]));

  // Resolve the scoped unit's name for chapter/zone/region/country cycles.
  const chapterIds = cycles
    .filter(c => c.level === "chapter" && c.unitId)
    .map(c => c.unitId as number);
  const orgIds = cycles
    .filter(c => c.level !== "chapter" && c.level !== "network" && c.unitId)
    .map(c => c.unitId as number);
  const unitName = new Map<string, string>(); // `${level==chapter?'ch':'ou'}:${id}` -> name
  if (chapterIds.length) {
    const rows = await db
      .select({ id: schema.chapters.id, name: schema.chapters.name })
      .from(schema.chapters)
      .where(inArray(schema.chapters.id, chapterIds));
    for (const r of rows) unitName.set(`ch:${r.id}`, r.name);
  }
  if (orgIds.length) {
    const rows = await db
      .select({ id: schema.orgUnits.id, name: schema.orgUnits.name })
      .from(schema.orgUnits)
      .where(inArray(schema.orgUnits.id, orgIds));
    for (const r of rows) unitName.set(`ou:${r.id}`, r.name);
  }

  return cycles.map(c => ({
    ...c,
    nominations: byId.get(c.id) ?? 0,
    unitName: c.unitId
      ? (unitName.get(`${c.level === "chapter" ? "ch" : "ou"}:${c.unitId}`) ??
        null)
      : null,
  }));
}

/** The single cycle currently open for member nominations, if any. */
export async function openCycle() {
  return (
    (
      await getDb()
        .select()
        .from(schema.awardCycles)
        .where(eq(schema.awardCycles.status, "open"))
        .limit(1)
    ).at(0) ?? null
  );
}

export async function createCycle(input: {
  name: string;
  level?: "network" | "chapter" | "zone" | "region" | "country";
  unitId?: number | null;
  opensAt?: Date | null;
  closesAt?: Date | null;
}): Promise<number> {
  const level = input.level ?? "network";
  const res = await getDb()
    .insert(schema.awardCycles)
    .values({
      name: input.name.slice(0, 160),
      level,
      unitId: level === "network" ? null : (input.unitId ?? null),
      opensAt: input.opensAt ?? null,
      closesAt: input.closesAt ?? null,
      status: "draft",
    });
  return Number((res as unknown as { insertId?: number }).insertId ?? 0);
}

/** Units selectable for an award level: chapters for chapter level, org_units
 *  (filtered to the level) for zone/region/country. Network has no unit. */
export async function awardUnits(
  level: "chapter" | "zone" | "region" | "country"
): Promise<{ id: number; name: string }[]> {
  const db = getDb();
  if (level === "chapter") {
    return db
      .select({ id: schema.chapters.id, name: schema.chapters.name })
      .from(schema.chapters)
      .where(isNull(schema.chapters.deletedAt))
      .orderBy(schema.chapters.name);
  }
  return db
    .select({ id: schema.orgUnits.id, name: schema.orgUnits.name })
    .from(schema.orgUnits)
    .where(eq(schema.orgUnits.level, level))
    .orderBy(schema.orgUnits.name);
}

export async function updateCycleStatus(
  id: number,
  status: AwardCycleStatus
): Promise<void> {
  await getDb()
    .update(schema.awardCycles)
    .set({ status })
    .where(eq(schema.awardCycles.id, id));
}

export type NominationRow = {
  id: number;
  category: string;
  status: AwardNominationStatus;
  nomineeMemberId: number | null;
  nomineeName: string | null;
  nomineeChapterId: number | null;
  nomineeChapterName: string | null;
  nominatedByMemberId: number | null;
  nominatedByName: string | null;
  citation: string | null;
  createdAt: Date;
};

/** Nominations in a cycle with nominee/nominator names resolved. */
export async function listNominations(
  cycleId: number
): Promise<NominationRow[]> {
  const nominee = alias(schema.users, "nominee");
  const nominator = alias(schema.users, "nominator");
  const nomineeMember = alias(schema.members, "nomineeMember");
  const nominatorMember = alias(schema.members, "nominatorMember");
  return getDb()
    .select({
      id: schema.awardNominations.id,
      category: schema.awardNominations.category,
      status: schema.awardNominations.status,
      nomineeMemberId: schema.awardNominations.nomineeMemberId,
      nomineeName: nominee.name,
      nomineeChapterId: schema.awardNominations.nomineeChapterId,
      nomineeChapterName: schema.chapters.name,
      nominatedByMemberId: schema.awardNominations.nominatedByMemberId,
      nominatedByName: nominator.name,
      citation: schema.awardNominations.citation,
      createdAt: schema.awardNominations.createdAt,
    })
    .from(schema.awardNominations)
    .leftJoin(
      nomineeMember,
      eq(nomineeMember.id, schema.awardNominations.nomineeMemberId)
    )
    .leftJoin(nominee, eq(nominee.id, nomineeMember.userId))
    .leftJoin(
      schema.chapters,
      eq(schema.chapters.id, schema.awardNominations.nomineeChapterId)
    )
    .leftJoin(
      nominatorMember,
      eq(nominatorMember.id, schema.awardNominations.nominatedByMemberId)
    )
    .leftJoin(nominator, eq(nominator.id, nominatorMember.userId))
    .where(eq(schema.awardNominations.cycleId, cycleId))
    .orderBy(desc(schema.awardNominations.createdAt))
    .limit(500);
}

export async function nominate(input: {
  cycleId: number;
  category: string;
  nomineeMemberId?: number | null;
  nomineeChapterId?: number | null;
  nominatedByMemberId?: number | null;
  citation?: string | null;
}): Promise<number> {
  const res = await getDb()
    .insert(schema.awardNominations)
    .values({
      cycleId: input.cycleId,
      category: input.category,
      nomineeMemberId: input.nomineeMemberId ?? null,
      nomineeChapterId: input.nomineeChapterId ?? null,
      nominatedByMemberId: input.nominatedByMemberId ?? null,
      citation: input.citation ?? null,
      status: "nominated",
    });
  return Number((res as unknown as { insertId?: number }).insertId ?? 0);
}

/** A member may nominate a given nominee once per category per cycle. */
export async function alreadyNominated(
  cycleId: number,
  category: string,
  byMemberId: number
): Promise<boolean> {
  const rows = await getDb()
    .select({ id: schema.awardNominations.id })
    .from(schema.awardNominations)
    .where(
      and(
        eq(schema.awardNominations.cycleId, cycleId),
        eq(schema.awardNominations.category, category),
        eq(schema.awardNominations.nominatedByMemberId, byMemberId)
      )
    )
    .limit(1);
  return rows.length > 0;
}

export async function setNominationStatus(
  id: number,
  status: AwardNominationStatus
): Promise<void> {
  await getDb()
    .update(schema.awardNominations)
    .set({ status })
    .where(eq(schema.awardNominations.id, id));
}

/** Winners of announced cycles — the public recognition wall. */
export async function announcedWinners(): Promise<NominationRow[]> {
  const db = getDb();
  const announced = await db
    .select({ id: schema.awardCycles.id })
    .from(schema.awardCycles)
    .where(eq(schema.awardCycles.status, "announced"));
  if (!announced.length) return [];
  const all = await Promise.all(announced.map(c => listNominations(c.id)));
  return all.flat().filter(n => n.status === "winner");
}
