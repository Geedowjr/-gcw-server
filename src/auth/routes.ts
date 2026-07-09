import { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { users, creatorProfiles, emailVerifications, passwordResets, auditEvents } from "../db/schema.js";
import { hashPassword, verifyPassword } from "./password.js";
import { generateTotpSecret, verifyTotp } from "./totp.js";
import {
  signAccessToken,
  issueRefreshTokenFamily,
  rotateRefreshToken,
  revokeRefreshToken,
  AuthError,
} from "./jwt.js";
import { requireAuth } from "./middleware.js";
import { authLimiter } from "../rateLimits.js";
import { queues } from "../jobs/queues.js";

export const authRouter = Router();

function publicUser(u: typeof users.$inferSelect) {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    role: u.role,
    emailVerified: !!u.emailVerifiedAt,
    twoFAEnabled: u.totpEnabled,
    createdAt: u.createdAt,
  };
}

async function audit(actorId: string | null, action: string, req: any, meta: Record<string, unknown> = {}) {
  await db.insert(auditEvents).values({
    actorId: actorId ?? undefined,
    action,
    ip: req.ip,
    ua: req.header("user-agent"),
    meta,
  });
}

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  username: z.string().min(3).max(30),
}).strict();

authRouter.post("/signup", authLimiter, async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
  const { email, password, username } = parsed.data;

  const existing = await db.select().from(users).where(eq(users.email, email));
  if (existing.length) return res.status(409).json({ error: "email_taken" });

  const passwordHash = await hashPassword(password);
  const [user] = await db
    .insert(users)
    .values({ email, username, passwordHash, displayName: username })
    .returning();

  await db.insert(creatorProfiles).values({ userId: user.id }).onConflictDoNothing();

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  await db.insert(emailVerifications).values({
    tokenHash,
    userId: user.id,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  await queues.email.add("verify-email", { userId: user.id, email, token: rawToken });

  const accessToken = signAccessToken({ sub: user.id, role: user.role, username: user.username });
  const { token: refreshToken } = await issueRefreshTokenFamily(user.id, { ip: req.ip, ua: req.header("user-agent") });

  await audit(user.id, "signup", req);

  res.status(201).json({ accessToken, refreshToken, user: publicUser(user) });
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
  totp: z.string().optional(),
}).strict();

authRouter.post("/login", authLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
  const { email, password, totp } = parsed.data;

  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    await audit(user?.id ?? null, "login_failed", req, { email });
    return res.status(401).json({ error: "invalid_credentials" });
  }

  if (user.totpEnabled) {
    if (!totp) return res.status(401).json({ error: "totp_required" });
    if (!user.totpSecret || !verifyTotp(user.totpSecret, totp)) {
      await audit(user.id, "login_failed", req, { reason: "bad_totp" });
      return res.status(401).json({ error: "invalid_totp" });
    }
  }

  const accessToken = signAccessToken({ sub: user.id, role: user.role, username: user.username });
  const { token: refreshToken } = await issueRefreshTokenFamily(user.id, { ip: req.ip, ua: req.header("user-agent") });

  await audit(user.id, "login", req);

  res.json({ accessToken, refreshToken, user: publicUser(user) });
});

const refreshSchema = z.object({ refreshToken: z.string() }).strict();

authRouter.post("/refresh", async (req, res) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error" });

  try {
    const { userId, token, expiresAt } = await rotateRefreshToken(parsed.data.refreshToken, {
      ip: req.ip,
      ua: req.header("user-agent"),
    });
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) return res.status(401).json({ error: "unauthorized" });

    const accessToken = signAccessToken({ sub: user.id, role: user.role, username: user.username });
    res.json({ accessToken, refreshToken: token, expiresAt, user: publicUser(user) });
  } catch (err) {
    if (err instanceof AuthError) return res.status(401).json({ error: err.message });
    throw err;
  }
});

authRouter.post("/logout", async (req, res) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (parsed.success) await revokeRefreshToken(parsed.data.refreshToken);
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth(), async (req, res) => {
  const [user] = await db.select().from(users).where(eq(users.id, req.user!.id));
  if (!user) return res.status(404).json({ error: "not_found" });
  res.json({ user: publicUser(user) });
});

const verifyEmailSchema = z.object({ token: z.string() }).strict();

authRouter.post("/verify-email", async (req, res) => {
  const parsed = verifyEmailSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error" });

  const tokenHash = crypto.createHash("sha256").update(parsed.data.token).digest("hex");
  const [row] = await db.select().from(emailVerifications).where(eq(emailVerifications.tokenHash, tokenHash));
  if (!row || row.expiresAt < new Date()) return res.status(400).json({ error: "invalid_or_expired_token" });

  await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, row.userId));
  await db.delete(emailVerifications).where(eq(emailVerifications.tokenHash, tokenHash));

  res.json({ ok: true });
});

const forgotSchema = z.object({ email: z.string().email() }).strict();

authRouter.post("/forgot", authLimiter, async (req, res) => {
  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error" });

  const [user] = await db.select().from(users).where(eq(users.email, parsed.data.email));
  if (user) {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    await db.insert(passwordResets).values({
      tokenHash,
      userId: user.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    await queues.email.add("password-reset", { userId: user.id, email: user.email, token: rawToken });
  }
  // Always 200 — do not leak whether the email exists.
  res.json({ ok: true });
});

const resetSchema = z.object({ token: z.string(), password: z.string().min(8) }).strict();

authRouter.post("/reset", authLimiter, async (req, res) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error" });

  const tokenHash = crypto.createHash("sha256").update(parsed.data.token).digest("hex");
  const [row] = await db.select().from(passwordResets).where(eq(passwordResets.tokenHash, tokenHash));
  if (!row || row.expiresAt < new Date()) return res.status(400).json({ error: "invalid_or_expired_token" });

  const passwordHash = await hashPassword(parsed.data.password);
  await db.update(users).set({ passwordHash }).where(eq(users.id, row.userId));
  await db.delete(passwordResets).where(eq(passwordResets.tokenHash, tokenHash));

  res.json({ ok: true });
});

authRouter.post("/2fa/setup", requireAuth(), async (req, res) => {
  const [user] = await db.select().from(users).where(eq(users.id, req.user!.id));
  if (!user) return res.status(404).json({ error: "not_found" });

  const { base32, otpauthUrl } = generateTotpSecret(user.username);
  await db.update(users).set({ totpSecret: base32 }).where(eq(users.id, user.id));

  res.json({ secret: base32, otpauthUrl, qrCodeUrl: `otpauth://totp/${encodeURIComponent(user.username)}` , issuer: "GCW" , provisioningUri: otpauthUrl });
});

const totpCodeSchema = z.object({ code: z.string().length(6) }).strict();

authRouter.post("/2fa/enable", requireAuth(), async (req, res) => {
  const parsed = totpCodeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error" });

  const [user] = await db.select().from(users).where(eq(users.id, req.user!.id));
  if (!user?.totpSecret) return res.status(400).json({ error: "totp_not_initialized" });
  if (!verifyTotp(user.totpSecret, parsed.data.code)) return res.status(400).json({ error: "invalid_code" });

  await db.update(users).set({ totpEnabled: true }).where(eq(users.id, user.id));
  await audit(user.id, "2fa_enabled", req);
  res.json({ ok: true });
});

authRouter.post("/2fa/disable", requireAuth(), async (req, res) => {
  const parsed = totpCodeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error" });

  const [user] = await db.select().from(users).where(eq(users.id, req.user!.id));
  if (!user?.totpEnabled || !user.totpSecret) return res.status(400).json({ error: "2fa_not_enabled" });
  if (!verifyTotp(user.totpSecret, parsed.data.code)) return res.status(400).json({ error: "invalid_code" });

  await db.update(users).set({ totpEnabled: false, totpSecret: null }).where(eq(users.id, user.id));
  await audit(user.id, "2fa_disabled", req);
  res.json({ ok: true });
});
