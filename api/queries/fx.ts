/**
 * Multi-currency FX rates. The base currency (AED) is always rate 1; every other
 * supported currency has an admin-maintained rate in currency_rates. Finance
 * reporting uses ratesMap() to convert each payment to the base before
 * aggregating, so a mixed-currency ledger reports in one number.
 */
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import * as schema from "@db/schema";
import { getDb } from "./connection";
import { audit } from "../lib/audit";
import {
  BASE_CURRENCY,
  CURRENCY_CODES,
  FX_RATE_SCALE,
} from "@contracts/constants";

type Actor = { id: number; email: string };

/** All supported currencies with their current rate (base defaults to scale,
 *  unknown currencies default to the base rate so nothing is lost). */
export async function listRates(): Promise<
  {
    code: string;
    rateScaled: number;
    updatedAt: Date | null;
    isBase: boolean;
  }[]
> {
  const rows = await getDb().select().from(schema.currencyRates);
  const byCode = new Map(rows.map(r => [r.code, r]));
  return CURRENCY_CODES.map(code => {
    if (code === BASE_CURRENCY)
      return { code, rateScaled: FX_RATE_SCALE, updatedAt: null, isBase: true };
    const r = byCode.get(code);
    return {
      code,
      rateScaled: r ? Number(r.rateScaled) : FX_RATE_SCALE,
      updatedAt: r?.updatedAt ?? null,
      isBase: false,
    };
  });
}

/** A code→rateScaled map for fast conversion. Only the base currency and
 *  currencies with an explicit admin-maintained rate are included; callers that
 *  need a guaranteed rate must use `requireRate`. */
export async function ratesMap(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (const r of await getDb().select().from(schema.currencyRates))
    map.set(r.code, Number(r.rateScaled));
  map.set(BASE_CURRENCY, FX_RATE_SCALE);
  return map;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Rates plus their last-updated timestamps for staleness checks. */
export async function loadRates(): Promise<{
  rates: Map<string, number>;
  updatedAt: Map<string, Date | null>;
}> {
  const rows = await getDb().select().from(schema.currencyRates);
  const rates = new Map<string, number>();
  const updatedAt = new Map<string, Date | null>();
  for (const r of rows) {
    rates.set(r.code, Number(r.rateScaled));
    updatedAt.set(r.code, r.updatedAt);
  }
  rates.set(BASE_CURRENCY, FX_RATE_SCALE);
  updatedAt.set(BASE_CURRENCY, null);
  return { rates, updatedAt };
}

/** Fail-closed FX lookup: throw if a non-base currency has no rate or a stale rate. */
export function requireRate(
  code: string,
  rates: Map<string, number>,
  updatedAt?: Map<string, Date | null>
): number {
  const normalized = code.toLowerCase();
  if (normalized === BASE_CURRENCY) return FX_RATE_SCALE;
  const rate = rates.get(normalized);
  if (rate == null) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `No FX rate configured for ${code.toUpperCase()}. Add the rate before running this report.`,
    });
  }
  const updated = updatedAt?.get(normalized);
  if (updated != null && Date.now() - updated.getTime() > DAY_MS) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `FX rate for ${code.toUpperCase()} is stale (last updated ${updated.toISOString()}). Refresh the rate before running this report.`,
    });
  }
  return rate;
}

/** Set (upsert) the FX rate for a currency. `rate` is base units per 1 unit of
 *  the currency (e.g. 1 USD = 3.67 AED → rate 3.67); stored ×FX_RATE_SCALE. */
export async function setRate(actor: Actor, code: string, rate: number) {
  if (code === BASE_CURRENCY)
    throw new Error("The base currency's rate is fixed at 1.");
  if (!(CURRENCY_CODES as readonly string[]).includes(code))
    throw new Error("Unsupported currency.");
  if (!(rate > 0) || !Number.isFinite(rate))
    throw new Error("Rate must be a positive number.");
  const db = getDb();
  const prior = (
    await db
      .select({ rateScaled: schema.currencyRates.rateScaled })
      .from(schema.currencyRates)
      .where(eq(schema.currencyRates.code, code))
      .limit(1)
  ).at(0);
  const priorRate = prior ? Number(prior.rateScaled) / FX_RATE_SCALE : null;
  const rateScaled = Math.round(rate * FX_RATE_SCALE);
  await db
    .insert(schema.currencyRates)
    .values({ code, rateScaled, updatedByUserId: actor.id })
    .onDuplicateKeyUpdate({
      set: { rateScaled, updatedByUserId: actor.id },
    });
  await audit(actor, "finance.fx.rate", {
    type: "currency",
    id: 0,
    detail: `${code.toUpperCase()} = ${rate}${
      priorRate != null ? ` (was ${priorRate})` : ""
    }`,
  });
  return { ok: true };
}

/** Delete a currency's override, reverting it to the base rate. */
export async function clearRate(actor: Actor, code: string) {
  await getDb()
    .delete(schema.currencyRates)
    .where(eq(schema.currencyRates.code, code));
  await audit(actor, "finance.fx.clear", {
    type: "currency",
    id: 0,
    detail: code.toUpperCase(),
  });
  return { ok: true };
}
