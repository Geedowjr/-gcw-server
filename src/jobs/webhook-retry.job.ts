import type { Job } from "bullmq";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { webhookEvents, topups, cashouts } from "../db/schema.js";
import { creditWallet } from "../ledger/wallet.js";
import { logger } from "../logger.js";
import { captureException } from "../sentry.js";

/**
 * Processes (or re-processes) a webhook_events row: reconciles the referenced
 * topup/cashout with the gateway's reported status.
 */
export async function processWebhookRetryJob(job: Job<{ webhookEventId: string }>) {
  const [event] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, job.data.webhookEventId));
  if (!event) return;
  if (event.processedAt) return; // already handled — idempotent no-op

  try {
    const payload: any = event.payload;

    if (event.source === "stripe" || event.source === "mpesa" || event.source === "evcplus" || event.source === "edahab") {
      const gatewayRef = payload?.data?.object?.id ?? payload?.gatewayRef ?? event.externalId;
      const [topup] = await db.select().from(topups).where(eq(topups.gatewayRef, gatewayRef));

      if (topup && topup.status !== "succeeded") {
        await db.transaction(async (tx) => {
          await tx.update(topups).set({ status: "succeeded" }).where(eq(topups.id, topup.id));
          await creditWallet(tx as any, {
            walletToken: topup.walletToken,
            deltaCoins: topup.coins,
            reason: "topup_webhook_confirmed",
            refType: "topup",
            refId: topup.id,
          });
        });
      }

      const [cashout] = await db.select().from(cashouts).where(eq(cashouts.gatewayRef, gatewayRef));
      if (cashout && cashout.status !== "paid") {
        await db.update(cashouts).set({ status: "paid", paidAt: new Date() }).where(eq(cashouts.id, cashout.id));
      }
    }

    await db
      .update(webhookEvents)
      .set({ processedAt: new Date(), attempts: event.attempts + 1 })
      .where(eq(webhookEvents.id, event.id));
  } catch (err) {
    logger.error({ err, webhookEventId: event.id }, "webhook processing failed");
    captureException(err, { webhookEventId: event.id });
    await db
      .update(webhookEvents)
      .set({ attempts: event.attempts + 1 })
      .where(eq(webhookEvents.id, event.id));
    throw err; // let BullMQ retry
  }
}
