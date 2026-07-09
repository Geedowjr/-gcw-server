import { Router } from "express";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { challenges } from "../db/schema.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { emitChallengeUpdate } from "../sockets/emitters.js";

export const challengesRouter = Router();

const startSchema = z.object({
  streamId: z.string().uuid(),
  type: z.string(),
  title: z.string().optional(),
  creatorBId: z.string().uuid().optional(),
  durationSeconds: z.number().int().positive().default(300),
  allowedGiftFilter: z.string().optional(),
}).strict();

challengesRouter.post("/start", requireAuth(), requireRole("creator", "admin"), async (req, res) => {
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });

  const endsAt = new Date(Date.now() + parsed.data.durationSeconds * 1000);
  const [challenge] = await db
    .insert(challenges)
    .values({
      streamId: parsed.data.streamId,
      type: parsed.data.type,
      title: parsed.data.title,
      creatorAId: req.user!.id,
      creatorBId: parsed.data.creatorBId,
      endsAt,
      allowedGiftFilter: parsed.data.allowedGiftFilter,
    })
    .returning();

  emitChallengeUpdate(challenge);
  res.status(201).json(challenge);
});

challengesRouter.post("/:id/end", requireAuth(), async (req, res) => {
  const [challenge] = await db.select().from(challenges).where(eq(challenges.id, req.params.id));
  if (!challenge) return res.status(404).json({ error: "not_found" });
  if (challenge.creatorAId !== req.user!.id && req.user!.role !== "admin") {
    return res.status(403).json({ error: "forbidden" });
  }

  const [updated] = await db
    .update(challenges)
    .set({ status: "ended" })
    .where(eq(challenges.id, req.params.id))
    .returning();

  emitChallengeUpdate(updated);
  res.json(updated);
});

challengesRouter.get("/active", async (req, res) => {
  const streamId = req.query.streamId as string | undefined;
  if (!streamId) return res.status(400).json({ error: "streamId_required" });

  const rows = await db
    .select()
    .from(challenges)
    .where(and(eq(challenges.streamId, streamId), eq(challenges.status, "active")));

  res.json(rows);
});
