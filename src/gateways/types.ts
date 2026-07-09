export interface ChargeRequest {
  amountCents: number;
  currency: string;
  destinationAccount?: string; // phone number for mobile money
  idempotencyKey: string;
  metadata?: Record<string, string>;
}

export interface ChargeResult {
  gatewayRef: string;
  status: "pending" | "succeeded" | "failed";
  raw?: unknown;
}

export interface PayoutRequest {
  amountCents: number;
  currency: string;
  destinationAccount: string;
  idempotencyKey: string;
  metadata?: Record<string, string>;
}

export interface PayoutResult {
  gatewayRef: string;
  status: "pending" | "processing" | "paid" | "failed";
  raw?: unknown;
}

export interface PaymentGateway {
  name: "stripe" | "mpesa" | "evcplus" | "edahab";
  charge(req: ChargeRequest): Promise<ChargeResult>;
  payout(req: PayoutRequest): Promise<PayoutResult>;
  verifyWebhookSignature(rawBody: Buffer | string, headers: Record<string, string | string[] | undefined>): boolean;
  extractExternalId(payload: any): string;
}
