import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("30d"),

  CORS_ORIGINS: z.string().default("http://localhost:8080,http://localhost:5173"),

  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),

  MPESA_CONSUMER_KEY: z.string().default(""),
  MPESA_CONSUMER_SECRET: z.string().default(""),
  MPESA_SHORTCODE: z.string().default(""),
  MPESA_PASSKEY: z.string().default(""),
  MPESA_CALLBACK_URL: z.string().default(""),

  EVC_MERCHANT_ID: z.string().default(""),
  EVC_API_KEY: z.string().default(""),
  EVC_WEBHOOK_SECRET: z.string().default(""),

  EDAHAB_API_KEY: z.string().default(""),
  EDAHAB_MERCHANT_ID: z.string().default(""),
  EDAHAB_WEBHOOK_SECRET: z.string().default(""),

  SENTRY_DSN: z.string().default(""),
  SMTP_URL: z.string().default(""),
  FROM_EMAIL: z.string().default("noreply@gcw.app"),

  MIN_CASHOUT_USD: z.coerce.number().default(10),
  CASHOUT_HOLD_DAYS: z.coerce.number().default(7),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
export const corsOrigins = env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
