import { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import { eq, desc, lt, and, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { creatorProfiles, users, cashouts } from "../db/schema.js";
import { requireAuth } from "../auth/middleware.js";
import { centsToUsd } from "../money.js";
import { CREATOR_TIERS, calculateLevelFromCoins, levelNumberFromKey } from "../tiers.js";

export const creatorsRouter = Router();

async function creatorProfilePayload(userId: string) {
  const [profile] = await db.select().from(creatorProfiles).where(eq(creatorProfiles.userId, userId));
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!profile || !user) return null;

  const tierKey = calculateLevelFromCoins(profile.lifetimeCoins);
  const tier = CREATOR_TIERS[tierKey];

  return {
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    lifetimeCoins: profile.lifetimeCoins,
    lifetimeEarningsUsd: centsToUsd(profile.lifetimeEarningsCents),
    payoutBalanceUsd: centsToUsd(profile.payoutBalanceCents),
    pendingBalanceUsd: centsToUsd(profile.pendingBalanceCents),
    currentLevel: levelNumberFromKey(tierKey),
    tierKey,
    cutPct: tier.cut,
    nextMilestone: tier.nextMilestone,
    kycStatus: profile.kycStatus,
    twoFAEnabled: user.totpEnabled,
  };
}

creatorsRouter.get("/profile", requireAuth(), async (req, res) => {
  const payload = await creatorProfilePayload(req.user!.id);
  if (!payload) return res.status(404).json({ error: "not_found" });
  res.json(payload);
});

const patchSchema = z.object({
  displayName: z.string().min(1).max(50).optional(),
  avatarUrl: z.string().url().optional(),
}).strict();

creatorsRouter.patch("/profile", requireAuth(), async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });

  await db
    .update(users)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(users.id, req.user!.id));

  const payload = await creatorProfilePayload(req.user!.id);
  res.json(payload);
});

creatorsRouter.get("/cashouts", requireAuth(), async (req, res) => {
  const cursor = req.query.cursor as string | undefined;
  const limit = 20;

  const conditions = [eq(cashouts.creatorId, req.user!.id)];
  if (cursor) conditions.push(lt(cashouts.requestedAt, new Date(cursor)));

  const rows = await db
    .select()
    .from(cashouts)
    .where(conditions.length > 1 ? and(...conditions) : conditions[0])
    .orderBy(desc(cashouts.requestedAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const nextCursor = hasMore ? page[page.length - 1].requestedAt.toISOString() : null;

  res.json({
    items: page.map((c) => ({
      id: c.id,
      destinationType: c.destinationType,
      destinationAccount: c.destinationAccount,
      amountCents: c.amountCents,
      amountUsd: centsToUsd(c.amountCents),
      currency: c.currency,
      status: c.status,
      requestedAt: c.requestedAt,
      paidAt: c.paidAt,
      failureReason: c.failureReason,
    })),
    nextCursor,
  });
});

/** Atomic compare-and-set: only writes if no token exists yet, so two
 * concurrent requests for the same creator can't each generate a different
 * token and race to persist it — mirrors getOrCreateStripeCustomer. */
async function getOrCreateOverlayToken(userId: string, existingToken: string | null): Promise<string> {
  if (existingToken) return existingToken;

  const token = crypto.randomBytes(32).toString("hex");
  const [updated] = await db
    .update(creatorProfiles)
    .set({ overlayToken: token, updatedAt: new Date() })
    .where(and(eq(creatorProfiles.userId, userId), isNull(creatorProfiles.overlayToken)))
    .returning();
  if (updated) return token;

  const [current] = await db.select().from(creatorProfiles).where(eq(creatorProfiles.userId, userId));
  return current!.overlayToken!;
}

creatorsRouter.get("/overlay-token", requireAuth(), async (req, res) => {
  const [profile] = await db.select().from(creatorProfiles).where(eq(creatorProfiles.userId, req.user!.id));
  if (!profile) return res.status(404).json({ error: "not_found" });

  const overlayToken = await getOrCreateOverlayToken(req.user!.id, profile.overlayToken);
  res.json({ overlayToken });
});

creatorsRouter.post("/overlay-token/regenerate", requireAuth(), async (req, res) => {
  const [profile] = await db.select().from(creatorProfiles).where(eq(creatorProfiles.userId, req.user!.id));
  if (!profile) return res.status(404).json({ error: "not_found" });

  const overlayToken = crypto.randomBytes(32).toString("hex");
  await db
    .update(creatorProfiles)
    .set({ overlayToken, updatedAt: new Date() })
    .where(eq(creatorProfiles.userId, req.user!.id));

  res.json({ overlayToken });
});
