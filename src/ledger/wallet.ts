import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { wallets, walletLedger } from "../db/schema.js";

/**
 * Every wallet balance mutation MUST go through this helper inside an active
 * transaction (`tx`), so the ledger row and balance update are atomic.
 */
export async function creditWallet(
  tx: Db,
  params: {
    walletToken: string;
    deltaCoins: number; // positive to credit, negative to debit
    reason: string;
    refType?: string;
    refId?: string;
  }
) {
  const [wallet] = await tx
    .update(wallets)
    .set({ coinBalance: sql`${wallets.coinBalance} + ${params.deltaCoins}` })
    .where(eq(wallets.walletToken, params.walletToken))
    .returning();

  if (!wallet) {
    throw new Error(`wallet ${params.walletToken} not found`);
  }
  if (wallet.coinBalance < 0) {
    throw new Error("insufficient_wallet_balance");
  }

  await tx.insert(walletLedger).values({
    walletToken: params.walletToken,
    deltaCoins: params.deltaCoins,
    reason: params.reason,
    refType: params.refType,
    refId: params.refId,
  });

  return wallet;
}

export async function getOrCreateWallet(tx: Db, walletToken: string | undefined, userId?: string) {
  if (walletToken) {
    const [existing] = await tx.select().from(wallets).where(eq(wallets.walletToken, walletToken));
    if (existing) return existing;
  }
  const [created] = await tx
    .insert(wallets)
    .values(walletToken ? { walletToken, userId } : { userId })
    .returning();
  return created;
}
