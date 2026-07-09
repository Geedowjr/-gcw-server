import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { creatorProfiles, creatorLedger } from "../db/schema.js";
import { env } from "../env.js";

/**
 * Credits creator earnings into pending_balance_cents (subject to the cashout
 * hold window) and records the ledger row in the same transaction.
 */
export async function creditCreatorPending(
  tx: Db,
  params: {
    userId: string;
    deltaCents: number;
    currency?: string;
    reason: string;
    refType?: string;
    refId?: string;
  }
) {
  const availableAt = new Date(Date.now() + env.CASHOUT_HOLD_DAYS * 24 * 60 * 60 * 1000);

  await tx
    .update(creatorProfiles)
    .set({
      pendingBalanceCents: sql`${creatorProfiles.pendingBalanceCents} + ${params.deltaCents}`,
      lifetimeEarningsCents: sql`${creatorProfiles.lifetimeEarningsCents} + ${params.deltaCents}`,
      updatedAt: new Date(),
    })
    .where(eq(creatorProfiles.userId, params.userId));

  await tx.insert(creatorLedger).values({
    userId: params.userId,
    deltaCents: params.deltaCents,
    currency: params.currency ?? "USD",
    reason: params.reason,
    refType: params.refType,
    refId: params.refId,
    availableAt,
  });
}

/** Moves matured pending earnings (available_at <= now) into payout_balance_cents. */
export async function promoteMaturedEarnings(tx: Db, userId: string, amountCents: number) {
  await tx
    .update(creatorProfiles)
    .set({
      pendingBalanceCents: sql`${creatorProfiles.pendingBalanceCents} - ${amountCents}`,
      payoutBalanceCents: sql`${creatorProfiles.payoutBalanceCents} + ${amountCents}`,
      updatedAt: new Date(),
    })
    .where(eq(creatorProfiles.userId, userId));
}

/** Debits payout_balance_cents when a cashout is requested. Reverses on failure. */
export async function debitPayoutBalance(
  tx: Db,
  params: { userId: string; amountCents: number; reason: string; refType?: string; refId?: string }
) {
  const [profile] = await tx
    .update(creatorProfiles)
    .set({ payoutBalanceCents: sql`${creatorProfiles.payoutBalanceCents} - ${params.amountCents}` })
    .where(eq(creatorProfiles.userId, params.userId))
    .returning();

  if (!profile || profile.payoutBalanceCents < 0) {
    throw new Error("insufficient_payout_balance");
  }

  await tx.insert(creatorLedger).values({
    userId: params.userId,
    deltaCents: -params.amountCents,
    currency: "USD",
    reason: params.reason,
    refType: params.refType,
    refId: params.refId,
  });

  return profile;
}

export async function refundPayoutBalance(
  tx: Db,
  params: { userId: string; amountCents: number; reason: string; refType?: string; refId?: string }
) {
  await tx
    .update(creatorProfiles)
    .set({ payoutBalanceCents: sql`${creatorProfiles.payoutBalanceCents} + ${params.amountCents}` })
    .where(eq(creatorProfiles.userId, params.userId));

  await tx.insert(creatorLedger).values({
    userId: params.userId,
    deltaCents: params.amountCents,
    currency: "USD",
    reason: params.reason,
    refType: params.refType,
    refId: params.refId,
  });
}
