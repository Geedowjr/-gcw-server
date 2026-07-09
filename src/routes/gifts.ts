import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { giftCatalog, giftEvents, creatorProfiles, wallets } from "../db/schema.js";
import { optionalAuth } from "../auth/middleware.js";
import { idempotency } from "../idempotency.js";
import { giftSendLimiter } from "../rateLimits.js";
import { creditWallet } from "../ledger/wallet.js";
import { creditCreatorPending } from "../ledger/creator.js";
import { resolveTierForGift } from "../tiers.js";
import { splitFee } from "../money.js";
import { emitGift } from "../sockets/emitters.js";
import { giftsSentTotal } from "../metrics.js";
import { redis } from "../redis.js";
import { topSendersKey, topCreatorsKey } from "./leaderboard.js";

export const giftsRouter = Router();

giftsRouter.get("/catalog", async (_req, res) => {
  const rows = await db.select().from(giftCatalog).where(eq(giftCatalog.active, true));
  res.json(rows);
});

const sendGiftSchema = z.object({
  streamId: z.string().uuid().optional(),
  creatorId: z.string().uuid(),
  senderWalletToken: z.string().uuid(),
  senderName: z.string().min(1).max(40),
  giftId: z.string(),
}).strict();

giftsRouter.post("/send", optionalAuth(), giftSendLimiter, idempotency(), async (req, res) => {
  const parsed = sendGiftSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
  const { streamId, creatorId, senderWalletToken, senderName, giftId } = parsed.data;

  const [gift] = await db.select().from(giftCatalog).where(eq(giftCatalog.id, giftId));
  if (!gift || !gift.active) return res.status(404).json({ error: "gift_not_found" });

  const [wallet] = await db.select().from(wallets).where(eq(wallets.walletToken, senderWalletToken));
  if (!wallet) return res.status(404).json({ error: "wallet_not_found" });
  if (wallet.coinBalance < gift.coins) return res.status(402).json({ error: "insufficient_coins" });

  const [creatorProfile] = await db.select().from(creatorProfiles).where(eq(creatorProfiles.userId, creatorId));
  if (!creatorProfile) return res.status(404).json({ error: "creator_not_found" });

  const result = await db.transaction(async (tx) => {
    // 1. Debit sender wallet
    await creditWallet(tx as any, {
      walletToken: senderWalletToken,
      deltaCoins: -gift.coins,
      reason: "gift_send",
      refType: "gift",
    });

    // 2. Resolve tier using lifetime_coins + gift.coins (post-gift total), inside this tx
    const { tierKey, tier, totalAfter } = resolveTierForGift(creatorProfile.lifetimeCoins, gift.coins);
    const { platformFeeCents, creatorShareCents } = splitFee(gift.usdCents, tier.cut);

    // 3. Insert gift_event
    const [giftEvent] = await tx
      .insert(giftEvents)
      .values({
        streamId: streamId ?? null,
        creatorId,
        senderWalletToken,
        senderName,
        giftId: gift.id,
        coins: gift.coins,
        grossCents: gift.usdCents,
        feePct: String(tier.cut),
        platformFeeCents,
        creatorShareCents,
      })
      .returning();

    // 4. Credit creator ledger (pending, subject to hold window)
    await creditCreatorPending(tx as any, {
      userId: creatorId,
      deltaCents: creatorShareCents,
      reason: "gift_earnings",
      refType: "gift_event",
      refId: giftEvent.id,
    });

    // 5. Update creator tier/lifetime coins
    await tx
      .update(creatorProfiles)
      .set({ lifetimeCoins: totalAfter, currentLevel: Number(tierKey.replace("level", "")), updatedAt: new Date() })
      .where(eq(creatorProfiles.userId, creatorId));

    return { giftEvent, tierKey, platformFeeCents, creatorShareCents };
  });

  giftsSentTotal.inc();

  // 6. Update Redis sorted-set leaderboards (best-effort, outside the DB transaction)
  if (streamId) {
    await redis.zincrby(topSendersKey(streamId, "live"), gift.coins, senderName);
  }
  await redis.zincrby(topCreatorsKey("day"), result.creatorShareCents, creatorId);
  await redis.zincrby(topCreatorsKey("week"), result.creatorShareCents, creatorId);
  await redis.zincrby(topCreatorsKey("month"), result.creatorShareCents, creatorId);

  // 7. Emit realtime event (outside the DB transaction — best-effort)
  emitGift({
    streamId,
    creatorId,
    giftEventId: result.giftEvent.id,
    giftName: gift.name,
    senderName,
    coins: gift.coins,
    grossCents: gift.usdCents,
    platformFeeCents: result.platformFeeCents,
    creatorShareCents: result.creatorShareCents,
    feePct: Number(result.giftEvent.feePct),
  });

  res.status(201).json({
    giftEventId: result.giftEvent.id,
    coins: gift.coins,
    grossCents: gift.usdCents,
    platformFeeCents: result.platformFeeCents,
    creatorShareCents: result.creatorShareCents,
    newTier: result.tierKey,
  });
});
