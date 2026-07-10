import crypto from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { wallets } from "../db/schema.js";
import { env } from "../env.js";
import { stripe } from "./stripeClient.js";
import type { ChargeResult } from "./types.js";

export interface SavedCardInfo {
  paymentMethodId: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
}

/** Stripe-only helpers for SetupIntent-based card save/reuse. Not part of the
 * gateway-agnostic PaymentGateway interface — mpesa/evcplus/edahab have no
 * equivalent concept. */

export async function getOrCreateStripeCustomer(
  wallet: typeof wallets.$inferSelect,
  idempotencyKey: string
): Promise<string> {
  if (wallet.stripeCustomerId) return wallet.stripeCustomerId;

  const customerId = !env.STRIPE_SECRET_KEY
    ? `stub_cus_${crypto.randomUUID()}`
    : (
        await stripe.customers.create(
          { metadata: { walletToken: wallet.walletToken } },
          { idempotencyKey: `cust_${idempotencyKey}` }
        )
      ).id;

  // Atomic compare-and-set: two concurrent calls for the same wallet (e.g. an
  // effect double-invoke, two tabs) can each create a Stripe customer here.
  // Only the request that wins this WHERE-guarded update actually persists
  // its customer; the loser discards its speculative one and reuses the
  // winner's, so every SetupIntent for this wallet ends up on one customer.
  const [updated] = await db
    .update(wallets)
    .set({ stripeCustomerId: customerId })
    .where(and(eq(wallets.walletToken, wallet.walletToken), isNull(wallets.stripeCustomerId)))
    .returning();
  if (updated) return customerId;

  const [current] = await db.select().from(wallets).where(eq(wallets.walletToken, wallet.walletToken));
  return current!.stripeCustomerId!;
}

export async function createSetupIntentForCustomer(
  customerId: string,
  idempotencyKey: string
): Promise<{ clientSecret: string }> {
  if (!env.STRIPE_SECRET_KEY) {
    return { clientSecret: `stub_seti_${crypto.randomUUID()}_secret_stub` };
  }
  const intent = await stripe.setupIntents.create(
    { customer: customerId, usage: "off_session" },
    { idempotencyKey: `seti_${idempotencyKey}` }
  );
  if (!intent.client_secret) throw new Error("setup_intent_missing_client_secret");
  return { clientSecret: intent.client_secret };
}

export class SetupIntentVerificationError extends Error {
  code: "setup_intent_not_succeeded" | "setup_intent_wallet_mismatch";
  constructor(code: "setup_intent_not_succeeded" | "setup_intent_wallet_mismatch", message: string) {
    super(message);
    this.code = code;
  }
}

/** Retrieves the SetupIntent from Stripe (never trusts client-supplied card
 * metadata) and confirms it belongs to this wallet's customer and succeeded. */
export async function verifySetupIntent(setupIntentId: string, expectedCustomerId: string): Promise<SavedCardInfo> {
  const intent = await stripe.setupIntents.retrieve(setupIntentId, { expand: ["payment_method"] });

  const intentCustomerId = typeof intent.customer === "string" ? intent.customer : intent.customer?.id;
  if (intentCustomerId !== expectedCustomerId) {
    throw new SetupIntentVerificationError("setup_intent_wallet_mismatch", "SetupIntent does not belong to this wallet.");
  }
  if (intent.status !== "succeeded") {
    throw new SetupIntentVerificationError("setup_intent_not_succeeded", `SetupIntent status is ${intent.status}.`);
  }

  const pm = intent.payment_method;
  if (!pm || typeof pm === "string") {
    throw new SetupIntentVerificationError("setup_intent_not_succeeded", "SetupIntent has no confirmed payment method.");
  }

  const card = pm.card;
  return {
    paymentMethodId: pm.id,
    brand: card?.brand ?? null,
    last4: card?.last4 ?? null,
    expMonth: card?.exp_month ?? null,
    expYear: card?.exp_year ?? null,
  };
}

/** Off-session reuse of a saved card was declined because the card issuer
 * requires fresh authentication (e.g. 3DS) — the frontend should prompt the
 * viewer to re-add the card rather than blindly retrying. */
export class OffSessionAuthRequiredError extends Error {}

export async function chargeWithPaymentMethod(params: {
  customerId: string;
  paymentMethodId: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
  offSession: boolean;
  metadata?: Record<string, string>;
}): Promise<ChargeResult> {
  if (!env.STRIPE_SECRET_KEY) {
    return { gatewayRef: `stub_pi_${crypto.randomUUID()}`, status: "succeeded" };
  }
  try {
    const intent = await stripe.paymentIntents.create(
      {
        amount: params.amountCents,
        currency: params.currency.toLowerCase(),
        customer: params.customerId,
        payment_method: params.paymentMethodId,
        payment_method_types: ["card"], // card-only checkout — avoids needing a return_url for redirect-based methods
        off_session: params.offSession,
        confirm: true,
        metadata: params.metadata,
      },
      { idempotencyKey: params.idempotencyKey }
    );
    return {
      gatewayRef: intent.id,
      status: intent.status === "succeeded" ? "succeeded" : "pending",
      raw: intent,
    };
  } catch (err: any) {
    if (params.offSession && err?.code === "authentication_required") {
      throw new OffSessionAuthRequiredError("Saved card requires re-authentication.");
    }
    throw err;
  }
}
