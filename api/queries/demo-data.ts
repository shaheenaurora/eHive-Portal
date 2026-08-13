import { and, eq, inArray, like, or } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";
import { hashPassword } from "../lib/password";
import { TIER_PRICE_AED } from "@contracts/constants";

/* ======================= full simulation dataset ======================= */

const DEMO_FULL_MARKER = "demo:full:loaded";
const DEMO_PASSWORD = "ehive1234";

const FIRST = [
  "Omar",
  "Sara",
  "Layla",
  "Yousef",
  "Amal",
  "Noor",
  "Rami",
  "Farah",
  "Hassan",
  "Zaid",
  "Lena",
  "Tariq",
  "Huda",
  "Faisal",
  "Grace",
  "Mira",
  "Karim",
  "Dana",
  "Sami",
  "Reem",
  "Bilal",
  "Aisha",
  "Khalid",
  "Maya",
  "Nadia",
  "Adam",
  "Salma",
  "Rashid",
  "Hind",
  "Jad",
  "Yara",
  "Tamer",
  "Lina",
  "Ziad",
  "Rana",
  "Marwan",
  "Dina",
  "Fadi",
  "Nour",
  "Kareem",
  "Sana",
  "Basel",
  "Rula",
  "Nabil",
  "Leen",
  "Hadi",
];
const LAST = [
  "Haddad",
  "Iqbal",
  "Nasser",
  "Rahal",
  "Odeh",
  "Aziz",
  "Ali",
  "Khoury",
  "Saleh",
  "Mansour",
  "Barakat",
  "Fares",
  "Darwish",
  "Sabbagh",
  "Halabi",
  "Karam",
  "Sayegh",
  "Nabhan",
  "Ghanem",
  "Toma",
  "Shaheen",
  "Antar",
  "Zahra",
  "Murad",
  "Qasim",
  "Bishara",
  "Habib",
  "Salti",
  "Attar",
  "Kanaan",
];
const COMPANIES = [
  "Northwind",
  "FinTech Labs",
  "Souk Retail",
  "Sabil",
  "Paloma",
  "BoltGrid",
  "Ledgerly",
  "DriftCo",
  "Verdeco",
  "NorthStar",
  "Tazej",
  "Lumen",
  "GreenField",
  "AtlasPay",
  "Kurent",
  "DatePalm",
  "Marid",
  "Anwar",
  "Falcon Logistics",
  "Cedar Labs",
  "Oasis Health",
  "Dunes Media",
  "Pearl Realty",
];
const SECTORS = [
  "FinTech",
  "Logistics",
  "Retail",
  "HealthTech",
  "Hospitality",
  "Energy",
  "Media",
  "Real Estate",
  "Education",
  "F&B",
];
const TITLES = [
  "Founder",
  "CEO",
  "Co-founder",
  "Managing Director",
  "COO",
  "Founder & CEO",
  "Partner",
];

// Deterministic-ish PRNG so a run is reproducible within itself.
function makeRand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}
const pick = <T>(rand: () => number, arr: readonly T[]): T =>
  arr[Math.floor(rand() * arr.length)];
function weighted<T>(rand: () => number, pairs: [T, number][]): T {
  const total = pairs.reduce((a, [, w]) => a + w, 0);
  let r = rand() * total;
  for (const [v, w] of pairs) {
    if ((r -= w) <= 0) return v;
  }
  return pairs[0][0];
}

const HIERARCHY = {
  country: { name: "United Arab Emirates", code: "DEMO-AE" },
  regions: [
    {
      name: "Dubai Region",
      code: "DEMO-R-DXB",
      zones: [
        {
          name: "DIFC Zone",
          code: "DEMO-Z-DIFC",
          chapters: ["Dubai · DIFC", "Dubai · Business Bay"],
        },
        {
          name: "Marina Zone",
          code: "DEMO-Z-MAR",
          chapters: ["Dubai · Marina", "Dubai · JLT"],
        },
      ],
    },
    {
      name: "Abu Dhabi Region",
      code: "DEMO-R-AUH",
      zones: [
        {
          name: "Corniche Zone",
          code: "DEMO-Z-CORN",
          chapters: ["Abu Dhabi · Corniche", "Abu Dhabi · Al Maryah"],
        },
        {
          name: "Yas Zone",
          code: "DEMO-Z-YAS",
          chapters: ["Abu Dhabi · Yas Island"],
        },
      ],
    },
    {
      name: "Northern Emirates Region",
      code: "DEMO-R-NE",
      zones: [
        {
          name: "Sharjah Zone",
          code: "DEMO-Z-SHJ",
          chapters: ["Sharjah · Al Majaz", "Sharjah · Aljada"],
        },
        { name: "RAK Zone", code: "DEMO-Z-RAK", chapters: ["Ras Al Khaimah"] },
      ],
    },
  ],
};

const CHAPTER_OFFICER_ROLES = [
  ["President", "president"],
  ["Vice President", "vice_president"],
  ["Secretary", "secretary"],
  ["Treasurer", "treasurer"],
  ["VP Membership", "vp_membership"],
  ["VP Programming", "vp_programming"],
  ["VP Learning", "vp_learning"],
] as const;

const MANAGEMENT = [
  { name: "Amina Rahal", title: "Director, eHive Circle", scopes: "*" },
  { name: "Bilal Haddad", title: "Head of Membership", scopes: "membership" },
  { name: "Dana Khoury", title: "Head of Programming", scopes: "events" },
  { name: "Karim Saleh", title: "Head of Finance", scopes: "finance" },
  { name: "Reem Nasser", title: "Head of Safeguarding", scopes: "conduct" },
  { name: "Sami Odeh", title: "Head of Chapters", scopes: "chapters" },
];

/** Insert users, then resolve their ids by unionId (unique) — robust against
 *  any auto-increment gap, so user↔member links are always correct. */
async function insertUsersBatch(
  rows: (typeof schema.users.$inferInsert)[]
): Promise<number[]> {
  if (!rows.length) return [];
  const db = getDb();
  await db.insert(schema.users).values(rows);
  const unionIds = rows.map(r => r.unionId as string);
  const got = await db
    .select({ id: schema.users.id, unionId: schema.users.unionId })
    .from(schema.users)
    .where(inArray(schema.users.unionId, unionIds));
  const byUnion = new Map(got.map(g => [g.unionId, g.id]));
  return rows.map(r => byUnion.get(r.unionId as string) as number);
}

/**
 * Generate the full eHive Circle simulation: a Country → 3 Regions → Zones →
 * Chapters hierarchy, 30–40 members per chapter, chapter officers, zone /
 * region / national leaders, and a management (admin) team. Idempotent — guarded
 * by a marker so it won't duplicate. All rows are seed-tagged so
 * removeDemoData() can clean them up.
 */
export async function loadFullDemo(): Promise<{
  loaded: boolean;
  members: number;
  chapters: number;
  admins: number;
}> {
  const db = getDb();
  // Always (re)open Save cases for any at-risk members — including a demo that
  // was loaded before the Save Playbook existed. Idempotent; runs even when the
  // heavy generation below is skipped by the marker.
  const { backfillAtRiskSaves } = await import("./saves");
  await backfillAtRiskSaves();
  const marker = (
    await db
      .select()
      .from(schema.appConfig)
      .where(eq(schema.appConfig.key, DEMO_FULL_MARKER))
      .limit(1)
  ).at(0);
  if (marker?.value)
    return { loaded: false, members: 0, chapters: 0, admins: 0 };

  const rand = makeRand(42);
  const hash = await hashPassword(DEMO_PASSWORD);
  let uSeq = 0;
  const email = (name: string) =>
    `${name.toLowerCase().replace(/[^a-z]+/g, ".")}.${++uSeq}@demo.ehive.ae`;

  // ---- management team (admins) ----
  const mgmtRows = MANAGEMENT.map((m, i) => ({
    unionId: `seed-mgmt-${i}`,
    email: email(m.name),
    name: m.name,
    passwordHash: hash,
    role: "admin" as const,
    adminScopes: m.scopes,
  }));
  await insertUsersBatch(mgmtRows);

  // ---- hierarchy ----
  const country = Number(
    (
      await db.insert(schema.orgUnits).values({
        level: "country",
        name: HIERARCHY.country.name,
        code: HIERARCHY.country.code,
      })
    )[0].insertId
  );
  let memberTotal = 0,
    chapterTotal = 0;
  const countryLeaderCandidates: number[] = [];
  const dataRequestMemberIds: number[] = [];

  for (const region of HIERARCHY.regions) {
    const regionId = Number(
      (
        await db.insert(schema.orgUnits).values({
          level: "region",
          name: region.name,
          code: region.code,
          parentId: country,
        })
      )[0].insertId
    );
    const regionLeaderCandidates: number[] = [];

    for (const zone of region.zones) {
      const zoneId = Number(
        (
          await db.insert(schema.orgUnits).values({
            level: "zone",
            name: zone.name,
            code: zone.code,
            parentId: regionId,
          })
        )[0].insertId
      );
      const zoneLeaderCandidates: number[] = [];

      for (const chapterName of zone.chapters) {
        chapterTotal++;
        const chapterId = Number(
          (
            await db.insert(schema.chapters).values({
              name: `eHive ${chapterName}`,
              code: `DEMO-CH-${chapterTotal}`,
              zoneId,
              country: "United Arab Emirates",
              region: region.name,
              zone: zone.name,
              status: weighted(rand, [
                ["chartered", 6],
                ["mature", 2],
                ["provisional", 2],
              ]),
              meetingCadence: "Bi-weekly · Tue 7:30pm",
            })
          )[0].insertId
        );

        const count = 30 + Math.floor(rand() * 11); // 30–40
        const userRows: (typeof schema.users.$inferInsert)[] = [];
        const meta: {
          name: string;
          tier: "horizon" | "ascent" | "vanguard" | "zenith";
          lc: string;
          score: number;
          company: string;
          title: string;
          sector: string;
        }[] = [];
        for (let i = 0; i < count; i++) {
          const name = `${pick(rand, FIRST)} ${pick(rand, LAST)}`;
          userRows.push({
            unionId: `seed-fd-${chapterId}-${i}`,
            email: email(name),
            name,
            passwordHash: hash,
            role: "user",
            adminScopes: "",
          });
          meta.push({
            name,
            tier: weighted(rand, [
              ["horizon", 40],
              ["ascent", 40],
              ["vanguard", 17],
              ["zenith", 3],
            ]),
            lc: weighted(rand, [
              ["active", 68],
              ["onboarding", 10],
              ["at_risk", 8],
              ["renewal", 7],
              ["lapsed", 4],
              ["alumni", 3],
            ]),
            score: 25 + Math.floor(rand() * 70),
            company: pick(rand, COMPANIES),
            title: pick(rand, TITLES),
            sector: pick(rand, SECTORS),
          });
        }
        const userIds = await insertUsersBatch(userRows);
        const renewal = new Date();
        renewal.setFullYear(renewal.getFullYear() + 1);
        const memberRows = userIds.map((uid, i) => ({
          userId: uid,
          tier: meta[i].tier,
          status: "active" as const,
          lifecycleState: meta[i].lc as never,
          hiveScore: meta[i].score,
          company: meta[i].company,
          title: meta[i].title,
          sector: meta[i].sector,
          homeChapterId: chapterId,
          renewalAt: renewal,
        }));
        await db.insert(schema.members).values(memberRows);
        const gotM = await db
          .select({ id: schema.members.id, userId: schema.members.userId })
          .from(schema.members)
          .where(inArray(schema.members.userId, userIds));
        const memberByUser = new Map(gotM.map(m => [m.userId, m.id]));
        const memberIds = userIds.map(uid => memberByUser.get(uid) as number);
        memberTotal += memberIds.length;

        // chapter officers — first 7 members
        const officerRows = CHAPTER_OFFICER_ROLES.map(([title, role], i) => ({
          chapterId,
          memberId: memberIds[i],
          role,
          title,
          status: "active" as const,
          appointedBy: "demo",
        }));
        await db.insert(schema.chapterRoles).values(officerRows);

        // a health snapshot so roll-ups show a band
        const t = weighted(rand, [
          [82, 4],
          [68, 4],
          [55, 2],
        ]);
        await db.insert(schema.healthSnapshots).values({
          chapterId,
          total: t,
          retention: Math.round(t * 0.25),
          engagement: Math.round(t * 0.25),
          growth: Math.round(t * 0.15),
          programme: Math.round(t * 0.15),
          leadership: Math.round(t * 0.1),
          governance: Math.round(t * 0.1),
        });

        // Membership payments so Finance / revenue reports populate. One paid
        // membership per member, spread over the last ~6 months (some this month),
        // with a few pending / refunded for a realistic ledger.
        const payRows = memberIds.map((_mid, i) => {
          const tier = meta[i].tier;
          const daysAgo = Math.floor(rand() * 180);
          const status = weighted(rand, [
            ["paid", 88],
            ["pending", 8],
            ["refunded", 4],
          ]) as "paid" | "pending" | "refunded";
          return {
            userId: userIds[i],
            provider: rand() < 0.15 ? "manual" : "stripe",
            providerRef: `seed-pay-${chapterId}-${i}`,
            purpose: "membership",
            tier,
            amount: (TIER_PRICE_AED[tier] ?? 0) * 100,
            currency: "aed",
            status,
            createdAt: new Date(Date.now() - daysAgo * 86_400_000),
            paidAt:
              status !== "pending"
                ? new Date(Date.now() - daysAgo * 86_400_000)
                : null,
          };
        });
        if (payRows.length)
          await db.insert(schema.paymentRecords).values(payRows);

        // Prospect funnel + guest follow-ups so Pipeline / Operations populate.
        const prospectRows = Array.from({ length: 4 }).map(() => {
          const name = `${pick(rand, FIRST)} ${pick(rand, LAST)}`;
          return {
            name,
            email: email(name),
            company: pick(rand, COMPANIES),
            chapterId,
            source: "demo",
            stage: weighted(rand, [
              ["prospect", 4],
              ["guest", 3],
              ["invited", 2],
              ["converted", 1],
              ["declined", 1],
            ]) as never,
          };
        });
        await db.insert(schema.prospects).values(prospectRows);
        await db.insert(schema.followUps).values([
          {
            chapterId,
            ownerUserId: userIds[0],
            title: `Follow up with ${pick(rand, FIRST)} ${pick(rand, LAST)}`,
            dueAt: new Date(Date.now() + 24 * 3_600_000),
            status: "open" as const,
          },
          {
            chapterId,
            ownerUserId: userIds[1] ?? userIds[0],
            title: `Follow up with ${pick(rand, FIRST)} ${pick(rand, LAST)}`,
            dueAt: new Date(Date.now() - 18 * 3_600_000),
            status: "open" as const,
          }, // overdue
        ]);

        zoneLeaderCandidates.push(memberIds[0]);
        regionLeaderCandidates.push(memberIds[1] ?? memberIds[0]);
        countryLeaderCandidates.push(memberIds[2] ?? memberIds[0]);
        dataRequestMemberIds.push(memberIds[3] ?? memberIds[0]);
      }

      // zone chair
      if (zoneLeaderCandidates.length) {
        await db.insert(schema.unitRoles).values({
          unitId: zoneId,
          level: "zone",
          memberId: zoneLeaderCandidates[0],
          role: "Zone Chair",
        });
      }
    }

    // regional director + deputy
    if (regionLeaderCandidates.length) {
      await db.insert(schema.unitRoles).values({
        unitId: regionId,
        level: "region",
        memberId: regionLeaderCandidates[0],
        role: "Regional Director",
      });
      if (regionLeaderCandidates[1])
        await db.insert(schema.unitRoles).values({
          unitId: regionId,
          level: "region",
          memberId: regionLeaderCandidates[1],
          role: "Regional VP",
        });
    }
  }

  // national council
  if (countryLeaderCandidates.length >= 3) {
    await db.insert(schema.unitRoles).values([
      {
        unitId: country,
        level: "country",
        memberId: countryLeaderCandidates[0],
        role: "National President",
      },
      {
        unitId: country,
        level: "country",
        memberId: countryLeaderCandidates[1],
        role: "National VP",
      },
      {
        unitId: country,
        level: "country",
        memberId: countryLeaderCandidates[2],
        role: "National Treasurer",
      },
    ]);
  }

  // A couple of open PDPL data-subject requests so the Operations cockpit populates.
  if (dataRequestMemberIds.length >= 2) {
    await db.insert(schema.dataRequests).values([
      { memberId: dataRequestMemberIds[0], kind: "export", status: "open" },
      { memberId: dataRequestMemberIds[1], kind: "deletion", status: "open" },
    ]);
  }

  await db
    .insert(schema.appConfig)
    .values({ key: DEMO_FULL_MARKER, value: new Date().toISOString() })
    .onDuplicateKeyUpdate({ set: { value: new Date().toISOString() } });

  return {
    loaded: true,
    members: memberTotal,
    chapters: chapterTotal,
    admins: MANAGEMENT.length,
  };
}

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
const SEED_ORG_UNITS: { level: "zone" | "region" | "country"; name: string }[] =
  [
    { level: "country", name: "United Arab Emirates" },
    { level: "region", name: "Gulf" },
    { level: "zone", name: "Dubai Zone" },
    { level: "zone", name: "Abu Dhabi Zone" },
    { level: "zone", name: "Northern Emirates Zone" },
  ];

export async function removeDemoData(): Promise<Record<string, number>> {
  const db = getDb();
  const removed: Record<string, number> = {};
  const del = async (label: string, n: number) => {
    if (n) removed[label] = (removed[label] ?? 0) + n;
  };

  // ---- identify the seed accounts + their members ----
  const seedUsers = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(like(schema.users.unionId, "seed-%"));
  const userIds = seedUsers.map(u => u.id);
  const seedMembers = userIds.length
    ? await db
        .select({ id: schema.members.id })
        .from(schema.members)
        .where(inArray(schema.members.userId, userIds))
    : [];
  const memberIds = seedMembers.map(m => m.id);
  const inMembers = (col: never) => inArray(col, memberIds);

  // ---- demo pods (roster entirely seed) + their sessions ----
  const podRows = await db
    .select({
      podId: schema.podMembers.podId,
      memberId: schema.podMembers.memberId,
    })
    .from(schema.podMembers);
  const byPod = new Map<number, number[]>();
  for (const r of podRows) {
    const a = byPod.get(r.podId) ?? [];
    a.push(r.memberId);
    byPod.set(r.podId, a);
  }
  const seedSet = new Set(memberIds);
  const demoPodIds = [...byPod.entries()]
    .filter(([, ms]) => ms.length > 0 && ms.every(m => seedSet.has(m)))
    .map(([p]) => p);

  // ---- demo events (registrations entirely seed) ----
  const regRows = await db
    .select({
      eventId: schema.eventRegs.eventId,
      memberId: schema.eventRegs.memberId,
    })
    .from(schema.eventRegs);
  const byEvent = new Map<number, number[]>();
  for (const r of regRows) {
    const a = byEvent.get(r.eventId) ?? [];
    a.push(r.memberId);
    byEvent.set(r.eventId, a);
  }
  const demoEventIds = [...byEvent.entries()]
    .filter(([, ms]) => ms.length > 0 && ms.every(m => seedSet.has(m)))
    .map(([e]) => e);

  // ---- demo chapters (old AE- seed codes + full-demo DEMO- codes) ----
  const demoChapters = await db
    .select({ id: schema.chapters.id })
    .from(schema.chapters)
    .where(
      or(
        inArray(schema.chapters.code, SEED_CHAPTER_CODES),
        like(schema.chapters.code, "DEMO-%")
      )
    );
  const chapterIds = demoChapters.map(c => c.id);
  // ---- demo org units (old exact names + full-demo DEMO- codes) ----
  const demoUnits = await db
    .select({ id: schema.orgUnits.id })
    .from(schema.orgUnits)
    .where(
      or(
        like(schema.orgUnits.code, "DEMO-%"),
        ...SEED_ORG_UNITS.map(u =>
          and(
            eq(schema.orgUnits.level, u.level),
            eq(schema.orgUnits.name, u.name)
          )
        )
      )
    );
  const unitIds = demoUnits.map(u => u.id);

  // ================= delete, children first =================
  if (memberIds.length) {
    // member-keyed community rows
    await del(
      "scoreEvents",
      (
        await db
          .delete(schema.scoreEvents)
          .where(inMembers(schema.scoreEvents.memberId as never))
      )[0].affectedRows
    );
    await del(
      "hiveScoreHistory",
      (
        await db
          .delete(schema.hiveScoreHistory)
          .where(inMembers(schema.hiveScoreHistory.memberId as never))
      )[0].affectedRows
    );
    await del(
      "attendance",
      (
        await db
          .delete(schema.attendance)
          .where(inMembers(schema.attendance.memberId as never))
      )[0].affectedRows
    );
    await del(
      "actionItems",
      (
        await db
          .delete(schema.actionItems)
          .where(inMembers(schema.actionItems.memberId as never))
      )[0].affectedRows
    );
    await del(
      "membershipEvents",
      (
        await db
          .delete(schema.membershipEvents)
          .where(inMembers(schema.membershipEvents.memberId as never))
      )[0].affectedRows
    );
    await del(
      "onboardingMilestones",
      (
        await db
          .delete(schema.onboardingMilestones)
          .where(inMembers(schema.onboardingMilestones.memberId as never))
      )[0].affectedRows
    );
    await del(
      "notifications",
      (
        await db
          .delete(schema.notifications)
          .where(inMembers(schema.notifications.memberId as never))
      )[0].affectedRows
    );
    await del(
      "referrals",
      (
        await db
          .delete(schema.referrals)
          .where(inMembers(schema.referrals.memberId as never))
      )[0].affectedRows
    );
    await del(
      "dormancyLog",
      (
        await db
          .delete(schema.dormancyLog)
          .where(inMembers(schema.dormancyLog.memberId as never))
      )[0].affectedRows
    );
    await del(
      "frpEnrolments",
      (
        await db
          .delete(schema.frpEnrolments)
          .where(inMembers(schema.frpEnrolments.memberId as never))
      )[0].affectedRows
    );
    await del(
      "podMembers",
      (
        await db
          .delete(schema.podMembers)
          .where(inMembers(schema.podMembers.memberId as never))
      )[0].affectedRows
    );
    await del(
      "eventRegs",
      (
        await db
          .delete(schema.eventRegs)
          .where(inMembers(schema.eventRegs.memberId as never))
      )[0].affectedRows
    );
    await del(
      "chapterRoles",
      (
        await db
          .delete(schema.chapterRoles)
          .where(inMembers(schema.chapterRoles.memberId as never))
      )[0].affectedRows
    );
    await del(
      "meetingAttendance",
      (
        await db
          .delete(schema.meetingAttendance)
          .where(inMembers(schema.meetingAttendance.memberId as never))
      )[0].affectedRows
    );
    await del(
      "pushSubscriptions",
      (
        await db
          .delete(schema.pushSubscriptions)
          .where(inMembers(schema.pushSubscriptions.memberId as never))
      )[0].affectedRows
    );
    await del(
      "buddies",
      (
        await db
          .delete(schema.buddies)
          .where(
            or(
              inArray(schema.buddies.newMemberId, memberIds),
              inArray(schema.buddies.buddyMemberId, memberIds)
            )
          )
      )[0].affectedRows
    );
    await del(
      "oneToOnes",
      (
        await db
          .delete(schema.oneToOnes)
          .where(
            or(
              inArray(schema.oneToOnes.aMemberId, memberIds),
              inArray(schema.oneToOnes.bMemberId, memberIds)
            )
          )
      )[0].affectedRows
    );
    await del(
      "conductCases",
      (
        await db
          .delete(schema.conductCases)
          .where(
            or(
              inArray(schema.conductCases.reporterMemberId, memberIds),
              inArray(schema.conductCases.subjectMemberId, memberIds)
            )
          )
      )[0].affectedRows
    );
    await del(
      "memberSaveCases",
      (
        await db
          .delete(schema.memberSaveCases)
          .where(inMembers(schema.memberSaveCases.memberId as never))
      )[0].affectedRows
    );
    await del(
      "dataRequests",
      (
        await db
          .delete(schema.dataRequests)
          .where(inMembers(schema.dataRequests.memberId as never))
      )[0].affectedRows
    );
    await del(
      "members",
      (
        await db
          .delete(schema.members)
          .where(inArray(schema.members.id, memberIds))
      )[0].affectedRows
    );
  }

  if (userIds.length) {
    await del(
      "applications",
      (
        await db
          .delete(schema.applications)
          .where(inArray(schema.applications.userId, userIds))
      )[0].affectedRows
    );
    await del(
      "paymentRecords",
      (
        await db
          .delete(schema.paymentRecords)
          .where(inArray(schema.paymentRecords.userId, userIds))
      )[0].affectedRows
    );
    await del(
      "authTokens",
      (
        await db
          .delete(schema.authTokens)
          .where(inArray(schema.authTokens.userId, userIds))
      )[0].affectedRows
    );
    await del(
      "users",
      (
        await db.delete(schema.users).where(inArray(schema.users.id, userIds))
      )[0].affectedRows
    );
  }

  // demo pods + their sessions/notes/action items
  if (demoPodIds.length) {
    const sess = await db
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(inArray(schema.sessions.podId, demoPodIds));
    const sessionIds = sess.map(s => s.id);
    if (sessionIds.length) {
      await del(
        "sessionNotes",
        (
          await db
            .delete(schema.sessionNotes)
            .where(inArray(schema.sessionNotes.sessionId, sessionIds))
        )[0].affectedRows
      );
      await del(
        "attendance",
        (
          await db
            .delete(schema.attendance)
            .where(inArray(schema.attendance.sessionId, sessionIds))
        )[0].affectedRows
      );
      await del(
        "sessions",
        (
          await db
            .delete(schema.sessions)
            .where(inArray(schema.sessions.id, sessionIds))
        )[0].affectedRows
      );
    }
    await del(
      "podMembers",
      (
        await db
          .delete(schema.podMembers)
          .where(inArray(schema.podMembers.podId, demoPodIds))
      )[0].affectedRows
    );
    await del(
      "pods",
      (
        await db.delete(schema.pods).where(inArray(schema.pods.id, demoPodIds))
      )[0].affectedRows
    );
  }

  // demo events
  if (demoEventIds.length) {
    await del(
      "eventRegs",
      (
        await db
          .delete(schema.eventRegs)
          .where(inArray(schema.eventRegs.eventId, demoEventIds))
      )[0].affectedRows
    );
    await del(
      "eventFeedback",
      (
        await db
          .delete(schema.eventFeedback)
          .where(inArray(schema.eventFeedback.eventId, demoEventIds))
      )[0].affectedRows
    );
    await del(
      "events",
      (
        await db
          .delete(schema.events)
          .where(inArray(schema.events.id, demoEventIds))
      )[0].affectedRows
    );
  }

  // demo chapters + chapter-keyed governance/finance
  if (chapterIds.length) {
    await del(
      "chapterRoles",
      (
        await db
          .delete(schema.chapterRoles)
          .where(inArray(schema.chapterRoles.chapterId, chapterIds))
      )[0].affectedRows
    );
    await del(
      "healthSnapshots",
      (
        await db
          .delete(schema.healthSnapshots)
          .where(inArray(schema.healthSnapshots.chapterId, chapterIds))
      )[0].affectedRows
    );
    await del(
      "kpiSnapshots",
      (
        await db
          .delete(schema.kpiSnapshots)
          .where(
            and(
              eq(schema.kpiSnapshots.scope, "chapter"),
              inArray(schema.kpiSnapshots.scopeId, chapterIds)
            )
          )
      )[0].affectedRows
    );
    await del(
      "chapterPosts",
      (
        await db
          .delete(schema.chapterPosts)
          .where(inArray(schema.chapterPosts.chapterId, chapterIds))
      )[0].affectedRows
    );
    await del(
      "chapterBudgets",
      (
        await db
          .delete(schema.chapterBudgets)
          .where(inArray(schema.chapterBudgets.chapterId, chapterIds))
      )[0].affectedRows
    );
    await del(
      "prospects",
      (
        await db
          .delete(schema.prospects)
          .where(inArray(schema.prospects.chapterId, chapterIds))
      )[0].affectedRows
    );
    await del(
      "followUps",
      (
        await db
          .delete(schema.followUps)
          .where(inArray(schema.followUps.chapterId, chapterIds))
      )[0].affectedRows
    );
    await del(
      "chapterTransfers",
      (
        await db
          .delete(schema.chapterTransfers)
          .where(inArray(schema.chapterTransfers.toChapterId, chapterIds))
      )[0].affectedRows
    );
    await del(
      "meetings",
      (
        await db
          .delete(schema.meetings)
          .where(inArray(schema.meetings.chapterId, chapterIds))
      )[0].affectedRows
    );
    await del(
      "elections",
      (
        await db
          .delete(schema.elections)
          .where(inArray(schema.elections.chapterId, chapterIds))
      )[0].affectedRows
    );
    await del(
      "motions",
      (
        await db
          .delete(schema.motions)
          .where(inArray(schema.motions.chapterId, chapterIds))
      )[0].affectedRows
    );
    const cads = await db
      .select({ id: schema.cadences.id })
      .from(schema.cadences)
      .where(inArray(schema.cadences.chapterId, chapterIds));
    const cadIds = cads.map(c => c.id);
    if (cadIds.length)
      await del(
        "cadenceLog",
        (
          await db
            .delete(schema.cadenceLog)
            .where(inArray(schema.cadenceLog.cadenceId, cadIds))
        )[0].affectedRows
      );
    await del(
      "cadences",
      (
        await db
          .delete(schema.cadences)
          .where(inArray(schema.cadences.chapterId, chapterIds))
      )[0].affectedRows
    );
    await del(
      "chapters",
      (
        await db
          .delete(schema.chapters)
          .where(inArray(schema.chapters.id, chapterIds))
      )[0].affectedRows
    );
  }

  // unit-level leadership roles (by demo member or demo unit)
  if (memberIds.length || unitIds.length) {
    const conds = [];
    if (memberIds.length)
      conds.push(inArray(schema.unitRoles.memberId, memberIds));
    if (unitIds.length) conds.push(inArray(schema.unitRoles.unitId, unitIds));
    await del(
      "unitRoles",
      (await db.delete(schema.unitRoles).where(or(...conds)))[0].affectedRows
    );
  }

  // seeded org hierarchy
  if (unitIds.length) {
    await del(
      "orgUnits",
      (
        await db
          .delete(schema.orgUnits)
          .where(inArray(schema.orgUnits.id, unitIds))
      )[0].affectedRows
    );
  }

  // clear the full-demo marker so it can be loaded again
  await db
    .delete(schema.appConfig)
    .where(eq(schema.appConfig.key, DEMO_FULL_MARKER));

  return removed;
}
