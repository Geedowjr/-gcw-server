import pino from "pino";
import pinoHttp from "pino-http";
import { randomUUID } from "crypto";
import { env, isProd } from "./env.js";

export const logger = pino({
  level: isProd ? "info" : "debug",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.password",
      "*.password_hash",
      "*.email",
      "*.phone",
      "*.totp_secret",
      "*.card",
      "*.cardNumber",
      "*.destinationAccount",
      "res.headers['set-cookie']",
    ],
    censor: "[REDACTED]",
  },
  transport: !isProd
    ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } }
    : undefined,
});

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const existing = req.headers["x-request-id"];
    const id = (Array.isArray(existing) ? existing[0] : existing) || randomUUID();
    res.setHeader("x-request-id", id);
    return id;
  },
  customLogLevel: (_req, res, err) => {
    if (res.statusCode >= 500 || err) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
});
