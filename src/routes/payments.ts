import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { wallets, topups } from "../db/schema.js";
import { requireAuth, optionalAuth } from "../auth/middleware.js";
import { idempotency } from "../idempotency.js";
import { getGateway } from "../gateways/index.js";
import { getOrCreateWallet, creditWallet } from "../ledger/wallet.js";
import { logger } from "../logger.js";
import { captureException } from "../sentry.js";

export const paymentsRouter = Router();

const buyCoinsSchema = z.object({
  walletToken: z.string().uuid().optional(),
  method: z.enum(["stripe", "mpesa", "evcplus", "edahab"]),
  amountCents: z.number().int().positive(),
  currency: z.string().default("USD"),
  coins: z.number().int().positive(),
  destinationAccount: z.string().optional(), // required for mobile-money methods
}).strict();

paymentsRouter.post("/buy-coins", optionalAuth(), idempotency(), async (req, res) => {
  const parsed = buyCoinsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
  const { method, amountCents, currency, coins, destinationAccount } = parsed.data;
  const idempotencyKey = req.header("Idempotency-Key")!;

  if (method !== "stripe" && !destinationAccount) {
    return res.status(400).json({ error: "destination_account_required_for_mobile_money" });
  }

  const wallet = await getOrCreateWallet(db as any, parsed.data.walletToken, req.user?.id);

  const gateway = getGateway(method);
  let chargeResult;
  try {
    chargeResult = await gateway.charge({
      amountCents,
      currency,
      destinationAccount,
      idempotencyKey,
      metadata: { walletToken: wallet.walletToken },
    });
  } catch (err) {
    logger.error({ err, method, walletToken: wallet.walletToken }, "gateway charge failed");
    captureException(err, { route: "/api/payments/buy-coins", method });
    return res.status(502).json({ error: "gateway_error", message: "Payment gateway is unavailable. Try again shortly." });
  }

  const [topup] = await db
    .insert(topups)
    .values({
      walletToken: wallet.walletToken,
      method,
      amountCents,
      currency,
      coins,
      status: chargeResult.status === "succeeded" ? "succeeded" : "pending",
      gatewayRef: chargeResult.gatewayRef,
      idempotencyKey,
    })
    .returning();

  if (chargeResult.status === "succeeded") {
    await db.transaction(async (tx) => {
      await creditWallet(tx as any, {
        walletToken: wallet.walletToken,
        deltaCoins: coins,
        reason: "topup",
        refType: "topup",
        refId: topup.id,
      });
    });
  }

  res.status(201).json({
    topupId: topup.id,
    status: topup.status,
    walletToken: wallet.walletToken,
    gatewayRef: chargeResult.gatewayRef,
  });
});

paymentsRouter.get("/wallet-balance/:walletToken", async (req, res) => {
  const walletToken = req.params.walletToken;
  const parsedUuid = z.string().uuid().safeParse(walletToken);
  if (!parsedUuid.success) return res.status(400).json({ error: "invalid_wallet_token" });

  const wallet = await getOrCreateWallet(db as any, walletToken);
  res.json({ walletToken: wallet.walletToken, coinBalance: wallet.coinBalance });
});

const linkSchema = z.object({ walletToken: z.string().uuid() }).strict();

paymentsRouter.post("/wallet/link", requireAuth(), async (req, res) => {
  const parsed = linkSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error" });

  const [wallet] = await db.select().from(wallets).where(eq(wallets.walletToken, parsed.data.walletToken));
  if (!wallet) return res.status(404).json({ error: "wallet_not_found" });
  if (wallet.userId && wallet.userId !== req.user!.id) {
    return res.status(409).json({ error: "wallet_already_linked" });
  }

  await db.update(wallets).set({ userId: req.user!.id }).where(eq(wallets.walletToken, parsed.data.walletToken));
  res.json({ ok: true, walletToken: wallet.walletToken });
});
