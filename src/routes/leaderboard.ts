import { Router } from "express";
import { redis } from "../redis.js";

export const leaderboardRouter = Router();

// Redis sorted-set keys are updated by the gift-send flow (see src/routes/gifts.ts
// hook below) and read here for fast top-N queries.
export function topSendersKey(streamId: string, period: "live" | "day" | "week") {
  return `lb:senders:${streamId}:${period}`;
}
export function topCreatorsKey(period: "day" | "week" | "month") {
  return `lb:creators:${period}`;
}

leaderboardRouter.get("/top-senders", async (req, res) => {
  const streamId = req.query.streamId as string | undefined;
  const period = (req.query.period as string) || "live";
  if (!streamId) return res.status(400).json({ error: "streamId_required" });
  if (!["live", "day", "week"].includes(period)) return res.status(400).json({ error: "invalid_period" });

  const key = topSendersKey(streamId, period as any);
  const raw = await redis.zrevrange(key, 0, 19, "WITHSCORES");
  res.json(pairsToLeaderboard(raw));
});

leaderboardRouter.get("/top-creators", async (req, res) => {
  const period = (req.query.period as string) || "day";
  if (!["day", "week", "month"].includes(period)) return res.status(400).json({ error: "invalid_period" });

  const key = topCreatorsKey(period as any);
  const raw = await redis.zrevrange(key, 0, 19, "WITHSCORES");
  res.json(pairsToLeaderboard(raw));
});

function pairsToLeaderboard(raw: string[]) {
  const out: { member: string; score: number; rank: number }[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    out.push({ member: raw[i], score: Number(raw[i + 1]), rank: out.length + 1 });
  }
  return out;
}
