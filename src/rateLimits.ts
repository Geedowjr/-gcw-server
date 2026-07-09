import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { redis } from "./redis.js";

function store(prefix: string) {
  return new RedisStore({
    sendCommand: ((...args: string[]) => redis.call(...(args as [string, ...string[]]))) as any,
    prefix: `rl:${prefix}:`,
  });
}

export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  store: store("global"),
  keyGenerator: (req) => req.ip ?? "unknown",
});

export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: store("auth"),
  keyGenerator: (req) => req.ip ?? "unknown",
  message: { error: "too_many_requests" },
});

export const giftSendLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  store: store("gift-send"),
  keyGenerator: (req: any) => req.user?.id || req.body?.senderWalletToken || req.ip,
  message: { error: "too_many_requests" },
});

export const cashoutLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: store("cashout"),
  keyGenerator: (req: any) => req.user?.id || req.ip,
  message: { error: "too_many_requests" },
});
