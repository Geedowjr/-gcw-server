import { db } from "../db/client.js";
import { topups } from "../db/schema.js";
import { creditWallet } from "../ledger/wallet.js";
import type { ChargeResult } from "../gateways/types.js";

/** Shared by every code path that turns a gateway ChargeResult into a topup
 * row + wallet credit (buy-coins, cards/confirm, and saved-card reuse). */
export async function recordTopupResult(
  wallet: { walletToken: string },
  params: {
    method: string;
    amountCents: number;
    currency: string;
    coins: number;
    idempotencyKey: string;
    chargeResult: ChargeResult;
  }
) {
  const [topup] = await db
    .insert(topups)
    .values({
      walletToken: wallet.walletToken,
      method: params.method,
      amountCents: params.amountCents,
      currency: params.currency,
      coins: params.coins,
      status: params.chargeResult.status === "succeeded" ? "succeeded" : "pending",
      gatewayRef: params.chargeResult.gatewayRef,
      idempotencyKey: params.idempotencyKey,
    })
    .returning();

  if (params.chargeResult.status === "succeeded") {
    await db.transaction(async (tx) => {
      await creditWallet(tx as any, {
        walletToken: wallet.walletToken,
        deltaCoins: params.coins,
        reason: "topup",
        refType: "topup",
        refId: topup.id,
      });
    });
  }

  return topup;
}
