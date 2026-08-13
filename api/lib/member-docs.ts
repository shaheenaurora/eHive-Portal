/** Pure (DB-free) helpers for member documents — membership number, CPD credit
 *  totals and membership-term dates. Unit-tested in api/member-docs.test.ts. */

/** Stable, human-readable membership number derived from the member id, e.g.
 *  member 19 → "EH-00019". Zero-padded to 5 digits so it reads as an ID. */
export function membershipNo(id: number): string {
  return "EH-" + String(Math.max(0, Math.trunc(id))).padStart(5, "0");
}

/** Total CPD (Continuing Professional Development) credits from attended events. */
export function cpdTotal(rows: { cpdCredits?: number | null }[]): number {
  return rows.reduce((sum, r) => sum + (r.cpdCredits ?? 0), 0);
}

/** The current annual membership term's end date: the next anniversary of the
 *  join date on or after `from`. Annual membership (BRD §7.1), so a certificate
 *  can state the term it is valid for. */
export function membershipValidThrough(
  joinedAt: Date,
  from: Date = new Date()
): Date {
  const d = new Date(joinedAt);
  d.setFullYear(from.getFullYear());
  if (d.getTime() <= from.getTime()) d.setFullYear(from.getFullYear() + 1);
  return d;
}
