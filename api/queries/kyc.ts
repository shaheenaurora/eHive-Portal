import { eq, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import * as schema from "@db/schema";
import { getDb } from "./connection";
import { audit } from "../lib/audit";
import { notify } from "./circle";

export type Actor = { id: number; email: string };

/** A member's KYC record, or null if they've never started. */
export async function getKyc(memberId: number) {
  return (
    (
      await getDb()
        .select()
        .from(schema.memberKyc)
        .where(eq(schema.memberKyc.memberId, memberId))
        .limit(1)
    ).at(0) ?? null
  );
}

/** Member submits / updates their KYC details → status becomes 'submitted'.
 *  Idempotent upsert keyed by memberId. */
export async function submitKyc(
  memberId: number,
  input: {
    idType: "emirates_id" | "passport" | "other";
    idNumber: string;
    nationality?: string | null;
    idExpiry?: Date | null;
  }
) {
  const db = getDb();
  const existing = await getKyc(memberId);
  const values = {
    idType: input.idType,
    idNumber: input.idNumber.slice(0, 64),
    nationality: input.nationality?.slice(0, 96) ?? null,
    idExpiry: input.idExpiry ?? null,
    status: "submitted" as const,
    submittedAt: new Date(),
    // A re-submission clears the previous decision.
    reviewedByUserId: null,
    reviewedAt: null,
    reviewNote: null,
  };
  if (existing) {
    await db
      .update(schema.memberKyc)
      .set(values)
      .where(eq(schema.memberKyc.memberId, memberId));
  } else {
    await db.insert(schema.memberKyc).values({ memberId, ...values });
  }
  return { ok: true };
}

/** Admin verifies or rejects a member's KYC submission. */
export async function reviewKyc(
  actor: Actor,
  memberId: number,
  decision: "verified" | "rejected",
  note?: string
) {
  const db = getDb();
  const kyc = await getKyc(memberId);
  if (!kyc)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "No KYC submission for this member.",
    });
  if (kyc.status !== "submitted")
    throw new TRPCError({
      code: "CONFLICT",
      message: "Only a submitted KYC can be reviewed.",
    });
  await db
    .update(schema.memberKyc)
    .set({
      status: decision,
      reviewedByUserId: actor.id,
      reviewedAt: new Date(),
      reviewNote: note?.slice(0, 500) ?? null,
    })
    .where(eq(schema.memberKyc.memberId, memberId));
  await audit(actor, "kyc.review", {
    type: "member",
    id: memberId,
    detail: decision + (note ? ` — ${note}` : ""),
  });
  try {
    await notify(
      memberId,
      decision === "verified"
        ? "Your identity verification (KYC) has been approved. Thank you."
        : `Your identity verification needs attention${note ? `: ${note}` : "."}. Please re-submit your details.`,
      "membership"
    );
  } catch {
    /* non-fatal */
  }
  return { ok: true };
}

export type KycQueueRow = {
  memberId: number;
  memberName: string | null;
  email: string | null;
  idType: string | null;
  nationality: string | null;
  submittedAt: Date | null;
};

/** KYC submissions awaiting review, oldest first. */
export async function kycQueue(): Promise<KycQueueRow[]> {
  return getDb()
    .select({
      memberId: schema.memberKyc.memberId,
      memberName: schema.users.name,
      email: schema.users.email,
      idType: schema.memberKyc.idType,
      nationality: schema.memberKyc.nationality,
      submittedAt: schema.memberKyc.submittedAt,
    })
    .from(schema.memberKyc)
    .innerJoin(schema.members, eq(schema.members.id, schema.memberKyc.memberId))
    .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
    .where(eq(schema.memberKyc.status, "submitted"))
    .orderBy(desc(schema.memberKyc.submittedAt))
    .limit(200);
}
