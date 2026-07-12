import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { redis } from "./redis.js";
import { logger } from "./logger.js";
import { captureException } from "./sentry.js";

const TTL_SECONDS = 24 * 60 * 60;

/**
 * Enforces the Idempotency-Key header on money-moving POSTs.
 * - Missing header -> 400.
 * - First time seen: request proceeds; response is captured & cached for 24h.
 * - Key seen again (same user+endpoint): cached response is replayed verbatim,
 *   the underlying handler never runs again.
 * - Key seen again while the FIRST request is still in-flight: 409 Conflict
 *   (prevents double-processing under concurrent duplicate requests).
 * - Redis itself unavailable -> 503, not a generic 500. Deliberately fails
 *   closed (rejects) rather than skipping the dedup check: unlike the rate
 *   limiter, this guards against actually double-charging a card or
 *   double-crediting a wallet, so silently proceeding without it isn't safe.
 */
export function idempotency() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = req.header("Idempotency-Key");
    if (!key) {
      return res.status(400).json({ error: "idempotency_key_required" });
    }

    const userId = (req as any).user?.id ?? req.body?.walletToken ?? "anon";
    const cacheKey = `idem:${userId}:${req.baseUrl}${req.path}:${key}`;
    const lockKey = `${cacheKey}:lock`;

    let cached: string | null;
    let gotLock: string | null;
    try {
      cached = await redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        return res.status(parsed.statusCode).json(parsed.body);
      }
      gotLock = await redis.set(lockKey, "1", "EX", 30, "NX");
    } catch (err) {
      logger.error({ err }, "idempotency check failed — Redis unavailable");
      captureException(err, { route: req.path });
      return res.status(503).json({ error: "idempotency_check_unavailable", message: "Try again shortly." });
    }
    if (!gotLock) {
      return res.status(409).json({ error: "duplicate_request_in_flight" });
    }

    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      const payload = JSON.stringify({ statusCode: res.statusCode, body });
      // Only cache successful/idempotent-safe responses.
      if (res.statusCode < 500) {
        redis.set(cacheKey, payload, "EX", TTL_SECONDS).catch(() => {});
      }
      redis.del(lockKey).catch(() => {});
      return originalJson(body);
    };

    next();
  };
}

export function hashBody(body: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex");
}
