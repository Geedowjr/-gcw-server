import crypto from "crypto";
import { env } from "../env.js";
import { stripe } from "./stripeClient.js";
import type { PaymentGateway, ChargeRequest, ChargeResult, PayoutRequest, PayoutResult } from "./types.js";

export const stripeGateway: PaymentGateway = {
  name: "stripe",

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    if (!env.STRIPE_SECRET_KEY) {
      // Dev stub — no real Stripe credentials configured. "pending", not
      // "succeeded": matches the other gateways so an unconfigured key can
      // never directly credit a wallet — only a verified webhook or a real
      // confirmed charge can.
      return { gatewayRef: `stub_${crypto.randomUUID()}`, status: "pending" };
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
      // "processing", not "paid": matches the other gateways so an
      // unconfigured key can never mark a cashout paid (and notify the
      // creator as such) without money actually moving.
      return { gatewayRef: `stub_payout_${crypto.randomUUID()}`, status: "processing" };
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
    // No configured secret or missing signature — reject, don't trust an unsigned
    // payload just because a webhook secret hasn't been set up.
    if (!env.STRIPE_WEBHOOK_SECRET) return false;
    const sig = headers["stripe-signature"];
    if (!sig) return false;
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
