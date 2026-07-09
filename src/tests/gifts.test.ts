import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import request from "supertest";
import { eq } from "drizzle-orm";
import { app, uniqueEmail, closeAll } from "./setup.js";
import { db } from "../db/client.js";
import { wallets, creatorProfiles, giftCatalog, users } from "../db/schema.js";
import { hashPassword } from "../auth/password.js";

describe("gift-send transaction atomicity", () => {
  let creatorId: string;
  let walletToken: string;

  beforeAll(async () => {
    const [creator] = await db
      .insert(users)
      .values({
        email: uniqueEmail(),
        username: `creator_${Date.now()}`,
        passwordHash: await hashPassword("x"),
        role: "creator",
      })
      .returning();
    creatorId = creator.id;
    await db.insert(creatorProfiles).values({ userId: creatorId, lifetimeCoins: 0 });

    await db
      .insert(giftCatalog)
      .values({ id: `test_gift_${Date.now()}`, name: "Test Gift", coins: 100, usdCents: 100, active: true })
      .onConflictDoNothing();

    const [wallet] = await db.insert(wallets).values({ coinBalance: 50 }).returning();
    walletToken = wallet.walletToken;
  });

  it("rejects sending a gift the sender can't afford, without mutating balances", async () => {
    const [gift] = await db.select().from(giftCatalog).where(eq(giftCatalog.active, true)).limit(1);

    const res = await request(app)
      .post("/api/gifts/send")
      .set("Idempotency-Key", randomUUID())
      .send({ creatorId, senderWalletToken: walletToken, senderName: "Broke Fan", giftId: gift.id });

    expect(res.status).toBe(402);

    const [wallet] = await db.select().from(wallets).where(eq(wallets.walletToken, walletToken));
    expect(wallet.coinBalance).toBe(50); // untouched
  });

  it("debits sender, credits creator pending balance, and updates lifetime coins atomically", async () => {
    await db.update(wallets).set({ coinBalance: 100000 }).where(eq(wallets.walletToken, walletToken));

    const [gift] = await db
      .insert(giftCatalog)
      .values({ id: `test_gift2_${Date.now()}`, name: "Test Gift 2", coins: 1000, usdCents: 1000, active: true })
      .returning();

    const res = await request(app)
      .post("/api/gifts/send")
      .set("Idempotency-Key", randomUUID())
      .send({ creatorId, senderWalletToken: walletToken, senderName: "Rich Fan", giftId: gift.id });

    expect(res.status).toBe(201);
    expect(res.body.creatorShareCents + res.body.platformFeeCents).toBe(res.body.grossCents);

    const [wallet] = await db.select().from(wallets).where(eq(wallets.walletToken, walletToken));
    expect(wallet.coinBalance).toBe(100000 - 1000);

    const [profile] = await db.select().from(creatorProfiles).where(eq(creatorProfiles.userId, creatorId));
    expect(profile.lifetimeCoins).toBe(1000);
    expect(profile.pendingBalanceCents).toBe(res.body.creatorShareCents);
  });

  afterAll(async () => {
    await closeAll();
  });
});
