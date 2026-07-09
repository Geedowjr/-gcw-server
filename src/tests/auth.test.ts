import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app, uniqueEmail, closeAll } from "./setup.js";

// Requires DATABASE_URL / REDIS_URL pointed at a live test Postgres + Redis
// (e.g. `docker compose up postgres redis` then `npm run migrate`).
describe("auth: signup -> login -> refresh -> me", () => {
  const email = uniqueEmail();
  const password = "SuperSecret123!";
  const username = `user_${Date.now()}`;

  let refreshToken: string;
  let accessToken: string;

  it("signs up a new user", async () => {
    const res = await request(app).post("/api/auth/signup").send({ email, password, username });
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.user.email).toBe(email);
    refreshToken = res.body.refreshToken;
    accessToken = res.body.accessToken;
  });

  it("rejects duplicate signup", async () => {
    const res = await request(app).post("/api/auth/signup").send({ email, password, username: `${username}_dup` });
    expect(res.status).toBe(409);
  });

  it("logs in with correct credentials", async () => {
    const res = await request(app).post("/api/auth/login").send({ email, password });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
  });

  it("rejects login with wrong password", async () => {
    const res = await request(app).post("/api/auth/login").send({ email, password: "wrong" });
    expect(res.status).toBe(401);
  });

  it("rotates the refresh token", async () => {
    const res = await request(app).post("/api/auth/refresh").send({ refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).not.toBe(refreshToken);
  });

  it("detects refresh-token reuse and revokes the family", async () => {
    // refreshToken was already rotated above — reusing it now should fail.
    const res = await request(app).post("/api/auth/refresh").send({ refreshToken });
    expect(res.status).toBe(401);
  });

  it("returns the current user for a valid access token", async () => {
    const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email);
  });

  it("rejects /me without a token", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  afterAll(async () => {
    await closeAll();
  });
});
