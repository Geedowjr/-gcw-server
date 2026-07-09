import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { notifications } from "../db/schema.js";
import { requireAuth } from "../auth/middleware.js";

export const notificationsRouter = Router();

notificationsRouter.get("/", requireAuth(), async (req, res) => {
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, req.user!.id))
    .orderBy(desc(notifications.createdAt))
    .limit(50);
  res.json(rows);
});

notificationsRouter.post("/:id/read", requireAuth(), async (req, res) => {
  const [row] = await db.select().from(notifications).where(eq(notifications.id, req.params.id));
  if (!row || row.userId !== req.user!.id) return res.status(404).json({ error: "not_found" });

  await db.update(notifications).set({ readAt: new Date() }).where(eq(notifications.id, req.params.id));
  res.json({ ok: true });
});
