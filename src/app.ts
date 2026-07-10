import express from "express";
// Patches Express 4's router so rejected promises in async route handlers are
// forwarded to the error middleware below instead of becoming an unhandled
// rejection that crashes the whole process. Must be imported before any
// routers that define async handlers.
import "express-async-errors";
import helmet from "helmet";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import { corsOrigins } from "./env.js";
import { logger, httpLogger } from "./logger.js";
import { captureException } from "./sentry.js";
import { register, metricsMiddleware } from "./metrics.js";
import { globalLimiter } from "./rateLimits.js";
import { pool } from "./db/client.js";
import { redis } from "./redis.js";
import { buildOpenApiSpec } from "./openapi.js";

import authRouter from "./routes/auth.js";
import { creatorsRouter } from "./routes/creators.js";
import { cashoutsRouter } from "./routes/cashouts.js";
import { kycRouter } from "./routes/kyc.js";
import { paymentsRouter } from "./routes/payments.js";
import { cardsRouter } from "./routes/cards.js";
import { giftsRouter } from "./routes/gifts.js";
import { streamsRouter } from "./routes/streams.js";
import { challengesRouter } from "./routes/challenges.js";
import { leaderboardRouter } from "./routes/leaderboard.js";
import { notificationsRouter } from "./routes/notifications.js";
import { followsRouter, reportsRouter, blocksRouter } from "./routes/moderation.js";
import { publicRouter } from "./routes/public.js";
import { webhooksRouter } from "./routes/webhooks.js";

/** Builds the Express app. Exported separately from index.ts so tests can
 * `import { app } from "../app.js"` and drive it with supertest without
 * binding a real TCP port or initializing Socket.io. */
export function buildApp() {
  const app = express();

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          "script-src": ["'self'", "'unsafe-inline'"],
          "style-src": ["'self'", "'unsafe-inline'"],
        },
      },
    })
  );
  app.use(cors({ origin: corsOrigins, credentials: true }));
  app.use(httpLogger);
  app.use(metricsMiddleware());
  app.use(globalLimiter);

  // Webhooks need the RAW request body for signature verification — mount
  // BEFORE express.json() and use express.raw() scoped to this router only.
  app.use("/api/public/webhooks", express.raw({ type: "*/*", limit: "2mb" }), webhooksRouter);

  app.use(express.json({ limit: "2mb" }));

  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  app.get("/readyz", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      await redis.ping();
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "readiness check failed");
      res.status(503).json({ ok: false });
    }
  });

  app.get("/metrics", async (_req, res) => {
    res.setHeader("Content-Type", register.contentType);
    res.send(await register.metrics());
  });

  const openApiSpec = buildOpenApiSpec();
  app.get("/openapi.json", (_req, res) => res.json(openApiSpec));
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));

  app.use("/api/auth", authRouter);
  app.use("/api/creators/cashout", cashoutsRouter);
  app.use("/api/creators/kyc", kycRouter);
  app.use("/api/creators", creatorsRouter);
  app.use("/api/payments", paymentsRouter);
  app.use("/api/payments/cards", cardsRouter);
  app.use("/api/gifts", giftsRouter);
  app.use("/api/streams", streamsRouter);
  app.use("/api/challenges", challengesRouter);
  app.use("/api/leaderboard", leaderboardRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/follows", followsRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api/blocks", blocksRouter);
  app.use("/api/public", publicRouter);

  app.use((req, res) => {
    res.status(404).json({ error: "not_found", path: req.path });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ err, path: req.path }, "unhandled error");
    captureException(err, { path: req.path, method: req.method });
    res.status(err.status || 500).json({ error: "internal_error" });
  });

  return app;
}
