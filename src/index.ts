import "dotenv/config";
import http from "http";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { initSentry, captureException } from "./sentry.js";
import { initSockets } from "./sockets/index.js";
import { buildApp } from "./app.js";

initSentry();

const app = buildApp();
const httpServer = http.createServer(app);
initSockets(httpServer);

httpServer.listen(env.PORT, () => {
  logger.info(`GCW API listening on :${env.PORT} (env=${env.NODE_ENV})`);
  logger.info(`Swagger docs: http://localhost:${env.PORT}/docs`);
});

process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down");
  httpServer.close(() => process.exit(0));
});

// A rejected promise a dependency doesn't catch internally (e.g.
// rate-limit-redis's sendCommand rejecting on a Redis-side error, as
// happened when Upstash's request quota was hit) used to crash the entire
// process on Node's default unhandledRejection behavior — one bad request
// took down every other in-flight request too. Log + report, keep running;
// a single failed async operation isn't fatal to the whole server.
process.on("unhandledRejection", (err) => {
  logger.error({ err }, "unhandled promise rejection");
  captureException(err, { source: "unhandledRejection" });
});

// uncaughtException is different: Node's own guidance is that process state
// may be corrupted afterward, so log + report, then exit deliberately and
// let Fly's restart policy bring up a clean process — don't try to keep
// running in a possibly-broken state.
process.on("uncaughtException", (err) => {
  logger.error({ err }, "uncaught exception — exiting for a clean restart");
  captureException(err, { source: "uncaughtException" });
  process.exit(1);
});
