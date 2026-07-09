import { Router } from "express";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { streams, users } from "../db/schema.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { emitStreamEnded } from "../sockets/emitters.js";

export const streamsRouter = Router();

const startSchema = z.object({ title: z.string().max(120).optional() }).strict();

streamsRouter.post("/", requireAuth(), requireRole("creator", "admin"), async (req, res) => {
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error" });

  const [stream] = await db
    .insert(streams)
    .values({ creatorId: req.user!.id, title: parsed.data.title, isLive: true })
    .returning();

  res.status(201).json(stream);
});

streamsRouter.patch("/:id/end", requireAuth(), async (req, res) => {
  const [stream] = await db.select().from(streams).where(eq(streams.id, req.params.id));
  if (!stream) return res.status(404).json({ error: "not_found" });
  if (stream.creatorId !== req.user!.id && req.user!.role !== "admin") {
    return res.status(403).json({ error: "forbidden" });
  }

  const [updated] = await db
    .update(streams)
    .set({ isLive: false, endedAt: new Date() })
    .where(eq(streams.id, req.params.id))
    .returning();

  emitStreamEnded(stream.id);
  res.json(updated);
});

streamsRouter.get("/live", async (_req, res) => {
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

streamsRouter.get("/:id", async (req, res) => {
  const [stream] = await db.select().from(streams).where(eq(streams.id, req.params.id));
  if (!stream) return res.status(404).json({ error: "not_found" });
  res.json(stream);
});
