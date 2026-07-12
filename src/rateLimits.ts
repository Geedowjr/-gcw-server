import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { redis } from "./redis.js";

function store(prefix: string) {
  return new RedisStore({
    sendCommand: ((...args: string[]) => redis.call(...(args as [string, ...string[]]))) as any,
    prefix: `rl:${prefix}:`,
  });
}

// A rate limiter is a defense-in-depth safety net, not something that
// should itself be able to take the whole API down — but with
// passOnStoreError left at its default (false), a Redis-side failure (an
// outage, or the exhausted-quota incident that prompted this) made every
// request through globalLimiter fail closed with a 500, including /healthz,
// which made the entire app look down even though nothing else was broken.
// Fail open instead: if the store errors, let the request through.
const RATE_LIMIT_DEFAULTS = {
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
} as const;

export const globalLimiter = rateLimit({
  ...RATE_LIMIT_DEFAULTS,
  windowMs: 60 * 1000,
  limit: 300,
  store: store("global"),
  keyGenerator: (req) => req.ip ?? "unknown",
});

export const authLimiter = rateLimit({
  ...RATE_LIMIT_DEFAULTS,
  windowMs: 60 * 1000,
  limit: 5,
  store: store("auth"),
  keyGenerator: (req) => req.ip ?? "unknown",
  message: { error: "too_many_requests" },
});

export const giftSendLimiter = rateLimit({
  ...RATE_LIMIT_DEFAULTS,
  windowMs: 60 * 1000,
  limit: 30,
  store: store("gift-send"),
  keyGenerator: (req: any) => req.user?.id || req.body?.senderWalletToken || req.ip,
  message: { error: "too_many_requests" },
});

export const cashoutLimiter = rateLimit({
  ...RATE_LIMIT_DEFAULTS,
  windowMs: 60 * 60 * 1000,
  limit: 5,
  store: store("cashout"),
  keyGenerator: (req: any) => req.user?.id || req.ip,
  message: { error: "too_many_requests" },
});
