import Redis from "ioredis";
import { env } from "./env.js";
import { logger } from "./logger.js";

// Separate connections: BullMQ requires maxRetriesPerRequest=null on its connections,
// and Socket.io adapter / rate-limiter want their own dedicated connections.
export function createRedisClient(opts: { forBullMQ?: boolean } = {}) {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: opts.forBullMQ ? null : 20,
    enableReadyCheck: true,
  });

  // ioredis emits "error" for every connection/command failure (bad
  // credentials, network blips, provider-side quota limits, etc.). Node
  // crashes the entire process on an unhandled EventEmitter "error" with no
  // listener — so without this, any transient Redis issue anywhere takes
  // down the whole API or worker, not just the one Redis-dependent request.
  client.on("error", (err) => {
    logger.error({ err }, "redis client error");
  });

  return client;
}

export const redis = createRedisClient();
