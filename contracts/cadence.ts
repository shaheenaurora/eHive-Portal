/* The chapter operating rhythm (Operations Manual A2 / Figure 1). Pure,
   dependency-free helpers for the recurring cadences the platform schedules,
   nudges against and records completion of. "Cadence is the product." */

export const CADENCE_FREQUENCIES = [
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "annually",
] as const;
export type Frequency = (typeof CADENCE_FREQUENCIES)[number];
export const FREQUENCY_LABEL: Record<Frequency, string> = {
  weekly: "Weekly",
  biweekly: "Bi-weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annually: "Annually",
};

/* The standard cadences a chapter runs — used to set a chapter up to standard
   (ZO-02). Owner is the accountable chapter role (contracts CHAPTER_ROLES). */
export const CADENCE_TEMPLATES = [
  {
    type: "chapter_meeting",
    freq: "biweekly",
    title: "Chapter Meeting",
    owner: "president",
    sop: "CH-01",
  },
  {
    type: "weekly_huddle",
    freq: "weekly",
    title: "Weekly Huddle",
    owner: "vp_membership",
    sop: "CH-02",
  },
  {
    type: "board_meeting",
    freq: "monthly",
    title: "Board Meeting",
    owner: "president",
    sop: "CH-04",
  },
  {
    type: "meetup",
    freq: "monthly",
    title: "Meetup / Social",
    owner: "vp_programming",
    sop: "CH-03",
  },
  {
    type: "financial_close",
    freq: "monthly",
    title: "Financial close",
    owner: "treasurer",
    sop: "AF-03",
  },
  {
    type: "signature_event",
    freq: "quarterly",
    title: "Signature Event",
    owner: "vp_programming",
    sop: "CH-05",
  },
  {
    type: "health_review",
    freq: "quarterly",
    title: "Chapter Health Review",
    owner: "president",
    sop: "CH-06",
  },
] as const;

export const CADENCE_STATUSES = ["kept", "rescheduled", "missed"] as const;
export type CadenceStatus = (typeof CADENCE_STATUSES)[number];

/** ISO-8601 week number + week-year for a date. */
function isoWeek(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7; // Mon=1..Sun=7
  t.setUTCDate(t.getUTCDate() + 4 - day); // to Thursday of this week
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );
  return { year: t.getUTCFullYear(), week };
}

/** A stable key for the period a date falls in, per frequency. */
export function periodKey(freq: Frequency, d: Date): string {
  const y = d.getFullYear();
  if (freq === "monthly")
    return `${y}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  if (freq === "quarterly") return `${y}-Q${Math.floor(d.getMonth() / 3) + 1}`;
  if (freq === "annually") return `${y}`;
  const w = isoWeek(d);
  if (freq === "weekly") return `${w.year}-W${String(w.week).padStart(2, "0")}`;
  return `${w.year}-B${String(Math.ceil(w.week / 2)).padStart(2, "0")}`; // biweekly bucket
}

/** Shift a date back/forward by k whole periods of this frequency. */
export function shiftPeriods(freq: Frequency, d: Date, k: number): Date {
  const r = new Date(d);
  if (freq === "weekly") r.setDate(r.getDate() + 7 * k);
  else if (freq === "biweekly") r.setDate(r.getDate() + 14 * k);
  else if (freq === "monthly") r.setMonth(r.getMonth() + k);
  else if (freq === "quarterly") r.setMonth(r.getMonth() + 3 * k);
  else r.setFullYear(r.getFullYear() + k);
  return r;
}

/** The current period key plus the last `past` completed period keys (most
 *  recent first) — the window adherence is measured over. */
export function recentPeriodKeys(
  freq: Frequency,
  now: Date,
  past: number
): { current: string; history: string[] } {
  const current = periodKey(freq, now);
  const history: string[] = [];
  for (let i = 1; i <= past; i++)
    history.push(periodKey(freq, shiftPeriods(freq, now, -i)));
  return { current, history };
}

/** A human label for a cadence's next obligation. */
export function periodLabel(freq: Frequency): string {
  return (
    {
      weekly: "this week",
      biweekly: "this fortnight",
      monthly: "this month",
      quarterly: "this quarter",
      annually: "this year",
    } as const
  )[freq];
}
