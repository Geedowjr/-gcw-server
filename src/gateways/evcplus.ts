import crypto from "crypto";
import { env } from "../env.js";
import type { PaymentGateway, ChargeRequest, ChargeResult, PayoutRequest, PayoutResult } from "./types.js";
import { timingSafeEqualHex } from "./mpesa.js";

/**
 * EVC Plus (Somtel/Hormuud, Somalia mobile money) charges route through
 * WaafiPay (waafipay.net), a third-party payment aggregator — EVC Plus has
 * no direct merchant API of its own. Built against WaafiPay's official
 * public docs (docs.waafipay.com) as of 2026-07, cross-checked against a
 * community reference implementation. Two things remain genuinely
 * unverified until real sandbox credentials exist (see comments below):
 * the exact `timestamp` string format, and `paymentMethod` casing.
 *
 * IMPORTANT — payouts are NOT implemented here because WaafiPay's public API
 * has no disbursement/transfer/payout operation at all (confirmed against
 * their full documented service list: API_PURCHASE, API_CANCELPURCHASE,
 * API_PREAUTHORIZE, API_PREAUTHORIZE_COMMIT, API_PREAUTHORIZE_CANCEL — all
 * customer-collection-only). Sending money to a creator's EVC Plus wallet
 * would need a separate business arrangement with Hormuud/WaafiPay, not
 * something buildable against their public API surface. payout() stays
 * stubbed until that changes.
 */

const WAAFIPAY_SANDBOX_URL = "https://sandbox.waafipay.com/asm";
const WAAFIPAY_PRODUCTION_URL = "https://api.waafipay.net/asm";

interface WaafiPayPurchaseResponse {
  schemaVersion?: string;
  timestamp?: string;
  responseId?: string;
  responseCode?: string;
  errorCode?: string;
  responseMsg?: string;
  params?: {
    accountNo?: string;
    accountType?: string;
    state?: string;
    merchantCharges?: string;
    referenceId?: string;
    transactionId?: string;
    issuerTransactionId?: string;
    txAmount?: string;
  };
}

async function callWaafiPay(serviceName: string, serviceParams: Record<string, unknown>, idempotencyKey: string) {
  const baseUrl = env.EVC_SANDBOX ? WAAFIPAY_SANDBOX_URL : WAAFIPAY_PRODUCTION_URL;

  const body = {
    schemaVersion: "1.0",
    requestId: idempotencyKey,
    // Docs specify "string (20 chars)" without an example format — using a
    // full ISO-8601 timestamp as the most standard interpretation. Verify
    // against the real sandbox response once credentials exist; if WaafiPay
    // rejects this, it likely wants a fixed-width numeric format instead
    // (e.g. yyyyMMddHHmmssffff).
    timestamp: new Date().toISOString(),
    channelName: "WEB",
    serviceName,
    serviceParams: {
      merchantUid: env.EVC_MERCHANT_ID,
      apiUserId: env.EVC_API_USER_ID,
      apiKey: env.EVC_API_KEY,
      ...serviceParams,
    },
  };

  const res = await fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`waafipay_http_${res.status}`);
  }

  return (await res.json()) as WaafiPayPurchaseResponse;
}

function formatSomaliPhone(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.startsWith("252")) return digits;
  return `252${digits.replace(/^0+/, "")}`;
}

export const evcPlusGateway: PaymentGateway = {
  name: "evcplus",

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    if (!env.EVC_API_KEY || !env.EVC_API_USER_ID || !env.EVC_MERCHANT_ID) {
      // Dev stub — no real WaafiPay credentials configured. "pending", not
      // "succeeded": matches the other gateways so an unconfigured
      // integration can never directly credit a wallet.
      return { gatewayRef: `evc_stub_${crypto.randomUUID()}`, status: "pending" };
    }
    if (!req.destinationAccount) {
      throw new Error("evcplus_destination_account_required");
    }

    const data = await callWaafiPay(
      "API_PURCHASE",
      {
        paymentMethod: "MWALLET_ACCOUNT",
        payerInfo: { accountNo: formatSomaliPhone(req.destinationAccount) },
        transactionInfo: {
          referenceId: req.idempotencyKey,
          invoiceId: req.idempotencyKey,
          amount: (req.amountCents / 100).toFixed(2),
          currency: req.currency.toUpperCase(),
          description: req.metadata?.description ?? "GiftStream top-up",
        },
      },
      req.idempotencyKey
    );

    // API_PURCHASE is documented as a one-step, immediate-debit operation —
    // unlike Stripe's async PaymentIntent flow, this response is the final
    // word, so a non-success result is "failed", not "pending".
    const succeeded = data.errorCode === "0" && data.responseMsg === "RCS_SUCCESS";
    return {
      gatewayRef: data.params?.transactionId ?? data.responseId ?? crypto.randomUUID(),
      status: succeeded ? "succeeded" : "failed",
      raw: data,
    };
  },

  async payout(req: PayoutRequest): Promise<PayoutResult> {
    if (!env.EVC_API_KEY) {
      return { gatewayRef: `evc_payout_stub_${crypto.randomUUID()}`, status: "processing" };
    }
    // No real integration exists — see the file-level comment. This isn't a
    // "missing credentials" gap like charge() above; WaafiPay's public API
    // has no disbursement operation to call at all.
    throw new Error("evcplus_payout_not_available: WaafiPay's public API has no disbursement/payout operation");
  },

  verifyWebhookSignature(rawBody, headers) {
    // No configured secret — reject, don't trust an unsigned payload just
    // because live integration isn't wired up yet.
    if (!env.EVC_WEBHOOK_SECRET) return false;
    const sig = headers["x-webhook-signature"] as string | undefined;
    const timestamp = headers["x-webhook-timestamp"] as string | undefined;
    const eventId = headers["x-webhook-event-id"] as string | undefined;
    if (!sig || !timestamp || !eventId) return false;

    const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody;
    const signingString = `${timestamp}.${eventId}.${bodyStr}`;
    const expected = crypto.createHmac("sha256", env.EVC_WEBHOOK_SECRET).update(signingString).digest("hex");
    return timingSafeEqualHex(sig, expected);
  },

  extractExternalId(payload: any) {
    return (
      payload?.transaction_id ?? payload?.transactionId ?? payload?.reference_id ?? payload?.referenceId ?? crypto.randomUUID()
    );
  },
};
