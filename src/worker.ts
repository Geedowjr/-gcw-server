import "dotenv/config";
import http from "http";
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

// Fly has no way to know this process is alive without a check to poll — the
// worker previously had zero health checks, so a stopped/never-started
// machine was silently accepted as "fine" and never auto-restarted. This
// listener exists purely for that check (see fly.toml's worker [[services]]
// block); it carries no traffic and does no request handling of its own.
const WORKER_HEALTH_PORT = 4001;
http
  .createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  })
  .listen(WORKER_HEALTH_PORT, () => {
    logger.info({ port: WORKER_HEALTH_PORT }, "worker health check listener started");
  });

const connection = createRedisClient({ forBullMQ: true });

// Each idle Worker long-polls Redis for new jobs and separately re-checks
// for stalled jobs on its own timer — with 6 workers, BullMQ's defaults
// (drainDelay: 5s, stalledInterval: 30s) add up to meaningful continuous
// Redis command volume even with zero real jobs to process. Relaxing both
// doesn't affect real job pickup: a genuinely new job wakes the blocking
// Redis call immediately regardless of drainDelay (it's the long-poll
// timeout for the empty-queue case, not a fixed scan interval) — this only
// slows down the idle re-check cadence, which is fine for jobs that are
// already hourly/nightly or triggered by real user actions, not sub-minute.
const WORKER_TUNING = { drainDelay: 30, stalledInterval: 60_000 };

const workers = [
  new Worker("payout", processPayoutJob, { connection, concurrency: 5, ...WORKER_TUNING }),
  new Worker("webhook-retry", processWebhookRetryJob, { connection, concurrency: 10, ...WORKER_TUNING }),
  new Worker("email", processEmailJob, { connection, concurrency: 10, ...WORKER_TUNING }),
  new Worker("reconcile", processReconcileJob, { connection, concurrency: 1, ...WORKER_TUNING }),
  new Worker("promote-pending", processPromotePendingJob, { connection, concurrency: 1, ...WORKER_TUNING }),
  new Worker("fx-snapshot", processFxSnapshotJob, { connection, concurrency: 1, ...WORKER_TUNING }),
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
