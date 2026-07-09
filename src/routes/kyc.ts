import { Router } from "express";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { kycSubmissions, creatorProfiles, auditEvents } from "../db/schema.js";
import { requireAuth } from "../auth/middleware.js";

export const kycRouter = Router();

const kycSchema = z.object({
  fullName: z.string().min(2),
  dob: z.string(), // ISO date
  idType: z.string(),
  idNumber: z.string(),
  country: z.string().length(2),
  docUrl: z.string().url().optional(),
}).strict();

kycRouter.post("/", requireAuth(), async (req, res) => {
  const parsed = kycSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });

  const [submission] = await db
    .insert(kycSubmissions)
    .values({ userId: req.user!.id, ...parsed.data, status: "pending" })
    .returning();

  await db
    .update(creatorProfiles)
    .set({ kycStatus: "pending", payoutCountry: parsed.data.country, updatedAt: new Date() })
    .where(eq(creatorProfiles.userId, req.user!.id));

  await db.insert(auditEvents).values({
    actorId: req.user!.id,
    action: "kyc_submitted",
    targetType: "kyc_submission",
    targetId: submission.id,
    ip: req.ip,
    ua: req.header("user-agent"),
  });

  res.status(201).json({ id: submission.id, status: submission.status });
});

kycRouter.get("/", requireAuth(), async (req, res) => {
  const [profile] = await db
    .select()
    .from(creatorProfiles)
    .where(eq(creatorProfiles.userId, req.user!.id));

  const [latest] = await db
    .select()
    .from(kycSubmissions)
    .where(eq(kycSubmissions.userId, req.user!.id))
    .orderBy(desc(kycSubmissions.createdAt))
    .limit(1);

  res.json({
    kycStatus: profile?.kycStatus ?? "none",
    latestSubmission: latest
      ? { id: latest.id, status: latest.status, createdAt: latest.createdAt, country: latest.country }
      : null,
  });
});
