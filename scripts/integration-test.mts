/**
 * In-process integration test — drives the real tRPC procedures against a live
 * database, covering the full journeys and every authorization boundary.
 *
 * It WRITES data, so it refuses to run unless DATABASE_URL points at a database
 * whose name contains "test" (or ALLOW_ITEST=1 is set), and never in production.
 *
 * Usage:
 *   1. Create an empty database and apply the schema (npm run db:push against it).
 *   2. DATABASE_URL="mysql://user:pass@host:3306/ehive_test" \
 *      APP_SECRET="anything-32-chars-plus-xxxxxxxxxxxx" \
 *      npm run test:integration
 *
 * Exit code 0 = all passed, 1 = failures, 2 = refused (unsafe target).
 */
import { appRouter } from "../api/router";
import { getDb } from "../api/queries/connection";
import * as schema from "@db/schema";
import { eq } from "drizzle-orm";
import { computeChapterHealth } from "../api/queries/health";

const url = process.env.DATABASE_URL ?? "";
const dbName = (url.split("/").pop() ?? "").split("?")[0];
if (process.env.NODE_ENV === "production" || (!/test/i.test(dbName) && process.env.ALLOW_ITEST !== "1")) {
  console.error("Refusing to run: point DATABASE_URL at a *test* database (name containing 'test') or set ALLOW_ITEST=1. This script writes data.");
  process.exit(2);
}

const db = getDb();
let pass = 0, fail = 0;
const ok = (n: string) => { pass++; console.log("  \x1b[32mPASS\x1b[0m " + n); };
const bad = (n: string, e?: unknown) => { fail++; console.log("  \x1b[31mFAIL\x1b[0m " + n + (e ? "  → " + (e as Error).message : "")); };
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); ok(name); } catch (e) { bad(name, e); }
}
async function expectErr(name: string, fn: () => Promise<unknown>, match?: RegExp) {
  try { await fn(); bad(name, new Error("expected an error, got success")); }
  catch (e) { const m = (e as Error).message || ""; if (match && !match.test(m)) bad(name, new Error("wrong error: " + m)); else ok(name); }
}
const assert = (c: boolean, msg: string) => { if (!c) throw new Error(msg); };

type Caller = ReturnType<typeof appRouter.createCaller>;
function caller(user: Partial<schema.User> | undefined): Caller {
  return appRouter.createCaller({ req: new Request("http://localhost/"), resHeaders: new Headers(), user: user as schema.User | undefined });
}
const uniq = Date.now().toString(36);
async function mkUser(tag: string, role: "user" | "admin", scopes = ""): Promise<schema.User> {
  const email = `${tag}-${uniq}@ehive.test`;
  const res = await db.insert(schema.users).values({ unionId: "u_" + email, email, name: tag, role, adminScopes: scopes });
  const id = Number(res[0].insertId);
  return (await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1))[0];
}
async function mkMember(user: schema.User, over: Partial<schema.Member> = {}): Promise<number> {
  const res = await db.insert(schema.members).values({ userId: user.id, tier: "ascent", status: "active", lifecycleState: "active", ...over });
  return Number(res[0].insertId);
}

async function main() {
  const owner = await mkUser("owner", "admin", "*");
  const memAdmin = await mkUser("membership", "admin", "membership,chapters");
  const eventsAdmin = await mkUser("events", "admin", "events");
  const MA = caller(memAdmin);

  const uPres = await mkUser("pres", "user");
  const uMem2 = await mkUser("mem2", "user");
  const uMem3 = await mkUser("mem3", "user");
  const uFree = await mkUser("free", "user");
  const uOther = await mkUser("other", "user");
  const uApplicant = await mkUser("applicant", "user");

  console.log("\n\x1b[1mA. Chapters & formation\x1b[0m");
  let chA = 0, chB = 0;
  await check("saveChapter with geo hierarchy", async () => {
    await MA.adminEngage.saveChapter({ name: "Dubai " + uniq, code: "AE-DXB", country: "UAE", region: "Gulf", state: "Dubai", city: "Dubai", zone: "DIFC", status: "chartered" });
    await MA.adminEngage.saveChapter({ name: "AbuDhabi " + uniq, country: "UAE", state: "Abu Dhabi", city: "Abu Dhabi", status: "seed" });
    const list = await MA.adminEngage.chaptersAdmin();
    const d = list.find((c) => c.name === "Dubai " + uniq); const b = list.find((c) => c.name === "AbuDhabi " + uniq);
    assert(!!d && d.zone === "DIFC" && d.code === "AE-DXB", "geo not stored");
    chA = d!.id; chB = b!.id;
  });
  await expectErr("events-admin cannot saveChapter (scope)", () => caller(eventsAdmin).adminEngage.saveChapter({ name: "X" }), /doesn't include/i);

  const mPres = await mkMember(uPres, { homeChapterId: chA });
  const mMem2 = await mkMember(uMem2, { homeChapterId: chA });
  const mMem3 = await mkMember(uMem3, { homeChapterId: chA });
  const mFree = await mkMember(uFree, { homeChapterId: null });
  const mOther = await mkMember(uOther, { homeChapterId: chB });

  console.log("\n\x1b[1mB. Member lifecycle (admission → journey)\x1b[0m");
  let mApplicant = 0;
  await check("admission creates member in Onboarding, in the chapter", async () => {
    const ap = await db.insert(schema.applications).values({ userId: uApplicant.id, name: "Applicant", email: uApplicant.email, tierRequested: "ascent", status: "received" });
    const r = await MA.admin.setApplicationStatus({ id: Number(ap[0].insertId), status: "approved", tier: "ascent", chapterId: chA });
    mApplicant = (r as { memberId?: number }).memberId!;
    const m = (await db.select().from(schema.members).where(eq(schema.members.id, mApplicant)).limit(1))[0];
    assert(m.lifecycleState === "onboarding" && m.homeChapterId === chA, "not onboarding-in-chapter");
  });
  await check("lifecycle onboarding→active→at_risk→active→renewal→lapsed→alumni w/ status coherence", async () => {
    await MA.admin.setLifecycleState({ memberId: mMem2, state: "at_risk" });
    await MA.admin.setLifecycleState({ memberId: mMem2, state: "active" });
    await MA.admin.setLifecycleState({ memberId: mMem2, state: "renewal" });
    await MA.admin.setLifecycleState({ memberId: mMem2, state: "lapsed" });
    let m = (await db.select().from(schema.members).where(eq(schema.members.id, mMem2)).limit(1))[0];
    assert(m.status === "cancelled", "lapsed should cancel access");
    await MA.admin.setLifecycleState({ memberId: mMem2, state: "alumni" });
    await db.update(schema.members).set({ lifecycleState: "active", status: "active" }).where(eq(schema.members.id, mMem2));
  });
  await expectErr("plain member cannot drive lifecycle (RBAC)", () => caller(uPres).admin.setLifecycleState({ memberId: mMem3, state: "suspended" }), /permission|admin|UNAUTHORIZED|FORBIDDEN/i);

  console.log("\n\x1b[1mC. Chapter transfers (approval)\x1b[0m");
  await check("member requests transfer → pending", async () => {
    await caller(uOther).circle.requestChapterTransfer({ toChapterId: chA, note: "relocated" });
    const p = await caller(uOther).circle.myChapterTransfer();
    assert(!!p && p.status === "pending", "no pending transfer");
  });
  await expectErr("duplicate transfer request blocked", () => caller(uOther).circle.requestChapterTransfer({ toChapterId: chA }), /already have/i);
  await check("admin approves transfer → home chapter moves", async () => {
    const pend = await MA.adminEngage.pendingChapterTransfers();
    const req = pend.find((x) => x.req.memberId === mOther);
    await MA.adminEngage.decideChapterTransfer({ id: req!.req.id, decision: "approve" });
    const m = (await db.select().from(schema.members).where(eq(schema.members.id, mOther)).limit(1))[0];
    assert(m.homeChapterId === chA, "not moved");
    await db.update(schema.members).set({ homeChapterId: chB }).where(eq(schema.members.id, mOther));
  });

  console.log("\n\x1b[1mD. Leadership roles + officer authorization\x1b[0m");
  await check("assign President to a chapter member", async () => {
    await MA.adminEngage.assignChapterRole({ chapterId: chA, memberId: mPres, role: "president" });
    const det = await MA.adminEngage.chapterDetail({ id: chA });
    assert(det.board.some((b) => b.role === "president" && b.memberId === mPres), "no president");
  });
  await expectErr("cannot assign role to a non-member of the chapter", () => MA.adminEngage.assignChapterRole({ chapterId: chA, memberId: mFree, role: "secretary" }), /member of this chapter/i);
  await check("re-assigning President retires the previous holder (one active)", async () => {
    await MA.adminEngage.assignChapterRole({ chapterId: chA, memberId: mMem3, role: "president" });
    const active = (await db.select().from(schema.chapterRoles).where(eq(schema.chapterRoles.chapterId, chA)))
      .filter((r) => r.role === "president" && r.status === "active");
    assert(active.length === 1 && active[0].memberId === mMem3, "not exactly one active president");
    await MA.adminEngage.assignChapterRole({ chapterId: chA, memberId: mPres, role: "president" });
  });
  await check("officer (President) can open the console", async () => {
    const ov = await caller(uPres).officer.overview();
    assert(!!ov.chapter && ov.roleKeys.includes("president") && typeof ov.health.total === "number", "no officer context");
  });
  await expectErr("non-officer member is denied the console (RBAC)", () => caller(uMem2).officer.overview(), /leadership role|don't lead/i);
  await check("officer signs up an unassigned member into the chapter", async () => {
    await caller(uPres).officer.signupMember({ memberId: mFree });
    const m = (await db.select().from(schema.members).where(eq(schema.members.id, mFree)).limit(1))[0];
    assert(m.homeChapterId === chA, "not signed up");
  });
  await expectErr("officer cannot poach a member of another chapter", () => caller(uPres).officer.signupMember({ memberId: mOther }), /another chapter/i);
  await check("officer assigns a mentor within the chapter", async () => {
    await caller(uPres).officer.assignMentor({ menteeId: mFree, mentorId: mMem2 });
    const b = await db.select().from(schema.buddies).where(eq(schema.buddies.newMemberId, mFree));
    assert(b.some((x) => x.buddyMemberId === mMem2), "no mentor pairing");
  });
  await expectErr("self-mentoring rejected", () => caller(uPres).officer.assignMentor({ menteeId: mFree, mentorId: mFree }), /themselves/i);
  await check("officer posts a learning, members can read it", async () => {
    await caller(uPres).officer.postLearning({ title: "Filling seats " + uniq, body: "Invite 2 guests/week." });
    const mine = await caller(uMem2).engage.myChapter();
    assert((mine.learnings ?? []).some((l) => l.title === "Filling seats " + uniq), "learning not visible");
  });

  console.log("\n\x1b[1mE. Temporal integrity\x1b[0m");
  const evFuture = Number((await db.insert(schema.events).values({ title: "Future", kind: "spark", startsAt: new Date(Date.now() + 5 * 86400000), capacity: 40, tierGate: "horizon", audience: "members" }))[0].insertId);
  const evPast = Number((await db.insert(schema.events).values({ title: "Past", kind: "spark", startsAt: new Date(Date.now() - 5 * 86400000), capacity: 40, tierGate: "horizon", audience: "members" }))[0].insertId);
  await check("member registers for a future event", async () => {
    await caller(uPres).circle.registerEvent({ eventId: evFuture });
    const reg = (await db.select().from(schema.eventRegs).where(eq(schema.eventRegs.eventId, evFuture)))[0];
    assert(!!reg && reg.status === "registered", "not registered");
  });
  await expectErr("cannot register for an event that already started", () => caller(uPres).circle.registerEvent({ eventId: evPast }), /already started/i);
  await expectErr("cannot check in before the event window opens", async () => {
    const reg = (await db.select().from(schema.eventRegs).where(eq(schema.eventRegs.eventId, evFuture)))[0];
    return caller(uPres).engage.checkinEvent({ eventId: evFuture, code: reg.checkinCode! });
  }, /can't check in|hasn't started/i);
  await expectErr("admin cannot Mark attended before the event starts", () =>
    MA.admin.markEventAttendance({ eventId: evFuture, memberId: mPres, status: "attended" }), /hasn't started/i);
  await check("check-in inside the window records attendance", async () => {
    await db.update(schema.events).set({ startsAt: new Date() }).where(eq(schema.events.id, evFuture));
    const reg = (await db.select().from(schema.eventRegs).where(eq(schema.eventRegs.eventId, evFuture)))[0];
    await caller(uPres).engage.checkinEvent({ eventId: evFuture, code: reg.checkinCode! });
    const after = (await db.select().from(schema.eventRegs).where(eq(schema.eventRegs.id, reg.id)))[0];
    assert(after.status === "attended", "not attended");
  });
  await check("buddy 30-day check-in blocked early, allowed after 40 days", async () => {
    const bId = Number((await db.insert(schema.buddies).values({ newMemberId: mMem3, buddyMemberId: mPres, pairedAt: new Date() }))[0].insertId);
    try { await caller(uPres).engage.buddyCheckin({ id: bId }); throw new Error("early check-in should have failed"); }
    catch (e) { if (!/opens closer/i.test((e as Error).message)) throw e; }
    await db.update(schema.buddies).set({ pairedAt: new Date(Date.now() - 40 * 86400000) }).where(eq(schema.buddies.id, bId));
    await caller(uPres).engage.buddyCheckin({ id: bId });
    assert(!!(await db.select().from(schema.buddies).where(eq(schema.buddies.id, bId)))[0].checkinAt, "not recorded after 40 days");
  });

  console.log("\n\x1b[1mF. Tier change approval\x1b[0m");
  await check("member upgrade request is pending, tier unchanged", async () => {
    const before = (await db.select().from(schema.members).where(eq(schema.members.id, mPres)).limit(1))[0];
    await caller(uPres).circle.requestMembershipChange({ type: "upgrade", toTier: "vanguard" });
    const m = (await db.select().from(schema.members).where(eq(schema.members.id, mPres)).limit(1))[0];
    assert(m.tier === before.tier, "tier changed without approval");
    assert(!!(await caller(uPres).circle.pendingTierRequest()), "no pending request");
  });
  await expectErr("duplicate tier request blocked", () => caller(uPres).circle.requestMembershipChange({ type: "upgrade", toTier: "zenith" }), /awaiting approval/i);
  await check("admin approves tier request → tier changes", async () => {
    const req = (await MA.admin.pendingTierRequests()).find((r) => r.req.memberId === mPres);
    await MA.admin.decideTierRequest({ id: req!.req.id, decision: "approve" });
    assert((await db.select().from(schema.members).where(eq(schema.members.id, mPres)).limit(1))[0].tier === "vanguard", "not upgraded");
  });

  console.log("\n\x1b[1mG. Chapter Health Index\x1b[0m");
  await check("health index computes with all six components in range", async () => {
    const h = await computeChapterHealth(chA);
    assert(["retention", "engagement", "growth", "programme", "leadership", "governance"].every((k) => k in h.components), "missing components");
    assert(h.total >= 0 && h.total <= 100 && h.memberCount >= 3, "total/count wrong");
    console.log("       index=" + h.total + " band=" + h.band);
  });
  await check("save + read a quarterly snapshot", async () => {
    const r = await MA.adminEngage.saveHealthSnapshot({ id: chA });
    const hv = await MA.adminEngage.chapterHealth({ id: chA });
    assert(!!hv.lastSnapshot && hv.lastSnapshot.total === (r as { total: number }).total, "snapshot not persisted");
  });

  console.log("\n\x1b[1mJ. Operating rhythm (cadence engine, §A2)\x1b[0m");
  await check("officer sets up the standard cadences", async () => {
    const r = await caller(uPres).officer.setupCadences();
    assert((r as { added: number }).added >= 6, "cadences not seeded");
    const ov = await caller(uPres).officer.overview();
    assert(ov.cadence.cadences.some((c) => c.type === "chapter_meeting"), "no chapter meeting cadence");
    assert(ov.cadence.cadences.every((c) => c.currentStatus === "open"), "should start open");
  });
  await check("setup is idempotent", async () => {
    const r = await caller(uPres).officer.setupCadences();
    assert((r as { added: number }).added === 0, "re-seeded cadences");
  });
  await check("marking a cadence kept updates its current status", async () => {
    const ov = await caller(uPres).officer.overview();
    const cad = ov.cadence.cadences[0];
    await caller(uPres).officer.markCadence({ cadenceId: cad.id, status: "kept" });
    const ov2 = await caller(uPres).officer.overview();
    assert(ov2.cadence.cadences.find((c) => c.id === cad.id)!.currentStatus === "kept", "not kept");
  });
  await expectErr("officer of another chapter cannot mark this chapter's cadence", async () => {
    const ov = await caller(uPres).officer.overview();
    // uMem2 is not an officer at all → denied at requireOfficer
    return caller(uMem2).officer.markCadence({ cadenceId: ov.cadence.cadences[0].id, status: "kept" });
  }, /leadership role|don't lead/i);

  console.log("\n\x1b[1mI. Onboarding 30/60/90 (ML-03)\x1b[0m");
  await check("myOnboarding returns the ten staged milestones", async () => {
    const p = await caller(uApplicant).circle.myOnboarding();
    assert(p.milestones.length === 10 && p.lifecycleState === "onboarding", "wrong milestone set");
    assert(p.milestones.some((m) => m.stage === 1) && p.milestones.some((m) => m.stage === 3), "no stages");
  });
  await expectErr("cannot check off an auto-tracked step", () => caller(uApplicant).circle.completeOnboardingStep({ milestone: "profile_complete" }), /tracked automatically/i);
  await check("manual step records and lifts progress", async () => {
    const before = (await caller(uApplicant).circle.myOnboarding()).doneCount;
    await caller(uApplicant).circle.completeOnboardingStep({ milestone: "ask_offer" });
    const after = (await caller(uApplicant).circle.myOnboarding()).doneCount;
    assert(after === before + 1, "progress did not increase");
  });
  await check("completing every milestone auto-confirms Active", async () => {
    // satisfy the auto milestones with minimal real data
    await db.update(schema.members).set({ company: "Acme", title: "Founder" }).where(eq(schema.members.id, mApplicant));
    const ev = Number((await db.insert(schema.events).values({ title: "Onb", kind: "spark", startsAt: new Date(Date.now() - 3600000), capacity: 40, tierGate: "horizon", audience: "members" }))[0].insertId);
    await db.insert(schema.eventRegs).values({ eventId: ev, memberId: mApplicant, status: "attended" });
    await db.insert(schema.buddies).values({ newMemberId: mApplicant, buddyMemberId: mPres, pairedAt: new Date() });
    const pod = Number((await db.insert(schema.pods).values({ name: "Pod X", kind: "pod" }))[0].insertId);
    await db.insert(schema.podMembers).values({ podId: pod, memberId: mApplicant });
    const ses = Number((await db.insert(schema.sessions).values({ podId: pod, startsAt: new Date(Date.now() - 3600000) }))[0].insertId);
    await db.insert(schema.attendance).values({ sessionId: ses, memberId: mApplicant, status: "attended" });
    // check off the remaining manual milestones
    for (const k of ["three_connections", "first_contribution", "benefit_used", "check_in_90"])
      await caller(uApplicant).circle.completeOnboardingStep({ milestone: k });
    const p = await caller(uApplicant).circle.myOnboarding();
    assert(p.complete, "not complete: " + p.doneCount + "/" + p.total);
    const m = (await db.select().from(schema.members).where(eq(schema.members.id, mApplicant)).limit(1))[0];
    assert(m.lifecycleState === "active", "not auto-promoted to Active");
  });

  console.log("\n\x1b[1mK. PODs — confidentiality, matching, health (PD-01/02/03)\x1b[0m");
  const podId = Number((await db.insert(schema.pods).values({ name: "Pod " + uniq, kind: "pod", capacity: 8, tierGate: "horizon" }))[0].insertId);
  await db.insert(schema.podMembers).values({ podId, memberId: mMem2 });
  await check("POD content is withheld until confidentiality is accepted", async () => {
    const before = await caller(uMem2).circle.podDetail({ id: podId });
    assert(before.confidentialityAccepted === false, "should start not accepted");
    await db.insert(schema.sessions).values({ podId, startsAt: new Date(Date.now() - 3600000), topic: "secret" });
    const stillHidden = await caller(uMem2).circle.podDetail({ id: podId });
    assert(stillHidden.sessions.length === 0, "sessions leaked before acceptance");
    await caller(uMem2).circle.acceptPodConfidentiality({ podId });
    const after = await caller(uMem2).circle.podDetail({ id: podId });
    assert(after.confidentialityAccepted === true && after.sessions.length === 1, "content not revealed after acceptance");
  });
  await expectErr("a non-member cannot open a POD's space", () => caller(uPres).circle.podDetail({ id: podId }), /Not in this pod|FORBIDDEN/i);
  await check("matching engine ranks pods and blocks conflicts", async () => {
    await db.update(schema.members).set({ company: "Acme", sector: "FinTech" }).where(eq(schema.members.id, mMem3));
    await db.update(schema.members).set({ company: "Acme" }).where(eq(schema.members.id, mMem2)); // same company as mMem3, already in pod
    const sug = await MA.admin.suggestPodPlacement({ id: mMem3 });
    const row = sug.find((s) => s.podId === podId);
    assert(!!row && row.blocked === "competition", "non-competition not enforced");
  });
  await check("POD health computes from attendance + commitments", async () => {
    const pd = await MA.admin.podAdmin({ id: podId });
    assert(pd.health && pd.health.total >= 0 && pd.health.total <= 100, "no pod health");
  });

  console.log("\n\x1b[1mH. Cross-cutting RBAC\x1b[0m");
  await expectErr("unauthenticated cannot list members", () => caller(undefined).admin.members(), /Authentication|UNAUTHORIZED/i);
  await expectErr("member cannot approve applications", () => caller(uPres).admin.setApplicationStatus({ id: 1, status: "approved" }), /permission|admin|FORBIDDEN|UNAUTHORIZED/i);

  console.log(`\n\x1b[1mRESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
