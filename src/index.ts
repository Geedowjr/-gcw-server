import "dotenv/config";
import http from "http";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { initSentry } from "./sentry.js";
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
