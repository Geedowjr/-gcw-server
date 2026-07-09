import Redis from "ioredis";
import { env } from "./env.js";

// Separate connections: BullMQ requires maxRetriesPerRequest=null on its connections,
// and Socket.io adapter / rate-limiter want their own dedicated connections.
export function createRedisClient(opts: { forBullMQ?: boolean } = {}) {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: opts.forBullMQ ? null : 20,
    enableReadyCheck: true,
  });
}

export const redis = createRedisClient();
