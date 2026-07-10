import { Router } from "express";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { wallets, savedPaymentMethods } from "../db/schema.js";
import { optionalAuth } from "../auth/middleware.js";
import { idempotency } from "../idempotency.js";
import { getOrCreateWallet } from "../ledger/wallet.js";
import {
  getOrCreateStripeCustomer,
  createSetupIntentForCustomer,
  verifySetupIntent,
  chargeWithPaymentMethod,
  SetupIntentVerificationError,
} from "../gateways/stripe-cards.js";
import { recordTopupResult } from "../payments/topup.js";
import { logger } from "../logger.js";
import { captureException } from "../sentry.js";

export const cardsRouter = Router();

// Single fixed top-up package, matching the frontend's only offering today.
// Hardcoded server-side (not client-supplied) — see buy-coins for the same pattern.
const FIXED_PACKAGE = { amountCents: 1000, currency: "USD", coins: 1000 };

const setupIntentSchema = z.object({ walletToken: z.string().uuid() }).strict();

cardsRouter.post("/setup-intent", optionalAuth(), idempotency(), async (req, res) => {
  const parsed = setupIntentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
  const idempotencyKey = req.header("Idempotency-Key")!;

  const wallet = await getOrCreateWallet(db as any, parsed.data.walletToken, req.user?.id);

  try {
    const customerId = await getOrCreateStripeCustomer(wallet, idempotencyKey);
    const { clientSecret } = await createSetupIntentForCustomer(customerId, idempotencyKey);
    res.status(201).json({ clientSecret, walletToken: wallet.walletToken });
  } catch (err) {
    logger.error({ err, walletToken: wallet.walletToken }, "stripe setup-intent failed");
    captureException(err, { route: "/api/payments/cards/setup-intent" });
    res.status(502).json({ error: "gateway_error", message: "Payment gateway is unavailable. Try again shortly." });
  }
});

const confirmSchema = z
  .object({
    walletToken: z.string().uuid(),
    setupIntentId: z.string().min(1),
    saveCard: z.boolean(),
  })
  .strict();

cardsRouter.post("/confirm", optionalAuth(), idempotency(), async (req, res) => {
  const parsed = confirmSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
  const { walletToken, setupIntentId, saveCard } = parsed.data;
  const idempotencyKey = req.header("Idempotency-Key")!;

  const [wallet] = await db.select().from(wallets).where(eq(wallets.walletToken, walletToken));
  if (!wallet) return res.status(404).json({ error: "wallet_not_found" });
  if (!wallet.stripeCustomerId) return res.status(404).json({ error: "no_setup_intent_for_wallet" });

  let cardInfo;
  try {
    cardInfo = await verifySetupIntent(setupIntentId, wallet.stripeCustomerId);
  } catch (err) {
    if (err instanceof SetupIntentVerificationError) {
      const status = err.code === "setup_intent_wallet_mismatch" ? 403 : 409;
      return res.status(status).json({ error: err.code, message: err.message });
    }
    logger.error({ err, walletToken }, "stripe setup-intent verification failed");
    captureException(err, { route: "/api/payments/cards/confirm" });
    return res.status(502).json({ error: "gateway_error", message: "Payment gateway is unavailable. Try again shortly." });
  }

  let savedPaymentMethodId: string | undefined;
  if (saveCard) {
    await db.transaction(async (tx) => {
      await tx
        .update(savedPaymentMethods)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(and(eq(savedPaymentMethods.walletToken, walletToken), eq(savedPaymentMethods.isDefault, true)));

      const [row] = await tx
        .insert(savedPaymentMethods)
        .values({
          walletToken,
          stripeCustomerId: wallet.stripeCustomerId!,
          stripePaymentMethodId: cardInfo.paymentMethodId,
          brand: cardInfo.brand,
          last4: cardInfo.last4,
          expMonth: cardInfo.expMonth,
          expYear: cardInfo.expYear,
          isDefault: true,
          status: "active",
        })
        .onConflictDoUpdate({
          target: savedPaymentMethods.stripePaymentMethodId,
          set: {
            brand: cardInfo.brand,
            last4: cardInfo.last4,
            expMonth: cardInfo.expMonth,
            expYear: cardInfo.expYear,
            isDefault: true,
            status: "active",
            updatedAt: new Date(),
          },
        })
        .returning();
      savedPaymentMethodId = row.id;
    });
  }

  let chargeResult;
  try {
    chargeResult = await chargeWithPaymentMethod({
      customerId: wallet.stripeCustomerId,
      paymentMethodId: cardInfo.paymentMethodId,
      amountCents: FIXED_PACKAGE.amountCents,
      currency: FIXED_PACKAGE.currency,
      idempotencyKey,
      offSession: false,
      metadata: { walletToken },
    });
  } catch (err) {
    logger.error({ err, walletToken }, "stripe charge failed");
    captureException(err, { route: "/api/payments/cards/confirm" });
    return res.status(502).json({ error: "gateway_error", message: "Payment gateway is unavailable. Try again shortly." });
  }

  const topup = await recordTopupResult(wallet, {
    method: "stripe",
    amountCents: FIXED_PACKAGE.amountCents,
    currency: FIXED_PACKAGE.currency,
    coins: FIXED_PACKAGE.coins,
    idempotencyKey,
    chargeResult,
  });

  res.status(201).json({
    topupId: topup.id,
    status: topup.status,
    walletToken: wallet.walletToken,
    gatewayRef: chargeResult.gatewayRef,
    savedPaymentMethodId,
  });
});

cardsRouter.get("/:walletToken", async (req, res) => {
  const parsedUuid = z.string().uuid().safeParse(req.params.walletToken);
  if (!parsedUuid.success) return res.status(400).json({ error: "invalid_wallet_token" });

  const [row] = await db
    .select()
    .from(savedPaymentMethods)
    .where(
      and(
        eq(savedPaymentMethods.walletToken, parsedUuid.data),
        eq(savedPaymentMethods.isDefault, true),
        eq(savedPaymentMethods.status, "active")
      )
    );

  res.json({
    walletToken: parsedUuid.data,
    hasSavedCard: !!row,
    card: row ? { brand: row.brand, last4: row.last4, expMonth: row.expMonth, expYear: row.expYear } : null,
  });
});
