import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import { isFullAdmin } from "../middleware";
import { safeUrl } from "../lib/url";
import { tierRank } from "@contracts/constants";

export { isFullAdmin, safeUrl };

export const SCOPE_ENUM = z.enum([
  "membership",
  "community",
  "events",
  "chapters",
  "member_success",
  "partnerships",
  "content",
  "finance",
  "conduct",
  "leads",
]);

export const TIER = z.enum(["horizon", "ascent", "vanguard", "zenith"]);
export const idInput = z.object({ id: z.number().int().positive() });

/* ERP change-request payloads (member-admin service). */
export const CHANGE_CATEGORY = z.enum([
  "profile",
  "tier",
  "status",
  "lifecycle",
  "chapter",
]);
export const FIELD_CHANGE = z.object({
  field: z.string().max(64),
  label: z.string().max(64),
  from: z.string().nullable(),
  to: z.string().nullable(),
});

/* Activity master — full catalogue of activity kinds and audience scopes.
   Keep the kind list in sync with EVENT_KINDS (contracts/constants). */
export const EVENT_KIND = z.enum([
  "spark",
  "meetup",
  "circle",
  "retreat",
  "summit",
  "conference",
  "conclave",
  "roundtable",
  "workshop",
  "masterclass",
  "breakfast",
  "lunch",
  "dinner",
  "social",
  "webinar",
]);
export const AUDIENCE = z.enum(["public", "members", "tiers"]);

/* Normalise the audience choice into the stored columns. `tierGate` is kept in
   step (lowest eligible tier) so legacy gate checks still behave sensibly. */
export function resolveAudience(
  audience: "public" | "members" | "tiers",
  tiers?: string[]
) {
  if (audience === "tiers") {
    const valid = (tiers ?? []).filter(t =>
      ["horizon", "ascent", "vanguard", "zenith"].includes(t)
    );
    const set = valid.length
      ? valid
      : ["horizon", "ascent", "vanguard", "zenith"];
    const gate = set.reduce(
      (lo, t) => (tierRank(t) < tierRank(lo) ? t : lo),
      set[0]
    ) as "horizon" | "ascent" | "vanguard" | "zenith";
    return { audience, audienceTiers: set.join(","), tierGate: gate };
  }
  return { audience, audienceTiers: null, tierGate: "horizon" as const };
}

export async function mustMember(memberId: number) {
  const rows = await getDb()
    .select()
    .from(schema.members)
    .where(eq(schema.members.id, memberId))
    .limit(1);
  const m = rows.at(0);
  if (!m)
    throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
  return m;
}
