import "dotenv/config";
import { Worker } from "bullmq";
import { createRedisClient } from "./redis.js";
import { logger } from "./logger.js";
import { initSentry, captureException } from "./sentry.js";
import { processPayoutJob } from "./jobs/payout.job.js";
import { processWebhookRetryJob } from "./jobs/webhook-retry.job.js";
import { processEmailJob } from "./jobs/email.job.js";
import { processReconcileJob } from "./jobs/reconcile.job.js";
import { processPromotePendingJob } from "./jobs/promote-pending.job.js";
import { processFxSnapshotJob } from "./jobs/fx-snapshot.job.js";
import { queues } from "./jobs/queues.js";

initSentry();

const connection = createRedisClient({ forBullMQ: true });

const workers = [
  new Worker("payout", processPayoutJob, { connection, concurrency: 5 }),
  new Worker("webhook-retry", processWebhookRetryJob, { connection, concurrency: 10 }),
  new Worker("email", processEmailJob, { connection, concurrency: 10 }),
  new Worker("reconcile", processReconcileJob, { connection, concurrency: 1 }),
  new Worker("promote-pending", processPromotePendingJob, { connection, concurrency: 1 }),
  new Worker("fx-snapshot", processFxSnapshotJob, { connection, concurrency: 1 }),
];

for (const worker of workers) {
  worker.on("completed", (job) => logger.debug({ queue: worker.name, jobId: job.id }, "job completed"));
  worker.on("failed", (job, err) => {
    logger.error({ queue: worker.name, jobId: job?.id, err }, "job failed");
    captureException(err, { queue: worker.name, jobId: job?.id });
  });
}

async function scheduleRecurringJobs() {
  // Nightly ledger reconciliation at 02:00 UTC.
  await queues.reconcile.add("nightly-reconcile", {}, { repeat: { pattern: "0 2 * * *" }, jobId: "reconcile-cron" });
  // Hourly: promote matured pending earnings.
  await queues.promotePending.add(
    "hourly-promote",
    {},
    { repeat: { pattern: "0 * * * *" }, jobId: "promote-pending-cron" }
  );
  // Hourly: refresh FX snapshots.
  await queues.fxSnapshot.add("hourly-fx", {}, { repeat: { pattern: "5 * * * *" }, jobId: "fx-snapshot-cron" });
}

scheduleRecurringJobs()
  .then(() => logger.info("worker: recurring jobs scheduled"))
  .catch((err) => logger.error({ err }, "failed to schedule recurring jobs"));

logger.info("worker process started");

process.on("SIGTERM", async () => {
  logger.info("worker: shutting down");
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
});
