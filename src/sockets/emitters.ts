import { getIO } from "./index.js";
import { centsToUsd } from "../money.js";

export interface NewGiftEventPayload {
  id: string;
  giftName: string;
  senderName: string;
  coins: number;
  grossUsd: number;
  platformFeeUsd: number;
  creatorShareUsd: number;
  feePercentage: number;
  time: number;
}

/** Emits to both stream:<id> (if present) and creator:<id> rooms. Matches the
 * frontend's use-gift-socket.ts normalizer exactly — do not rename fields.
 * No-ops safely if Socket.io hasn't been initialized in this process (e.g.
 * tests, or the BullMQ worker process running standalone). */
export function emitGift(params: {
  streamId?: string | null;
  creatorId: string;
  giftEventId: string;
  giftName: string;
  senderName: string;
  coins: number;
  grossCents: number;
  platformFeeCents: number;
  creatorShareCents: number;
  feePct: number;
}) {
  const io = getIO();
  if (!io) return;

  const payload: NewGiftEventPayload = {
    id: params.giftEventId,
    giftName: params.giftName,
    senderName: params.senderName,
    coins: params.coins,
    grossUsd: centsToUsd(params.grossCents),
    platformFeeUsd: centsToUsd(params.platformFeeCents),
    creatorShareUsd: centsToUsd(params.creatorShareCents),
    feePercentage: Math.round(params.feePct * 100),
    time: Date.now(),
  };

  if (params.streamId) io.to(`stream:${params.streamId}`).emit("NEW_GIFT_EVENT", payload);
  io.to(`creator:${params.creatorId}`).emit("NEW_GIFT_EVENT", payload);
}

export function emitViewerCount(streamId: string, viewerCount: number) {
  getIO()?.to(`stream:${streamId}`).emit("VIEWER_COUNT", { streamId, viewerCount });
}

export function emitChallengeUpdate(challenge: Record<string, unknown>) {
  const io = getIO();
  if (io && challenge.streamId) io.to(`stream:${challenge.streamId}`).emit("CHALLENGE_UPDATE", challenge);
}

export function emitStreamEnded(streamId: string) {
  getIO()?.to(`stream:${streamId}`).emit("STREAM_ENDED", { streamId, time: Date.now() });
}

export function emitCashoutStatus(userId: string, cashout: Record<string, unknown>) {
  getIO()?.to(`creator:${userId}`).emit("CASHOUT_STATUS", cashout);
}
