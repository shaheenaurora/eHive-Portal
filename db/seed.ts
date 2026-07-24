import { eq } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import * as schema from "./schema";
import { recomputeScore } from "../api/queries/circle";

/* eHive Circle — seed data
   Idempotent-ish: wipes the circle tables (not users) and reseeds.
   Run with: npx tsx db/seed.ts */

const db = getDb();

function daysFromNow(d: number, h = 18): Date {
  const t = new Date();
  t.setDate(t.getDate() + d);
  t.setHours(h, 30, 0, 0);
  return t;
}
function daysAgo(d: number, h = 18): Date {
  return daysFromNow(-d, h);
}

async function clearCircle() {
  // order matters (FK-free schema, but keep logical order anyway)
  await db.delete(schema.policyAcks);
  await db.delete(schema.govMinutes);
  await db.delete(schema.govRoles);
  await db.delete(schema.govBodies);
  await db.delete(schema.frpMilestones);
  await db.delete(schema.readinessAssessments);
  await db.delete(schema.frpEnrolments);
  await db.delete(schema.frpCohorts);
  await db.delete(schema.hiveScoreHistory);
  await db.delete(schema.scoreEvents);
  await db.delete(schema.hiveScoreConfig);
  await db.delete(schema.eventRegs);
  await db.delete(schema.events);
  await db.delete(schema.actionItems);
  await db.delete(schema.sessionNotes);
  await db.delete(schema.attendance);
  await db.delete(schema.sessions);
  await db.delete(schema.podMembers);
  await db.delete(schema.pods);
  await db.delete(schema.membershipEvents);
  await db.delete(schema.applications);
  await db.delete(schema.members);
  await db.delete(schema.libraryItems);
  await db.delete(schema.offers);
  await db.delete(schema.leads);
}

async function user(unionId: string, name: string, email: string, role: "user" | "admin" = "user") {
  await db
    .insert(schema.users)
    .values({ unionId, name, email, role })
    .onDuplicateKeyUpdate({ set: { name, email, role } });
  const got = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.unionId, unionId))
    .limit(1);
  return got[0]!.id;
}

async function seed() {
  console.log("Seeding eHive Circle…");
  await clearCircle();

  /* ------------------------------- users -------------------------------- */
  const adminId = await user("seed-admin", "Amina Rahal", "amina@ehive.ae", "admin");
  const demoId = await user("seed-demo", "Omar Haddad", "omar@northwind.io");
  const saraId = await user("seed-sara", "Sara Iqbal", "sara@fintechlabs.ae");
  const jonId = await user("seed-jon", "Jon Meyer", "jon@atlaspay.co");
  const laylaId = await user("seed-layla", "Layla Nasser", "layla@soukretail.com");
  const petrId = await user("seed-petr", "Petr Novak", "petr@greenfield.ai");

  /* --------------------------- hive score config ------------------------- */
  await db.insert(schema.hiveScoreConfig).values([
    { factor: "attendance", weight: 30 },
    { factor: "action_items", weight: 20 },
    { factor: "events", weight: 15 },
    { factor: "contribution", weight: 15 },
    { factor: "frp", weight: 10 },
    { factor: "tenure", weight: 10 },
  ]);

  /* ------------------------------- members ------------------------------- */
  const renewal = new Date();
  renewal.setFullYear(renewal.getFullYear() + 1);
  const mk = async (
    userId: number,
    tier: "horizon" | "ascent" | "vanguard" | "zenith",
    company: string,
    title: string,
    joinedDaysAgo: number,
  ) => {
    const res = await db.insert(schema.members).values({
      userId,
      tier,
      status: "active",
      company,
      title,
      joinedAt: daysAgo(joinedDaysAgo),
      renewalAt: renewal,
    });
    const id = Number(res[0].insertId);
    await db.insert(schema.membershipEvents).values({
      memberId: id,
      type: "approved",
      toTier: tier,
      note: "Founding cohort",
    });
    return id;
  };

  const mOmar = await mk(demoId, "vanguard", "Northwind Logistics", "Co-founder & CEO", 96);
  const mSara = await mk(saraId, "ascent", "Fintech Labs", "Founder", 64);
  const mJon = await mk(jonId, "zenith", "AtlasPay", "CEO", 128);
  const mLayla = await mk(laylaId, "horizon", "Souk Retail", "Managing Director", 30);
  const mPetr = await mk(petrId, "vanguard", "Greenfield AI", "CTO", 84);
  await mk(adminId, "zenith", "eHive", "Community Director", 200);

  /* --------------------------------- pods -------------------------------- */
  const pod1 = Number(
    (await db.insert(schema.pods).values({
      name: "Founders Pod 1 — Growth",
      kind: "pod",
      facilitator: "Amina Rahal",
      capacity: 8,
      cadence: "Weekly, Thursdays 18:30 GST",
      tierGate: "horizon",
      description:
        "A tight circle of growth-stage founders. Wins, blockers and one commitment per member per week.",
    }))[0].insertId,
  );
  const pod2 = Number(
    (await db.insert(schema.pods).values({
      name: "Scale Mastermind — Ops & Team",
      kind: "mastermind",
      facilitator: "Rania Khoury",
      capacity: 6,
      cadence: "Bi-weekly, Tuesdays 08:00 GST",
      tierGate: "vanguard",
      description:
        "Mastermind for Vanguard and Zenith members scaling past 20 people: org design, delegation, operating cadence.",
    }))[0].insertId,
  );

  await db.insert(schema.podMembers).values([
    { podId: pod1, memberId: mOmar, role: "member" },
    { podId: pod1, memberId: mSara, role: "member" },
    { podId: pod1, memberId: mLayla, role: "member" },
    { podId: pod2, memberId: mOmar, role: "member" },
    { podId: pod2, memberId: mJon, role: "chair" },
    { podId: pod2, memberId: mPetr, role: "member" },
  ]);

  /* ------------------------------- sessions ------------------------------ */
  const s1 = Number(
    (await db.insert(schema.sessions).values({
      podId: pod1,
      startsAt: daysAgo(7),
      durationMin: 90,
      topic: "Q3 pipeline reviews",
      videoLink: "https://meet.ehive.ae/founders-pod-1",
      status: "done",
    }))[0].insertId,
  );
  await db.insert(schema.sessions).values({
    podId: pod1,
    startsAt: daysFromNow(3),
    durationMin: 90,
    topic: "Hiring senior operators",
    videoLink: "https://meet.ehive.ae/founders-pod-1",
    status: "scheduled",
  });
  await db.insert(schema.sessions).values({
    podId: pod2,
    startsAt: daysFromNow(6, 8),
    durationMin: 120,
    topic: "Delegation without dropping quality",
    videoLink: "https://meet.ehive.ae/scale-mastermind",
    status: "scheduled",
  });

  await db.insert(schema.sessionNotes).values({
    sessionId: s1,
    summary:
      "Pipeline reviews across the pod. Common theme: too many founder-led deals. " +
      "Action: every member documents their top-5 deal handoff before next session. " +
      "Sara shared her outbound sequencing playbook (in the library).",
  });

  await db.insert(schema.attendance).values([
    { sessionId: s1, memberId: mOmar, status: "attended" },
    { sessionId: s1, memberId: mSara, status: "attended" },
    { sessionId: s1, memberId: mLayla, status: "excused" },
  ]);

  await db.insert(schema.actionItems).values([
    {
      podId: pod1,
      sessionId: s1,
      memberId: mOmar,
      text: "Document top-5 deal handoff process and share with the pod",
      dueAt: daysFromNow(2),
      status: "open",
    },
    {
      podId: pod1,
      sessionId: s1,
      memberId: mOmar,
      text: "Send Sara the intro to the TransEdge logistics fund",
      dueAt: daysAgo(2),
      status: "done",
      doneAt: daysAgo(3),
    },
    {
      podId: pod1,
      sessionId: s1,
      memberId: mSara,
      text: "Upload outbound sequencing playbook to the library",
      dueAt: daysFromNow(1),
      status: "open",
    },
  ]);

  /* -------------------------------- events ------------------------------- */
  const ev1 = Number(
    (await db.insert(schema.events).values({
      title: "Spark Evening — Pricing Deep-Dive",
      kind: "spark",
      description:
        "A two-hour working session on pricing: value metrics, packaging and the discount trap. Bring your current price list.",
      startsAt: daysFromNow(9, 19),
      location: "eHive Majlis, DIFC",
      tierGate: "horizon",
      capacity: 24,
    }))[0].insertId,
  );
  const ev2 = Number(
    (await db.insert(schema.events).values({
      title: "Circle Dinner — Family Business Transitions",
      kind: "circle",
      description:
        "Off-the-record dinner conversation with two second-generation operators on professionalising a family business.",
      startsAt: daysFromNow(16, 20),
      location: "Private venue, Jumeirah",
      tierGate: "ascent",
      capacity: 14,
    }))[0].insertId,
  );
  const ev3 = Number(
    (await db.insert(schema.events).values({
      title: "Founders Retreat — Ras Al Khaimah",
      kind: "retreat",
      description:
        "Two days, no laptops until 4pm. Strategy in the morning, mountains in the afternoon. Vanguard and Zenith only.",
      startsAt: daysFromNow(38, 9),
      location: "RAK mountain lodge",
      tierGate: "vanguard",
      capacity: 20,
    }))[0].insertId,
  );
  await db.insert(schema.events).values({
    title: "Community Meetup — August Open House",
    kind: "meetup",
    description:
      "The monthly open evening: meet the pods, tour the space, bring a founder friend.",
    startsAt: daysFromNow(24, 18),
    location: "eHive Majlis, DIFC",
    tierGate: "horizon",
    capacity: 60,
  });

  await db.insert(schema.eventRegs).values([
    { eventId: ev1, memberId: mOmar, status: "registered" },
    { eventId: ev1, memberId: mSara, status: "registered" },
    { eventId: ev2, memberId: mOmar, status: "registered" },
    { eventId: ev3, memberId: mJon, status: "registered" },
    { eventId: ev3, memberId: mPetr, status: "registered" },
  ]);

  /* ----------------------------- score events ---------------------------- */
  const se = async (
    memberId: number,
    factor: string,
    points: number,
    note: string,
    at?: Date,
  ) => {
    await db.insert(schema.scoreEvents).values({
      memberId,
      factor,
      points,
      note,
      ...(at ? { createdAt: at } : {}),
    });
  };

  await se(mOmar, "attendance", 6, "Session attendance", daysAgo(7));
  await se(mOmar, "attendance", 6, "Session attendance", daysAgo(14));
  await se(mOmar, "attendance", 6, "Session attendance", daysAgo(21));
  await se(mOmar, "action_items", 5, "Action item completed", daysAgo(3));
  await se(mOmar, "action_items", 5, "Action item completed", daysAgo(10));
  await se(mOmar, "events", 4, "Event attendance", daysAgo(20));
  await se(mOmar, "events", 2, "Registered: Spark Evening", daysAgo(1));
  await se(mOmar, "contribution", 8, "Intro: TransEdge fund → Sara", daysAgo(3));
  await se(mOmar, "tenure", 5, "Joined eHive Circle", daysAgo(96));

  await se(mSara, "attendance", 6, "Session attendance", daysAgo(7));
  await se(mSara, "contribution", 8, "Shared outbound playbook", daysAgo(7));
  await se(mSara, "events", 2, "Registered: Spark Evening", daysAgo(2));
  await se(mSara, "tenure", 5, "Joined eHive Circle", daysAgo(64));

  await se(mJon, "attendance", 6, "Mastermind attendance", daysAgo(12));
  await se(mJon, "contribution", 10, "Hosted Circle Dinner", daysAgo(30));
  await se(mJon, "tenure", 5, "Joined eHive Circle", daysAgo(128));

  await se(mLayla, "tenure", 5, "Joined eHive Circle", daysAgo(30));
  await se(mPetr, "attendance", 6, "Mastermind attendance", daysAgo(12));
  await se(mPetr, "tenure", 5, "Joined eHive Circle", daysAgo(84));

  for (const m of [mOmar, mSara, mJon, mLayla, mPetr]) {
    await recomputeScore(m);
  }

  /* --------------------------------- FRP --------------------------------- */
  const cohort = Number(
    (await db.insert(schema.frpCohorts).values({
      name: "FRP Cohort 3 — Autumn 2026",
      tierGate: "vanguard",
      startsAt: daysFromNow(21, 10),
      status: "open",
    }))[0].insertId,
  );
  const enr = Number(
    (await db.insert(schema.frpEnrolments).values({
      cohortId: cohort,
      memberId: mOmar,
      status: "active",
    }))[0].insertId,
  );
  await db.insert(schema.readinessAssessments).values({
    enrolmentId: enr,
    team: 4,
    traction: 4,
    market: 3,
    financials: 2,
    narrative: 3,
    legal: 2,
  });
  await db.insert(schema.frpMilestones).values([
    { enrolmentId: enr, key: "deck", status: "submitted", note: "v3 uploaded — under review" },
    { enrolmentId: enr, key: "model", status: "in_progress" },
    { enrolmentId: enr, key: "dataroom", status: "not_started" },
  ]);

  /* ------------------------------ governance ----------------------------- */
  const council = Number(
    (await db.insert(schema.govBodies).values({
      name: "Circle Council",
      description:
        "The elected member body that stewards community standards, tier criteria and the event calendar.",
    }))[0].insertId,
  );
  const advBoard = Number(
    (await db.insert(schema.govBodies).values({
      name: "Advisory Board",
      description: "External operators and investors advising on programme design.",
    }))[0].insertId,
  );
  await db.insert(schema.govRoles).values([
    { bodyId: council, memberId: mJon, seat: "Chair", termStart: daysAgo(90), termEnd: daysFromNow(275) },
    { bodyId: council, memberId: mOmar, seat: "Events Lead", termStart: daysAgo(60), termEnd: daysFromNow(305) },
    { bodyId: advBoard, memberId: mPetr, seat: "Technology Advisor", termStart: daysAgo(45), termEnd: daysFromNow(320) },
  ]);
  await db.insert(schema.govMinutes).values([
    {
      bodyId: council,
      title: "Council minutes — July 2026",
      date: daysAgo(10),
      text:
        "1. Zenith invitation criteria confirmed: two sponsor signatures plus council interview.\n" +
        "2. Spark Evening cadence moves to monthly from September.\n" +
        "3. Hive Score weights reviewed — no change this quarter.\n" +
        "4. Two applications advanced to interview stage.",
    },
  ]);
  const pol1 = Number(
    (await db.insert(schema.policies).values({
      title: "Community Code of Conduct",
      body:
        "Chatham House Rule applies in every pod, session and dinner: what is said in the room stays in the room.\n\n" +
        "No pitching from the floor at member events unless the session is explicitly a pitch format.\n\n" +
        "Member introductions are opt-in — always ask before making the connection.\n\n" +
        "Repeated breaches lead to council review and possible membership cancellation.",
      version: 2,
    }))[0].insertId,
  );
  await db.insert(schema.policies).values({
    title: "Data & Privacy Charter",
    body:
      "Member data is used to run the community — matching, pods, events and the Hive Score. " +
      "It is never sold. Company metrics shared in pods remain confidential to the pod. " +
      "You can request a full export or deletion of your data at any time from the Membership page.",
    version: 1,
  });
  await db.insert(schema.policyAcks).values({ policyId: pol1, memberId: mJon });

  /* -------------------------------- library ------------------------------ */
  await db.insert(schema.libraryItems).values([
    {
      title: "The eHive Pricing Playbook",
      kind: "playbook",
      tierGate: "horizon",
      url: "https://library.ehive.ae/pricing-playbook",
      description: "Value metrics, packaging patterns and the discount trap — the Spark Evening companion.",
    },
    {
      title: "Board Pack Template (Series A)",
      kind: "template",
      tierGate: "ascent",
      url: "https://library.ehive.ae/board-pack-series-a",
      description: "The exact structure two members used to cut board prep from days to hours.",
    },
    {
      title: "Outbound Sequencing Playbook — Fintech Labs",
      kind: "playbook",
      tierGate: "horizon",
      url: "https://library.ehive.ae/outbound-sequencing",
      description: "Sara's 6-touch sequence that books 30% of cold accounts. Shared in Founders Pod 1.",
    },
    {
      title: "Recording: Family Business Transitions",
      kind: "recording",
      tierGate: "ascent",
      url: "https://library.ehive.ae/family-business-transitions",
      description: "The Circle Dinner conversation, recorded with permission. 58 minutes.",
    },
    {
      title: "Data Room Checklist (GCC investors)",
      kind: "template",
      tierGate: "vanguard",
      url: "https://library.ehive.ae/dataroom-checklist-gcc",
      description: "What GCC funds actually ask for in diligence — 112 items, ordered by frequency.",
    },
    {
      title: "Founder Compensation Note",
      kind: "note",
      tierGate: "horizon",
      description: "Anonymised salary data from 40 member companies, updated quarterly.",
    },
  ]);

  /* -------------------------------- offers ------------------------------- */
  await db.insert(schema.offers).values([
    {
      vertical: "setup",
      title: "Member rate: mainland LLC formation",
      description:
        "Circle members get the full mainland formation package — licence, establishment card, two visas — at a fixed member rate.",
      ctaUrl: "/business-setup.html",
      tierGate: "horizon",
    },
    {
      vertical: "consulting",
      title: "Clarity Sprint — member priority slot",
      description:
        "Members jump the queue: a Clarity Sprint booked within two weeks, plus a pod debrief afterwards.",
      ctaUrl: "/consulting.html",
      tierGate: "horizon",
    },
    {
      vertical: "consulting",
      title: "Momentum90 — two seats, one price",
      description:
        "Bring your second-in-command into the full 90-day operating cadence programme at no extra cost.",
      ctaUrl: "/consulting.html#momentum90",
      tierGate: "vanguard",
    },
    {
      vertical: "setup",
      title: "Free zone vs mainland — 1:1 advisory call",
      description:
        "A 45-minute structuring call with the setup team before you commit. For Horizon members evaluating a move.",
      ctaUrl: "/get-started.html?door=business",
      tierGate: "horizon",
    },
  ]);

  /* ----------------------------- applications ---------------------------- */
  await db.insert(schema.applications).values([
    {
      userId: petrId,
      name: "Petr Novak",
      email: "petr@greenfield.ai",
      company: "Greenfield AI",
      stage: "Seed",
      revenue: "$40k MRR",
      why: "Scaling from 6 to 20 people and want the mastermind room. Jon pointed me here.",
      tierRequested: "vanguard",
      status: "approved",
      decidedAt: daysAgo(84),
    },
  ]);
  const applicant1 = await user("seed-app-1", "Mira Chen", "mira@lumenpay.com");
  const applicant2 = await user("seed-app-2", "Faisal Otaibi", "faisal@datepalm.sa");
  const applicant3 = await user("seed-app-3", "Grace Adeyemi", "grace@kurent.ng");
  await db.insert(schema.applications).values([
    {
      userId: applicant1,
      name: "Mira Chen",
      email: "mira@lumenpay.com",
      company: "LumenPay",
      stage: "Series A",
      revenue: "$120k MRR",
      why: "Expanding into the GCC from Singapore — need the operator network, not another conference.",
      tierRequested: "vanguard",
      status: "interview",
    },
    {
      userId: applicant2,
      name: "Faisal Otaibi",
      email: "faisal@datepalm.sa",
      company: "Datepalm Trading",
      stage: "Established",
      revenue: "$2M+ annual",
      why: "Second-generation family business, professionalising ops. The Circle Dinner topic is exactly my situation.",
      tierRequested: "ascent",
      status: "screening",
    },
    {
      userId: applicant3,
      name: "Grace Adeyemi",
      email: "grace@kurent.ng",
      company: "Kurent",
      stage: "Pre-seed",
      revenue: "Pre-revenue",
      why: "First-time founder. Applying for Horizon to learn the basics properly.",
      tierRequested: "horizon",
      status: "received",
    },
  ]);

  /* --------------------------------- leads ------------------------------- */
  await db.insert(schema.leads).values([
    {
      form: "get-started",
      email: "huda@maisonh.ae",
      payload: JSON.stringify({
        form: "get-started",
        door: "circle",
        detail: "ascent",
        name: "Huda Al Mansoori",
        email: "huda@maisonh.ae",
      }),
      sourcePage: "get-started.html",
    },
    {
      form: "booking",
      email: "tom@ferrylane.uk",
      payload: JSON.stringify({ form: "booking", product: "discovery", when: "morning" }),
      sourcePage: "book.html",
    },
  ]);

  console.log("Seeded:");
  console.log("  users: admin Amina (seed-admin), demo Omar (seed-demo) + 8 more");
  console.log("  members: 6 · pods: 2 · sessions: 3 · events: 4 · library: 6 · offers: 4");
  console.log("  score: weights 30/20/15/15/10/10, recomputed for 5 members");
  process.exit(0);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
