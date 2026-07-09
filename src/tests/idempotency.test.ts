import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "crypto";
import request from "supertest";
import { app, closeAll } from "./setup.js";

describe("buy-coins idempotency", () => {
  it("requires an Idempotency-Key header", async () => {
    const res = await request(app).post("/api/payments/buy-coins").send({
      method: "stripe",
      amountCents: 500,
      coins: 500,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("idempotency_key_required");
  });

  it("using the same Idempotency-Key twice results in exactly one charge/topup", async () => {
    const idempotencyKey = randomUUID();
    const body = { method: "stripe", amountCents: 1000, coins: 1000 };

    const first = await request(app).post("/api/payments/buy-coins").set("Idempotency-Key", idempotencyKey).send(body);
    expect(first.status).toBe(201);

    const second = await request(app).post("/api/payments/buy-coins").set("Idempotency-Key", idempotencyKey).send(body);
    expect(second.status).toBe(201);

    // The cached response is replayed verbatim — same topupId proves the
    // handler only ran once.
    expect(second.body.topupId).toBe(first.body.topupId);
    expect(second.body.walletToken).toBe(first.body.walletToken);
  });

  afterAll(async () => {
    await closeAll();
  });
});
