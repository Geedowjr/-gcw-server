import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { webhookEvents } from "../db/schema.js";
import { getGateway } from "../gateways/index.js";
import { queues } from "../jobs/queues.js";
import { logger } from "../logger.js";

export const webhooksRouter = Router();

/**
 * All four handlers share the same shape:
 *  1. verify signature over the RAW body (timing-safe)
 *  2. dedupe via webhook_events.external_id (unique constraint)
 *  3. enqueue processing job
 *  4. return 200 fast — actual side effects happen in the webhook-retry/payout jobs
 *
 * NOTE: index.ts must mount this router with an express.raw() body parser (wildcard type)
 * (or an equivalent raw-body parser) BEFORE the global express.json() so that
 * `req.body` here is a Buffer, not a parsed object.
 */
function makeHandler(source: "stripe" | "mpesa" | "evcplus" | "edahab") {
  return async (req: any, res: any) => {
    const gateway = getGateway(source);
    const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));

    const signatureValid = gateway.verifyWebhookSignature(rawBody, req.headers);
    if (!signatureValid) {
      logger.warn({ source }, "webhook signature verification failed");
      return res.status(401).json({ error: "invalid_signature" });
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      payload = {};
    }

    const externalId = gateway.extractExternalId(payload);

    const existing = await db.select().from(webhookEvents).where(eq(webhookEvents.externalId, externalId));
    if (existing.length > 0) {
      // Already processed (or in-flight) — ack fast, don't reprocess.
      return res.status(200).json({ ok: true, deduped: true });
    }

    const [event] = await db
      .insert(webhookEvents)
      .values({ source, externalId, signatureValid: true, payload })
      .onConflictDoNothing()
      .returning();

    if (event) {
      await queues.webhookRetry.add("process-webhook", { webhookEventId: event.id });
    }

    res.status(200).json({ ok: true });
  };
}

webhooksRouter.post("/stripe", makeHandler("stripe"));
webhooksRouter.post("/mpesa", makeHandler("mpesa"));
webhooksRouter.post("/evcplus", makeHandler("evcplus"));
webhooksRouter.post("/edahab", makeHandler("edahab"));


