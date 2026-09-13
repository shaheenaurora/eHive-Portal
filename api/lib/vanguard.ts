/**
 * Vanguard founding-cohort scarcity engine.
 *
 * Backs the public launch claims — "forty seats", "the rate rises" — with real
 * state, so the site never publishes a cap or a price the system can't hold. The
 * cap and both prices are overridable at runtime via app_config, so they can be
 * tuned without a deploy.
 *
 * Note on the join model: during the founding cohort Vanguard is application-only
 * (VANGUARD_FOUNDING_APPLICATION_ONLY), so admission is manual — this engine
 * measures and prices the cohort, it does not open self-serve checkout.
 */
import { and, eq, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import {
  VANGUARD_FOUNDING_CAP,
  VANGUARD_FOUNDING_PRICE_AED,
  VANGUARD_POST_FOUNDING_PRICE_AED,
  VANGUARD_ACTIVATION_PRICE_AED,
  vanguardSetting,
} from "@contracts/constants";

async function configValue(key: string): Promise<string | null> {
  const row = (
    await getDb()
      .select({ value: schema.appConfig.value })
      .from(schema.appConfig)
      .where(eq(schema.appConfig.key, key))
      .limit(1)
  ).at(0);
  return row?.value ?? null;
}

/** Number of active Vanguard members — the admitted founding seats. */
export async function admittedFoundingSeats(): Promise<number> {
  const row = (
    await getDb()
      .select({ n: sql<number>`count(*)` })
      .from(schema.members)
      .where(
        and(
          eq(schema.members.tier, "vanguard"),
          eq(schema.members.status, "active")
        )
      )
  ).at(0);
  return Number(row?.n ?? 0);
}

export type CohortStatus = {
  cap: number;
  admitted: number;
  seatsLeft: number;
  /** Whether founding seats remain (admission is still by application). */
  open: boolean;
  foundingPriceAed: number;
  postFoundingPriceAed: number;
  /** The price a new founding member pays right now: the charter rate while
   *  seats remain, the standard rate once the cohort has filled. */
  currentPriceAed: number;
};

/** Live founding-cohort status — safe to expose publicly (no PII). */
export async function cohortStatus(): Promise<CohortStatus> {
  const [capRaw, foundingRaw, postRaw, admitted] = await Promise.all([
    configValue("vanguard:founding_cap"),
    configValue("vanguard:founding_price_aed"),
    configValue("vanguard:post_founding_price_aed"),
    admittedFoundingSeats(),
  ]);
  const cap = vanguardSetting(capRaw, VANGUARD_FOUNDING_CAP, {
    min: 1,
    max: 100_000,
  });
  const foundingPriceAed = vanguardSetting(
    foundingRaw,
    VANGUARD_FOUNDING_PRICE_AED
  );
  const postFoundingPriceAed = vanguardSetting(
    postRaw,
    VANGUARD_POST_FOUNDING_PRICE_AED
  );
  const seatsLeft = Math.max(0, cap - admitted);
  const open = seatsLeft > 0;
  return {
    cap,
    admitted,
    seatsLeft,
    open,
    foundingPriceAed,
    postFoundingPriceAed,
    currentPriceAed: open ? foundingPriceAed : postFoundingPriceAed,
  };
}

/** The Vanguard membership price (in AED) a checkout should charge right now:
 *  the founding charter rate while seats remain, the standard rate once the
 *  cohort has filled. This is what makes "the rate rises" true. */
export async function vanguardCheckoutPriceAed(): Promise<number> {
  return (await cohortStatus()).currentPriceAed;
}

/** The AED price of the Clarity Sprint activation right now (config-overridable). */
export async function activationPriceAed(): Promise<number> {
  return vanguardSetting(
    await configValue("vanguard:activation_price_aed"),
    VANGUARD_ACTIVATION_PRICE_AED
  );
}
