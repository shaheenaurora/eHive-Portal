/**
 * Read-only integration API helpers — auth and pure record mappers for the
 * `/api/integrations/v1/*` endpoints an external ERP / accounting system polls.
 *
 * Data is exposed with the platform's stable reference codes (EH-INV-…, EH-M-…,
 * EH-CH-…) as external IDs, amounts in major currency units, and ISO timestamps,
 * so a third-party system can correlate and sync without touching the DB.
 */
import { timingSafeEqual } from "node:crypto";
import { env } from "./env";
import { refCode } from "@contracts/ids";
import type { IntegrationApiKey } from "./env";

/** Whether the integration API is enabled (at least one key configured). */
export function integrationEnabled(): boolean {
  return env.integrationApiKeys.length > 0;
}

/** Constant-time string comparison that won't throw on length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** The API key presented on a request: `Authorization: Bearer <key>` or the
 *  `X-API-Key` header. Returns null when neither is present. */
export function presentedKey(headers: Headers): string | null {
  const auth = headers.get("authorization");
  if (auth && /^Bearer\s+/i.test(auth))
    return auth.replace(/^Bearer\s+/i, "").trim() || null;
  const x = headers.get("x-api-key");
  return x?.trim() || null;
}

/**
 * Check whether a set of configured scopes allows a requested resource.
 * A scope of "*" grants all resources.
 */
export function hasScope(scopes: readonly string[], resource: string): boolean {
  return scopes.includes("*") || scopes.includes(resource);
}

/**
 * Match a presented key against the configured keys. Returns the matched key
 * metadata (including its scopes) or null. Constant-time over the key list.
 */
export function matchesKey(
  configured: readonly IntegrationApiKey[],
  presented: string
): IntegrationApiKey | null {
  if (!presented) return null;
  // Evaluate every key so timing doesn't reveal which (if any) matched.
  return configured.reduce<IntegrationApiKey | null>((match, k) => {
    if (safeEqual(k.value, presented)) return k;
    return match;
  }, null);
}

/**
 * Authorize an incoming integration request. Returns the matched key metadata
 * so callers can enforce per-resource scopes and audit which key was used.
 */
export function authorizeIntegration(
  headers: Headers
): IntegrationApiKey | null {
  const key = presentedKey(headers);
  if (!key) return null;
  return matchesKey(env.integrationApiKeys, key);
}

/** Clamp a caller-supplied page size to a safe range. */
export function clampLimit(
  raw: string | null | undefined,
  def = 100,
  max = 500
) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), max);
}

/* ----------------------------- record mappers ----------------------------- */

export type IntegrationPaymentRow = {
  id: number;
  userId: number;
  provider: string;
  providerRef: string | null;
  purpose: string;
  tier: string | null;
  amount: number; // minor units (fils)
  currency: string;
  status: string;
  refundedAmount: number; // minor units
  paidAt: Date | string | null;
  refundedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  payerName: string | null;
  payerEmail: string | null;
};

function iso(d: Date | string | null | undefined): string | null {
  return d ? new Date(d).toISOString() : null;
}

/** A payment/receipt record for an external accounting system. Amounts in the
 *  major currency unit (AED). `net` is gross minus any refund. */
export function toPaymentDto(r: IntegrationPaymentRow) {
  const currency = (r.currency || "aed").toUpperCase();
  const gross = r.amount / 100;
  const refunded = (r.refundedAmount ?? 0) / 100;
  return {
    ref: refCode("payment", r.id),
    object: "payment",
    status: r.status,
    purpose: r.purpose,
    tier: r.tier,
    currency,
    amount: gross,
    refundedAmount: refunded,
    netAmount: Number((gross - refunded).toFixed(2)),
    provider: r.provider,
    providerRef: r.providerRef,
    customer: {
      ref: refCode("user", r.userId),
      name: r.payerName,
      email: r.payerEmail,
    },
    createdAt: iso(r.createdAt),
    paidAt: iso(r.paidAt),
    refundedAt: iso(r.refundedAt),
    updatedAt: iso(r.updatedAt),
  };
}

export type IntegrationExpenseRow = {
  id: number;
  chapterId: number;
  label: string;
  category: string | null;
  amount: number; // whole AED
  status: string;
  note: string | null;
  createdAt: Date | string;
};

/** A chapter expense (spend) record for external accounting. Amount in AED. */
export function toExpenseDto(r: IntegrationExpenseRow) {
  return {
    id: r.id,
    object: "expense",
    chapter: { ref: refCode("chapter", r.chapterId) },
    label: r.label,
    category: r.category ?? "uncategorised",
    currency: "AED",
    amount: r.amount,
    status: r.status,
    note: r.note,
    createdAt: iso(r.createdAt),
  };
}

export type IntegrationMemberRow = {
  id: number;
  userId: number;
  name: string | null;
  email: string | null;
  tier: string | null;
  status: string;
  lifecycleState: string | null;
  homeChapterId: number | null;
  joinedAt: Date | string | null;
  updatedAt: Date | string;
};

/** A member/customer record for external CRM/accounting correlation. */
export function toMemberDto(r: IntegrationMemberRow) {
  return {
    ref: refCode("member", r.id),
    object: "member",
    customerRef: refCode("user", r.userId),
    name: r.name,
    email: r.email,
    tier: r.tier,
    status: r.status,
    lifecycleState: r.lifecycleState,
    homeChapter: r.homeChapterId
      ? { ref: refCode("chapter", r.homeChapterId) }
      : null,
    joinedAt: iso(r.joinedAt),
    updatedAt: iso(r.updatedAt),
  };
}
