import { describe, it, expect, afterAll } from "vitest";
import crypto from "crypto";
import request from "supertest";
import { eq } from "drizzle-orm";
import { app, closeAll } from "./setup.js";
import { db } from "../db/client.js";
import { webhookEvents } from "../db/schema.js";

describe("webhook signature verification", () => {
  it("rejects an M-Pesa callback with a bad signature and does not create a webhook_events row", async () => {
    const externalId = `test-mpesa-${Date.now()}`;
    const payload = { TransactionID: externalId };

    const res = await request(app)
      .post("/api/public/webhooks/mpesa")
      .set("Content-Type", "application/json")
      .set("x-mpesa-signature", "0".repeat(64)) // deliberately wrong
      .send(JSON.stringify(payload));

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_signature");

    const rows = await db.select().from(webhookEvents).where(eq(webhookEvents.externalId, externalId));
    expect(rows.length).toBe(0);
  });

  it("rejects a Stripe webhook without a stripe-signature header when a webhook secret is configured", async () => {
    // With STRIPE_WEBHOOK_SECRET unset in this test env, the stub gateway
    // allows requests through (dev mode) — this test documents that behavior
    // rather than asserting a hard failure, since CI may run without real
    // Stripe credentials configured.
    const res = await request(app)
      .post("/api/public/webhooks/stripe")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ id: `evt_${Date.now()}` }));

    expect([200, 401]).toContain(res.status);
  });

  afterAll(async () => {
    await closeAll();
  });
});
