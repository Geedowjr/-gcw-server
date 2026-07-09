import type { Job } from "bullmq";
import { lte, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { creatorLedger } from "../db/schema.js";
import { promoteMaturedEarnings } from "../ledger/creator.js";
import { logger } from "../logger.js";

/**
 * Hourly: finds creator_ledger rows whose hold window has matured
 * (available_at <= now) and haven't been promoted yet, then moves that amount
 * from pending_balance_cents to payout_balance_cents.
 *
 * We track "already promoted" via a companion ledger row with
 * reason='promotion_marker' referencing the original row, so this job is
 * safe to run repeatedly without double-promoting.
 */
export async function processPromotePendingJob(_job: Job) {
  const matured = await db.execute(sql`
    SELECT cl.user_id, cl.id, cl.delta_cents
    FROM creator_ledger cl
    WHERE cl.reason = 'gift_earnings'
      AND cl.available_at IS NOT NULL
      AND cl.available_at <= now()
      AND NOT EXISTS (
        SELECT 1 FROM creator_ledger m
        WHERE m.ref_type = 'promotion' AND m.ref_id::text = cl.id::text
      )
  `);

  const rows = (matured as any).rows ?? matured;
  let promotedCount = 0;

  for (const row of rows) {
    if (row.delta_cents <= 0) continue;
    await db.transaction(async (tx) => {
      await promoteMaturedEarnings(tx as any, row.user_id, row.delta_cents);
      await tx.insert(creatorLedger).values({
        userId: row.user_id,
        deltaCents: 0,
        reason: "promotion_marker",
        refType: "promotion",
        refId: row.id,
      });
    });
    promotedCount++;
  }

  logger.info({ promotedCount }, "promote-pending job complete");
  return { promotedCount };
}
