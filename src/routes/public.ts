import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { users, creatorProfiles, streams } from "../db/schema.js";
import { CREATOR_TIERS, calculateLevelFromCoins, levelNumberFromKey } from "../tiers.js";
import { centsToUsd } from "../money.js";
import { topCreatorsKey } from "./leaderboard.js";
import { redis } from "../redis.js";

export const publicRouter = Router();

publicRouter.get("/creators/:username", async (req, res) => {
  const [user] = await db.select().from(users).where(eq(users.username, req.params.username));
  if (!user) return res.status(404).json({ error: "not_found" });

  const [profile] = await db.select().from(creatorProfiles).where(eq(creatorProfiles.userId, user.id));
  if (!profile) return res.status(404).json({ error: "not_found" });

  const tierKey = calculateLevelFromCoins(profile.lifetimeCoins);
  const tier = CREATOR_TIERS[tierKey];

  res.json({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    lifetimeCoins: profile.lifetimeCoins,
    lifetimeEarningsUsd: centsToUsd(profile.lifetimeEarningsCents),
    currentLevel: levelNumberFromKey(tierKey),
    tierKey,
    nextMilestone: tier.nextMilestone,
  });
});

publicRouter.get("/streams/live", async (_req, res) => {
  const rows = await db
    .select({
      id: streams.id,
      title: streams.title,
      startedAt: streams.startedAt,
      viewerCount: streams.viewerCount,
      creatorId: streams.creatorId,
      creatorUsername: users.username,
      creatorDisplayName: users.displayName,
      creatorAvatarUrl: users.avatarUrl,
    })
    .from(streams)
    .innerJoin(users, eq(streams.creatorId, users.id))
    .where(eq(streams.isLive, true));

  res.json(rows);
});

publicRouter.get("/leaderboard/top-creators", async (req, res) => {
  const period = (req.query.period as string) || "day";
  if (!["day", "week", "month"].includes(period)) return res.status(400).json({ error: "invalid_period" });

  const raw = await redis.zrevrange(topCreatorsKey(period as any), 0, 19, "WITHSCORES");
  const out: { creatorId: string; score: number; rank: number }[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    out.push({ creatorId: raw[i], score: Number(raw[i + 1]), rank: out.length + 1 });
  }
  res.json(out);
});

