import jwt from "jsonwebtoken";
import crypto from "crypto";
import { eq, and, isNull } from "drizzle-orm";
import { env } from "../env.js";
import { db } from "../db/client.js";
import { refreshTokens } from "../db/schema.js";
import { logger } from "../logger.js";

export interface AccessTokenPayload {
  sub: string; // user id
  role: string;
  username: string;
}

export function signAccessToken(payload: AccessTokenPayload) {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: env.JWT_ACCESS_TTL as any });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function ttlToMs(ttl: string): number {
  const match = ttl.match(/^(\d+)([smhd])$/);
  if (!match) return 30 * 24 * 60 * 60 * 1000;
  const value = Number(match[1]);
  const unit = match[2];
  const mult = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit] ?? 86_400_000;
  return value * mult;
}

/** Issues a brand new refresh-token family (login/signup). */
export async function issueRefreshTokenFamily(userId: string, meta: { ip?: string; ua?: string }) {
  const familyId = crypto.randomUUID();
  return rotateOrCreateRefreshToken({ userId, familyId, meta });
}

/**
 * Creates a new refresh token row within a family. Called at login (new family)
 * and at every /refresh call (rotation within the existing family).
 */
async function rotateOrCreateRefreshToken(params: {
  userId: string;
  familyId: string;
  meta: { ip?: string; ua?: string };
}) {
  const raw = crypto.randomBytes(48).toString("hex");
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + ttlToMs(env.JWT_REFRESH_TTL));

  await db.insert(refreshTokens).values({
    userId: params.userId,
    familyId: params.familyId,
    tokenHash,
    expiresAt,
    ip: params.meta.ip,
    ua: params.meta.ua,
  });

  // Encode familyId + raw secret into the token returned to the client.
  const token = `${params.familyId}.${raw}`;
  return { token, expiresAt };
}

/**
 * Validates & rotates a refresh token. Implements reuse detection: if the
 * presented token hash does not match the CURRENT (un-revoked) token for its
 * family, the entire family is revoked (possible token theft) and rotation fails.
 */
export async function rotateRefreshToken(
  presentedToken: string,
  meta: { ip?: string; ua?: string }
) {
  const [familyId, raw] = presentedToken.split(".");
  if (!familyId || !raw) throw new AuthError("invalid_refresh_token");

  const tokenHash = hashToken(raw);

  const rows = await db
    .select()
    .from(refreshTokens)
    .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));

  const current = rows.find((r) => r.tokenHash === tokenHash);

  if (!current) {
    // Presented token not found among live tokens in this family -> reuse of an
    // already-rotated (or revoked) token. Revoke the whole family.
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.familyId, familyId));
    logger.warn({ familyId }, "refresh token reuse detected — family revoked");
    throw new AuthError("refresh_token_reuse_detected");
  }

  if (current.expiresAt < new Date()) {
    throw new AuthError("refresh_token_expired");
  }

  // Rotate: revoke current, issue a new one in the same family.
  const next = await rotateOrCreateRefreshToken({ userId: current.userId, familyId, meta });
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date(), replacedByTokenHash: hashToken(next.token.split(".")[1]) })
    .where(eq(refreshTokens.id, current.id));

  return { userId: current.userId, ...next };
}

export async function revokeRefreshToken(presentedToken: string) {
  const [familyId] = presentedToken.split(".");
  if (!familyId) return;
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.familyId, familyId));
}

export class AuthError extends Error {}
