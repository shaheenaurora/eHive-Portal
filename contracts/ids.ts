/**
 * Reference-code system — one source of truth for the human-readable public ID
 * of every entity in eHive. Every table already has a numeric primary key and
 * the relationships already exist by that key; this layer puts a consistent,
 * legible code on top (EH-M-00019, EH-CH-0003, EH-EV-00021, …) so a member, a
 * chapter, an event, a pod, an invoice, etc. can all be referenced and connected
 * by a stable code on documents, invoices, reports and support.
 *
 * Codes are DERIVED deterministically from the entity's numeric id — no stored
 * column, no migration, and the same id always yields the same code. They are
 * also reversible (`parseRefCode`) so a code pasted into search resolves back to
 * (type, id). Changing a prefix here changes it everywhere at once.
 *
 * NOTE: invoices that need a gapless, year-scoped legal sequence use a separate
 * stored counter (see the billing module); this derived code is the internal
 * reference for a payment record.
 */

export const ID_PREFIX = {
  member: "EH-M",
  chapter: "EH-CH",
  zone: "EH-ZN",
  region: "EH-RG",
  country: "EH-CO",
  role: "EH-RL", // a leadership/role assignment
  event: "EH-EV",
  session: "EH-MT", // a meeting / pod session
  pod: "EH-PD",
  payment: "EH-INV", // a payment / invoice record
  offer: "EH-BN", // a member benefit / offer
  application: "EH-AP",
  activity: "EH-AC", // an audit-log / activity entry
  award: "EH-AW",
  lead: "EH-LD",
} as const;

export type EntityType = keyof typeof ID_PREFIX;

/** Zero-pad width per type (fewer, larger units get shorter codes). */
const PAD: Partial<Record<EntityType, number>> = {
  country: 3,
  region: 3,
  zone: 3,
  chapter: 4,
  pod: 4,
  offer: 4,
};
const DEFAULT_PAD = 5;

/** Public reference code for an entity, e.g. refCode("member", 19) → "EH-M-00019". */
export function refCode(type: EntityType, id: number): string {
  const n = Math.max(0, Math.trunc(id));
  return `${ID_PREFIX[type]}-${String(n).padStart(PAD[type] ?? DEFAULT_PAD, "0")}`;
}

/** Reverse of refCode: "EH-CH-0003" → { type: "chapter", id: 3 }. Case- and
 *  whitespace-insensitive. Returns null when the code isn't a known form. */
export function parseRefCode(
  code: string
): { type: EntityType; id: number } | null {
  const m = code
    .trim()
    .toUpperCase()
    .match(/^(EH-[A-Z]+)-(\d+)$/);
  if (!m) return null;
  const hit = (Object.entries(ID_PREFIX) as [EntityType, string][]).find(
    ([, prefix]) => prefix === m[1]
  );
  if (!hit) return null;
  return { type: hit[0], id: parseInt(m[2], 10) };
}
