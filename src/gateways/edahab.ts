import crypto from "crypto";
import { env } from "../env.js";
import type { PaymentGateway, ChargeRequest, ChargeResult, PayoutRequest, PayoutResult } from "./types.js";
import { timingSafeEqualHex } from "./mpesa.js";

/** Stub adapter for eDahab (Somaliland mobile money). */
export const eDahabGateway: PaymentGateway = {
  name: "edahab",

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    if (!env.EDAHAB_API_KEY) {
      return { gatewayRef: `edahab_stub_${crypto.randomUUID()}`, status: "pending" };
    }
    // TODO(real integration): POST to eDahab API with EDAHAB_MERCHANT_ID / EDAHAB_API_KEY.
    throw new Error("edahab live integration not configured");
  },

  async payout(req: PayoutRequest): Promise<PayoutResult> {
    if (!env.EDAHAB_API_KEY) {
      return { gatewayRef: `edahab_payout_stub_${crypto.randomUUID()}`, status: "processing" };
    }
    throw new Error("edahab live integration not configured");
  },

  verifyWebhookSignature(rawBody, headers) {
    const sig = headers["x-edahab-signature"] as string | undefined;
    if (!sig) return !env.EDAHAB_WEBHOOK_SECRET;
    const expected = crypto.createHmac("sha256", env.EDAHAB_WEBHOOK_SECRET).update(rawBody).digest("hex");
    return timingSafeEqualHex(sig, expected);
  },

  extractExternalId(payload: any) {
    return payload?.txnId ?? payload?.id ?? crypto.randomUUID();
  },
};
