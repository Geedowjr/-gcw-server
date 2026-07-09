import { Queue } from "bullmq";
import { createRedisClient } from "../redis.js";

const connection = createRedisClient({ forBullMQ: true });

const defaultJobOptions = {
  attempts: 5,
  backoff: { type: "exponential" as const, delay: 2000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 86400 },
};

export const queues = {
  payout: new Queue("payout", { connection, defaultJobOptions }),
  webhookRetry: new Queue("webhook-retry", { connection, defaultJobOptions }),
  email: new Queue("email", { connection, defaultJobOptions }),
  reconcile: new Queue("reconcile", { connection, defaultJobOptions: { removeOnComplete: true } }),
  promotePending: new Queue("promote-pending", { connection, defaultJobOptions: { removeOnComplete: true } }),
  fxSnapshot: new Queue("fx-snapshot", { connection, defaultJobOptions: { removeOnComplete: true } }),
};

export type Queues = typeof queues;
