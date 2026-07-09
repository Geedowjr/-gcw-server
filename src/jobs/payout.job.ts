import type { Job } from "bullmq";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { cashouts } from "../db/schema.js";
import { getGateway } from "../gateways/index.js";
import { refundPayoutBalance } from "../ledger/creator.js";
import { logger } from "../logger.js";
import { captureException } from "../sentry.js";
import { queues } from "./queues.js";

export async function processPayoutJob(job: Job<{ cashoutId: string }>) {
  const [cashout] = await db.select().from(cashouts).where(eq(cashouts.id, job.data.cashoutId));
  if (!cashout) {
    logger.warn({ cashoutId: job.data.cashoutId }, "payout job: cashout not found");
    return;
  }
  if (cashout.status === "paid") return; // already done — idempotent no-op

  await db.update(cashouts).set({ status: "processing" }).where(eq(cashouts.id, cashout.id));

  const gateway = getGateway(cashout.destinationType);

  try {
    const result = await gateway.payout({
      amountCents: cashout.localAmountCents ?? cashout.amountCents,
      currency: cashout.currency,
      destinationAccount: cashout.destinationAccount,
      idempotencyKey: cashout.idempotencyKey ?? cashout.id,
    });

    if (result.status === "paid") {
      await db
        .update(cashouts)
        .set({ status: "paid", paidAt: new Date(), gatewayRef: result.gatewayRef })
        .where(eq(cashouts.id, cashout.id));

      await queues.email.add("cashout-paid", { cashoutId: cashout.id, creatorId: cashout.creatorId });
      await notifyCashoutStatus(cashout.creatorId, cashout.id, "paid");
    } else {
      await db
        .update(cashouts)
        .set({ status: result.status, gatewayRef: result.gatewayRef })
        .where(eq(cashouts.id, cashout.id));
      await notifyCashoutStatus(cashout.creatorId, cashout.id, result.status);
    }
  } catch (err) {
    logger.error({ err, cashoutId: cashout.id }, "payout failed");
    captureException(err, { cashoutId: cashout.id });

    const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    if (isFinalAttempt) {
      await db.transaction(async (tx) => {
        await refundPayoutBalance(tx as any, {
          userId: cashout.creatorId,
          amountCents: cashout.amountCents,
          reason: "cashout_failed_refund",
          refType: "cashout",
          refId: cashout.id,
        });
        await tx
          .update(cashouts)
          .set({ status: "failed", failureReason: String(err) })
          .where(eq(cashouts.id, cashout.id));
      });
      await notifyCashoutStatus(cashout.creatorId, cashout.id, "failed");
    } else {
      throw err; // let BullMQ retry with exponential backoff
    }
  }
}

async function notifyCashoutStatus(creatorId: string, cashoutId: string, status: string) {
  // emitCashoutStatus() no-ops safely if Socket.io hasn't been initialized in
  // this process (the worker runs standalone, without its own socket server —
  // it relies on the API node(s) being connected via the same Redis adapter
  // for any sockets it does emit through).
  const { emitCashoutStatus } = await import("../sockets/emitters.js");
  emitCashoutStatus(creatorId, { cashoutId, status });
}
