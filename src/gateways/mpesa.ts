import crypto from "crypto";
import { env } from "../env.js";
import type { PaymentGateway, ChargeRequest, ChargeResult, PayoutRequest, PayoutResult } from "./types.js";

/**
 * Stub adapter for Safaricom M-Pesa Daraja API (STK Push for charges, B2C for payouts).
 * Swap the stubbed calls below for real Daraja HTTP calls once MPESA_* creds are set
 * — see README "Swapping stub gateways for real creds".
 */
export const mpesaGateway: PaymentGateway = {
  name: "mpesa",

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    if (!env.MPESA_CONSUMER_KEY) {
      return { gatewayRef: `mpesa_stub_${crypto.randomUUID()}`, status: "pending" };
    }
    // TODO(real integration): OAuth -> POST /mpesa/stkpush/v1/processrequest
    // using MPESA_SHORTCODE + MPESA_PASSKEY + req.destinationAccount (MSISDN).
    throw new Error("mpesa live integration not configured");
  },

  async payout(req: PayoutRequest): Promise<PayoutResult> {
    if (!env.MPESA_CONSUMER_KEY) {
      return { gatewayRef: `mpesa_payout_stub_${crypto.randomUUID()}`, status: "processing" };
    }
    // TODO(real integration): OAuth -> POST /mpesa/b2c/v1/paymentrequest
    throw new Error("mpesa live integration not configured");
  },

  verifyWebhookSignature(rawBody, headers) {
    // Daraja callbacks are IP-allowlisted + optionally HMAC-signed depending on setup.
    // No configured secret, or no signature to check it against, means we can't verify
    // this payload — reject rather than trust it just because live integration isn't
    // wired up yet (an unsigned webhook here shouldn't be able to credit a wallet).
    if (!env.MPESA_PASSKEY) return false;
    const sig = headers["x-mpesa-signature"] as string | undefined;
    if (!sig) return false;
    const expected = crypto.createHmac("sha256", env.MPESA_PASSKEY).update(rawBody).digest("hex");
    return timingSafeEqualHex(sig, expected);
  },

  extractExternalId(payload: any) {
    return payload?.Body?.stkCallback?.CheckoutRequestID ?? payload?.TransactionID ?? crypto.randomUUID();
  },
};

export function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
