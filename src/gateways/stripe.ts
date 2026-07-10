import crypto from "crypto";
import { env } from "../env.js";
import { stripe } from "./stripeClient.js";
import type { PaymentGateway, ChargeRequest, ChargeResult, PayoutRequest, PayoutResult } from "./types.js";

export const stripeGateway: PaymentGateway = {
  name: "stripe",

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    if (!env.STRIPE_SECRET_KEY) {
      // Dev stub — no real Stripe credentials configured.
      return { gatewayRef: `stub_${crypto.randomUUID()}`, status: "succeeded" };
    }
    const intent = await stripe.paymentIntents.create(
      {
        amount: req.amountCents,
        currency: req.currency.toLowerCase(),
        metadata: req.metadata,
        confirm: false,
      },
      { idempotencyKey: req.idempotencyKey }
    );
    return {
      gatewayRef: intent.id,
      status: intent.status === "succeeded" ? "succeeded" : "pending",
      raw: intent,
    };
  },

  async payout(req: PayoutRequest): Promise<PayoutResult> {
    if (!env.STRIPE_SECRET_KEY) {
      return { gatewayRef: `stub_payout_${crypto.randomUUID()}`, status: "paid" };
    }
    // In production: Stripe Connect transfer to a connected account (req.destinationAccount).
    const transfer = await stripe.transfers.create(
      {
        amount: req.amountCents,
        currency: req.currency.toLowerCase(),
        destination: req.destinationAccount,
        metadata: req.metadata,
      },
      { idempotencyKey: req.idempotencyKey }
    );
    return { gatewayRef: transfer.id, status: "paid", raw: transfer };
  },

  verifyWebhookSignature(rawBody, headers) {
    const sig = headers["stripe-signature"];
    if (!sig || !env.STRIPE_WEBHOOK_SECRET) return !env.STRIPE_WEBHOOK_SECRET; // allow-through in dev stub mode
    try {
      stripe.webhooks.constructEvent(rawBody, sig as string, env.STRIPE_WEBHOOK_SECRET);
      return true;
    } catch {
      return false;
    }
  },

  extractExternalId(payload: any) {
    return payload?.id ?? payload?.data?.object?.id ?? crypto.randomUUID();
  },
};
