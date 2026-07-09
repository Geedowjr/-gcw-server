import crypto from "crypto";
import { env } from "../env.js";
import type { PaymentGateway, ChargeRequest, ChargeResult, PayoutRequest, PayoutResult } from "./types.js";
import { timingSafeEqualHex } from "./mpesa.js";

/** Stub adapter for Somtel EVC Plus (Somalia mobile money). */
export const evcPlusGateway: PaymentGateway = {
  name: "evcplus",

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    if (!env.EVC_API_KEY) {
      return { gatewayRef: `evc_stub_${crypto.randomUUID()}`, status: "pending" };
    }
    // TODO(real integration): POST to EVC Plus merchant API with EVC_MERCHANT_ID / EVC_API_KEY.
    throw new Error("evcplus live integration not configured");
  },

  async payout(req: PayoutRequest): Promise<PayoutResult> {
    if (!env.EVC_API_KEY) {
      return { gatewayRef: `evc_payout_stub_${crypto.randomUUID()}`, status: "processing" };
    }
    throw new Error("evcplus live integration not configured");
  },

  verifyWebhookSignature(rawBody, headers) {
    const sig = headers["x-evc-signature"] as string | undefined;
    if (!sig) return !env.EVC_WEBHOOK_SECRET;
    const expected = crypto.createHmac("sha256", env.EVC_WEBHOOK_SECRET).update(rawBody).digest("hex");
    return timingSafeEqualHex(sig, expected);
  },

  extractExternalId(payload: any) {
    return payload?.transactionId ?? payload?.referenceId ?? crypto.randomUUID();
  },
};
