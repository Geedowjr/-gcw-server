import * as Sentry from "@sentry/node";
import { env, isProd } from "./env.js";

export function initSentry() {
  if (!env.SENTRY_DSN) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: isProd ? 0.1 : 1.0,
  });
}

export function captureException(err: unknown, context?: Record<string, unknown>) {
  if (!env.SENTRY_DSN) {
    // eslint-disable-next-line no-console
    console.error("[sentry:disabled]", err, context);
    return;
  }
  Sentry.captureException(err, { extra: context });
}

export { Sentry };
