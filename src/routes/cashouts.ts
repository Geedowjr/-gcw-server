import { Router } from "express";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { creatorProfiles, cashouts, fxRates } from "../db/schema.js";
import { requireAuth, require2FA } from "../auth/middleware.js";
import { idempotency } from "../idempotency.js";
import { cashoutLimiter } from "../rateLimits.js";
import { debitPayoutBalance, refundPayoutBalance } from "../ledger/creator.js";
import { env } from "../env.js";
import { queues } from "../jobs/queues.js";
import { cashoutsTotal } from "../metrics.js";
import { FALLBACK_FX_RATES } from "../money.js";

export const cashoutsRouter = Router();

const cashoutSchema = z.object({
  destinationType: z.enum(["mpesa", "evcplus", "edahab", "stripe", "bank"]),
  destinationAccount: z.string().min(3),
  amountCents: z.number().int().positive(),
}).strict();

cashoutsRouter.post(
  "/",
  requireAuth(),
  cashoutLimiter,
  require2FA(),
  idempotency(),
  async (req, res) => {
    const parsed = cashoutSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
    const { destinationType, destinationAccount, amountCents } = parsed.data;
    const idempotencyKey = req.header("Idempotency-Key")!;

    const [profile] = await db.select().from(creatorProfiles).where(eq(creatorProfiles.userId, req.user!.id));
    if (!profile) return res.status(404).json({ error: "not_found" });

    if (profile.kycStatus !== "approved") {
      return res.status(403).json({ error: "kyc_not_approved" });
    }

    const minCents = env.MIN_CASHOUT_USD * 100;
    if (amountCents < minCents) {
      return res.status(400).json({ error: "below_minimum_cashout", minCents });
    }
    if (amountCents > profile.payoutBalanceCents) {
      return res.status(400).json({ error: "insufficient_balance" });
    }

    // Snapshot FX rate for local-currency payout methods.
    let fxRate = 1;
    let localAmountCents = amountCents;
    const pairMap: Record<string, string> = { mpesa: "USD_KES", evcplus: "USD_SOS", edahab: "USD_SOS" };
    const pair = pairMap[destinationType];
    if (pair) {
      const [snapshot] = await db
        .select()
        .from(fxRates)
        .where(eq(fxRates.pair, pair))
        .orderBy(desc(fxRates.capturedAt))
        .limit(1);
      fxRate = snapshot ? Number(snapshot.rate) : FALLBACK_FX_RATES[pair] ?? 1;
      localAmountCents = Math.round(amountCents * fxRate);
    }

    const cashout = await db.transaction(async (tx) => {
      await debitPayoutBalance(tx as any, {
        userId: req.user!.id,
        amountCents,
        reason: "cashout_request",
      });

      const [row] = await tx
        .insert(cashouts)
        .values({
          creatorId: req.user!.id,
          destinationType,
          destinationAccount,
          amountCents,
          currency: "USD",
          fxRate: String(fxRate),
          localAmountCents,
          status: "pending",
          idempotencyKey,
        })
        .returning();
      return row;
    });

    await queues.payout.add("process-payout", { cashoutId: cashout.id });
    cashoutsTotal.inc({ status: "pending" });

    res.status(202).json({ cashoutId: cashout.id, status: "pending" });
  }
);

cashoutsRouter.get("/:id", requireAuth(), async (req, res) => {
  const [cashout] = await db.select().from(cashouts).where(eq(cashouts.id, req.params.id));
  if (!cashout || cashout.creatorId !== req.user!.id) return res.status(404).json({ error: "not_found" });
  res.json(cashout);
});
