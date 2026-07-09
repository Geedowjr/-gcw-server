import type { Job } from "bullmq";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { logger } from "../logger.js";
import { captureException } from "../sentry.js";

/**
 * Nightly job: SUM(ledger.delta) must equal the current balance for every
 * wallet and every creator profile. Any drift is a bug (or fraud) and pages
 * via Sentry immediately.
 */
export async function processReconcileJob(_job: Job) {
  const walletDrift = await db.execute(sql`
    SELECT w.wallet_token, w.coin_balance, COALESCE(SUM(wl.delta_coins), 0) AS ledger_sum
    FROM wallets w
    LEFT JOIN wallet_ledger wl ON wl.wallet_token = w.wallet_token
    GROUP BY w.wallet_token, w.coin_balance
    HAVING w.coin_balance <> COALESCE(SUM(wl.delta_coins), 0)
  `);

  const creatorDrift = await db.execute(sql`
    SELECT cp.user_id, cp.pending_balance_cents, cp.payout_balance_cents,
           COALESCE(SUM(cl.delta_cents), 0) AS ledger_sum
    FROM creator_profiles cp
    LEFT JOIN creator_ledger cl ON cl.user_id = cp.user_id
    GROUP BY cp.user_id, cp.pending_balance_cents, cp.payout_balance_cents
    HAVING (cp.pending_balance_cents + cp.payout_balance_cents) <> COALESCE(SUM(cl.delta_cents), 0)
  `);

  const walletRows = (walletDrift as any).rows ?? walletDrift;
  const creatorRows = (creatorDrift as any).rows ?? creatorDrift;

  if (walletRows.length > 0 || creatorRows.length > 0) {
    const err = new Error(
      `Ledger reconciliation drift detected: ${walletRows.length} wallet(s), ${creatorRows.length} creator(s)`
    );
    logger.error({ walletRows, creatorRows }, err.message);
    captureException(err, { walletRows, creatorRows });
  } else {
    logger.info("reconcile job: no drift detected");
  }

  return { walletDriftCount: walletRows.length, creatorDriftCount: creatorRows.length };
}
