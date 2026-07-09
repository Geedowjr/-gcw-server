import { Router } from "express";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { follows, reports, blocks } from "../db/schema.js";
import { requireAuth } from "../auth/middleware.js";

export const followsRouter = Router();
export const reportsRouter = Router();
export const blocksRouter = Router();

followsRouter.post("/:creatorId", requireAuth(), async (req, res) => {
  const creatorId = req.params.creatorId;
  await db
    .insert(follows)
    .values({ followerId: req.user!.id, creatorId })
    .onConflictDoNothing();
  res.status(201).json({ ok: true });
});

followsRouter.delete("/:creatorId", requireAuth(), async (req, res) => {
  await db
    .delete(follows)
    .where(and(eq(follows.followerId, req.user!.id), eq(follows.creatorId, req.params.creatorId)));
  res.json({ ok: true });
});

const reportSchema = z.object({
  targetType: z.string(),
  targetId: z.string().uuid(),
  reason: z.string().min(1).max(500),
}).strict();

reportsRouter.post("/", requireAuth(), async (req, res) => {
  const parsed = reportSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });

  const [report] = await db
    .insert(reports)
    .values({ reporterId: req.user!.id, ...parsed.data })
    .returning();
  res.status(201).json(report);
});

blocksRouter.post("/:userId", requireAuth(), async (req, res) => {
  await db
    .insert(blocks)
    .values({ userId: req.user!.id, blockedId: req.params.userId })
    .onConflictDoNothing();
  res.status(201).json({ ok: true });
});
