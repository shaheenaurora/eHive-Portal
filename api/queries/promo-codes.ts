import { sql, eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";

export type PromoValidation =
  | { ok: true; discountedFils: number; promo: schema.PromoCode }
  | { ok: false; error: string };

/**
 * Validate a promo code against a checkout: active, in its window, tier-scope
 * match, and produces a sane discount. Does NOT claim a use — call claimPromo
 * atomically with the checkout insert.
 */
export async function validatePromo(
  rawCode: string,
  tier: string,
  amountFils: number
): Promise<PromoValidation> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return { ok: false, error: "Enter a promo code." };
  const promo = (
    await getDb()
      .select()
      .from(schema.promoCodes)
      .where(eq(schema.promoCodes.code, code))
      .limit(1)
  ).at(0);
  if (!promo || !promo.active) {
    return { ok: false, error: "That promo code isn't valid." };
  }
  const now = new Date();
  if (promo.startsAt && promo.startsAt > now)
    return { ok: false, error: "That promo code isn't active yet." };
  if (promo.endsAt && promo.endsAt < now)
    return { ok: false, error: "That promo code has expired." };
  if (promo.maxUses != null && promo.usedCount >= promo.maxUses)
    return { ok: false, error: "That promo code has been fully used." };
  if (
    promo.tierScope &&
    !promo.tierScope.split(",").map(s => s.trim()).includes(tier)
  ) {
    return { ok: false, error: "That promo code doesn't apply to this tier." };
  }
  const discount =
    promo.kind === "percent"
      ? Math.floor((amountFils * Math.min(Math.max(promo.value, 1), 100)) / 100)
      : Math.min(promo.value, amountFils);
  if (discount <= 0) return { ok: false, error: "That promo code has no value." };
  return { ok: true, discountedFils: amountFils - discount, promo };
}

/**
 * Atomically claim one use of a promo code. The conditional UPDATE is the
 * guard: under concurrent checkouts, only as many claims succeed as the cap
 * allows (MySQL row locking serializes the increments).
 */
export async function claimPromo(promoId: number): Promise<boolean> {
  const res = await getDb().execute(sql`
    UPDATE ${schema.promoCodes}
    SET usedCount = usedCount + 1
    WHERE id = ${promoId}
      AND active = true
      AND (maxUses IS NULL OR usedCount < maxUses)
  `);
  const affected = Number((res as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0);
  return affected > 0;
}

/** Roll back a claim when checkout creation fails after claiming (provider
 * error etc.) so abandoned attempts don't silently consume a code's cap. */
export async function releasePromo(promoId: number): Promise<void> {
  await getDb().execute(sql`
    UPDATE ${schema.promoCodes}
    SET usedCount = GREATEST(usedCount - 1, 0)
    WHERE id = ${promoId}
  `);
}
