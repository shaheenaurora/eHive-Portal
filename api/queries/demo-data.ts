import { and, eq, inArray, like, or } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";

/**
 * Remove ONLY the seeded demo data, leaving real accounts and anything created
 * by hand untouched. Demo rows are identified by reliable markers:
 *   - users.unionId LIKE 'seed-%'            (all seeded accounts)
 *   - chapters.code IN (the seed chapter codes)
 *   - the seeded Zone/Region/Country org units (exact name+level)
 *   - pods/events whose entire roster/registration list is seed members
 *
 * Idempotent (safe to run twice) and additive-safe (never deletes a row that
 * isn't demonstrably seed data). Returns counts of what was removed.
 */
const SEED_CHAPTER_CODES = ["AE-DXB-01", "AE-AUH-01", "AE-SHJ-01"];
const SEED_ORG_UNITS: { level: "zone" | "region" | "country"; name: string }[] = [
  { level: "country", name: "United Arab Emirates" },
  { level: "region", name: "Gulf" },
  { level: "zone", name: "Dubai Zone" },
  { level: "zone", name: "Abu Dhabi Zone" },
  { level: "zone", name: "Northern Emirates Zone" },
];

export async function removeDemoData(): Promise<Record<string, number>> {
  const db = getDb();
  const removed: Record<string, number> = {};
  const del = async (label: string, n: number) => { if (n) removed[label] = (removed[label] ?? 0) + n; };

  // ---- identify the seed accounts + their members ----
  const seedUsers = await db.select({ id: schema.users.id }).from(schema.users).where(like(schema.users.unionId, "seed-%"));
  const userIds = seedUsers.map((u) => u.id);
  const seedMembers = userIds.length
    ? await db.select({ id: schema.members.id }).from(schema.members).where(inArray(schema.members.userId, userIds))
    : [];
  const memberIds = seedMembers.map((m) => m.id);
  const inMembers = (col: never) => inArray(col, memberIds);

  // ---- demo pods (roster entirely seed) + their sessions ----
  const podRows = await db.select({ podId: schema.podMembers.podId, memberId: schema.podMembers.memberId }).from(schema.podMembers);
  const byPod = new Map<number, number[]>();
  for (const r of podRows) { const a = byPod.get(r.podId) ?? []; a.push(r.memberId); byPod.set(r.podId, a); }
  const seedSet = new Set(memberIds);
  const demoPodIds = [...byPod.entries()].filter(([, ms]) => ms.length > 0 && ms.every((m) => seedSet.has(m))).map(([p]) => p);

  // ---- demo events (registrations entirely seed) ----
  const regRows = await db.select({ eventId: schema.eventRegs.eventId, memberId: schema.eventRegs.memberId }).from(schema.eventRegs);
  const byEvent = new Map<number, number[]>();
  for (const r of regRows) { const a = byEvent.get(r.eventId) ?? []; a.push(r.memberId); byEvent.set(r.eventId, a); }
  const demoEventIds = [...byEvent.entries()].filter(([, ms]) => ms.length > 0 && ms.every((m) => seedSet.has(m))).map(([e]) => e);

  // ---- demo chapters ----
  const demoChapters = await db.select({ id: schema.chapters.id }).from(schema.chapters).where(inArray(schema.chapters.code, SEED_CHAPTER_CODES));
  const chapterIds = demoChapters.map((c) => c.id);

  // ================= delete, children first =================
  if (memberIds.length) {
    // member-keyed community rows
    await del("scoreEvents", (await db.delete(schema.scoreEvents).where(inMembers(schema.scoreEvents.memberId as never)))[0].affectedRows);
    await del("hiveScoreHistory", (await db.delete(schema.hiveScoreHistory).where(inMembers(schema.hiveScoreHistory.memberId as never)))[0].affectedRows);
    await del("attendance", (await db.delete(schema.attendance).where(inMembers(schema.attendance.memberId as never)))[0].affectedRows);
    await del("actionItems", (await db.delete(schema.actionItems).where(inMembers(schema.actionItems.memberId as never)))[0].affectedRows);
    await del("membershipEvents", (await db.delete(schema.membershipEvents).where(inMembers(schema.membershipEvents.memberId as never)))[0].affectedRows);
    await del("onboardingMilestones", (await db.delete(schema.onboardingMilestones).where(inMembers(schema.onboardingMilestones.memberId as never)))[0].affectedRows);
    await del("notifications", (await db.delete(schema.notifications).where(inMembers(schema.notifications.memberId as never)))[0].affectedRows);
    await del("referrals", (await db.delete(schema.referrals).where(inMembers(schema.referrals.memberId as never)))[0].affectedRows);
    await del("dormancyLog", (await db.delete(schema.dormancyLog).where(inMembers(schema.dormancyLog.memberId as never)))[0].affectedRows);
    await del("frpEnrolments", (await db.delete(schema.frpEnrolments).where(inMembers(schema.frpEnrolments.memberId as never)))[0].affectedRows);
    await del("podMembers", (await db.delete(schema.podMembers).where(inMembers(schema.podMembers.memberId as never)))[0].affectedRows);
    await del("eventRegs", (await db.delete(schema.eventRegs).where(inMembers(schema.eventRegs.memberId as never)))[0].affectedRows);
    await del("chapterRoles", (await db.delete(schema.chapterRoles).where(inMembers(schema.chapterRoles.memberId as never)))[0].affectedRows);
    await del("meetingAttendance", (await db.delete(schema.meetingAttendance).where(inMembers(schema.meetingAttendance.memberId as never)))[0].affectedRows);
    await del("pushSubscriptions", (await db.delete(schema.pushSubscriptions).where(inMembers(schema.pushSubscriptions.memberId as never)))[0].affectedRows);
    await del("buddies", (await db.delete(schema.buddies).where(or(inArray(schema.buddies.newMemberId, memberIds), inArray(schema.buddies.buddyMemberId, memberIds))))[0].affectedRows);
    await del("oneToOnes", (await db.delete(schema.oneToOnes).where(or(inArray(schema.oneToOnes.aMemberId, memberIds), inArray(schema.oneToOnes.bMemberId, memberIds))))[0].affectedRows);
    await del("conductCases", (await db.delete(schema.conductCases).where(or(inArray(schema.conductCases.reporterMemberId, memberIds), inArray(schema.conductCases.subjectMemberId, memberIds))))[0].affectedRows);
    await del("members", (await db.delete(schema.members).where(inArray(schema.members.id, memberIds)))[0].affectedRows);
  }

  if (userIds.length) {
    await del("applications", (await db.delete(schema.applications).where(inArray(schema.applications.userId, userIds)))[0].affectedRows);
    await del("paymentRecords", (await db.delete(schema.paymentRecords).where(inArray(schema.paymentRecords.userId, userIds)))[0].affectedRows);
    await del("authTokens", (await db.delete(schema.authTokens).where(inArray(schema.authTokens.userId, userIds)))[0].affectedRows);
    await del("users", (await db.delete(schema.users).where(inArray(schema.users.id, userIds)))[0].affectedRows);
  }

  // demo pods + their sessions/notes/action items
  if (demoPodIds.length) {
    const sess = await db.select({ id: schema.sessions.id }).from(schema.sessions).where(inArray(schema.sessions.podId, demoPodIds));
    const sessionIds = sess.map((s) => s.id);
    if (sessionIds.length) {
      await del("sessionNotes", (await db.delete(schema.sessionNotes).where(inArray(schema.sessionNotes.sessionId, sessionIds)))[0].affectedRows);
      await del("attendance", (await db.delete(schema.attendance).where(inArray(schema.attendance.sessionId, sessionIds)))[0].affectedRows);
      await del("sessions", (await db.delete(schema.sessions).where(inArray(schema.sessions.id, sessionIds)))[0].affectedRows);
    }
    await del("podMembers", (await db.delete(schema.podMembers).where(inArray(schema.podMembers.podId, demoPodIds)))[0].affectedRows);
    await del("pods", (await db.delete(schema.pods).where(inArray(schema.pods.id, demoPodIds)))[0].affectedRows);
  }

  // demo events
  if (demoEventIds.length) {
    await del("eventRegs", (await db.delete(schema.eventRegs).where(inArray(schema.eventRegs.eventId, demoEventIds)))[0].affectedRows);
    await del("eventFeedback", (await db.delete(schema.eventFeedback).where(inArray(schema.eventFeedback.eventId, demoEventIds)))[0].affectedRows);
    await del("events", (await db.delete(schema.events).where(inArray(schema.events.id, demoEventIds)))[0].affectedRows);
  }

  // demo chapters + chapter-keyed governance/finance
  if (chapterIds.length) {
    await del("chapterRoles", (await db.delete(schema.chapterRoles).where(inArray(schema.chapterRoles.chapterId, chapterIds)))[0].affectedRows);
    await del("healthSnapshots", (await db.delete(schema.healthSnapshots).where(inArray(schema.healthSnapshots.chapterId, chapterIds)))[0].affectedRows);
    await del("chapterPosts", (await db.delete(schema.chapterPosts).where(inArray(schema.chapterPosts.chapterId, chapterIds)))[0].affectedRows);
    await del("chapterBudgets", (await db.delete(schema.chapterBudgets).where(inArray(schema.chapterBudgets.chapterId, chapterIds)))[0].affectedRows);
    await del("chapterTransfers", (await db.delete(schema.chapterTransfers).where(inArray(schema.chapterTransfers.toChapterId, chapterIds)))[0].affectedRows);
    await del("meetings", (await db.delete(schema.meetings).where(inArray(schema.meetings.chapterId, chapterIds)))[0].affectedRows);
    await del("elections", (await db.delete(schema.elections).where(inArray(schema.elections.chapterId, chapterIds)))[0].affectedRows);
    await del("motions", (await db.delete(schema.motions).where(inArray(schema.motions.chapterId, chapterIds)))[0].affectedRows);
    const cads = await db.select({ id: schema.cadences.id }).from(schema.cadences).where(inArray(schema.cadences.chapterId, chapterIds));
    const cadIds = cads.map((c) => c.id);
    if (cadIds.length) await del("cadenceLog", (await db.delete(schema.cadenceLog).where(inArray(schema.cadenceLog.cadenceId, cadIds)))[0].affectedRows);
    await del("cadences", (await db.delete(schema.cadences).where(inArray(schema.cadences.chapterId, chapterIds)))[0].affectedRows);
    await del("chapters", (await db.delete(schema.chapters).where(inArray(schema.chapters.id, chapterIds)))[0].affectedRows);
  }

  // seeded org hierarchy (exact matches only)
  for (const u of SEED_ORG_UNITS) {
    const r = await db.delete(schema.orgUnits).where(and(eq(schema.orgUnits.level, u.level), eq(schema.orgUnits.name, u.name)));
    await del("orgUnits", r[0].affectedRows);
  }

  return removed;
}
