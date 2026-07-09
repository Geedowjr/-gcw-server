import client from "prom-client";

export const register = new client.Registry();
client.collectDefaultMetrics({ register });

export const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
});
register.registerMetric(httpRequestDuration);

export const giftsSentTotal = new client.Counter({
  name: "gifts_sent_total",
  help: "Total gifts sent",
});
register.registerMetric(giftsSentTotal);

export const cashoutsTotal = new client.Counter({
  name: "cashouts_total",
  help: "Total cashout requests",
  labelNames: ["status"],
});
register.registerMetric(cashoutsTotal);

export function metricsMiddleware() {
  return (req: any, res: any, next: any) => {
    const end = httpRequestDuration.startTimer();
    res.on("finish", () => {
      end({
        method: req.method,
        route: req.route?.path || req.path,
        status_code: res.statusCode,
      });
    });
    next();
  };
}
