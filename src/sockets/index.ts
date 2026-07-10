import type { Server as HttpServer } from "http";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { eq } from "drizzle-orm";
import { createRedisClient } from "../redis.js";
import { verifyAccessToken } from "../auth/jwt.js";
import { corsOrigins } from "../env.js";
import { logger } from "../logger.js";
import { db } from "../db/client.js";
import { creatorProfiles } from "../db/schema.js";

let io: Server | undefined;

export function initSockets(httpServer: HttpServer) {
  io = new Server(httpServer, {
    cors: { origin: corsOrigins, credentials: true },
    transports: ["websocket", "polling"],
  });

  const pubClient = createRedisClient();
  const subClient = pubClient.duplicate();
  io.adapter(createAdapter(pubClient, subClient));

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    const walletToken = socket.handshake.auth?.walletToken as string | undefined;
    const overlayToken = socket.handshake.auth?.overlayToken as string | undefined;

    if (token) {
      try {
        const payload = verifyAccessToken(token);
        socket.data.userId = payload.sub;
        socket.data.role = payload.role;
        socket.data.username = payload.username;
      } catch {
        // fall through to anonymous — invalid/expired tokens don't hard-fail the socket
      }
    } else if (overlayToken) {
      // OBS browser sources are separate, unauthenticated browser instances
      // with no shared login session — /overlay?token=... resolves straight
      // to the owning creator's userId so it can join creator:<userId>,
      // without needing an interactive login.
      try {
        const [profile] = await db
          .select()
          .from(creatorProfiles)
          .where(eq(creatorProfiles.overlayToken, overlayToken));
        if (profile) socket.data.userId = profile.userId;
      } catch {
        // fall through to anonymous — a DB hiccup here shouldn't hard-fail the socket
      }
    }
    if (walletToken) socket.data.walletToken = walletToken;
    next();
  });

  io.on("connection", (socket) => {
    logger.debug({ userId: socket.data.userId, walletToken: socket.data.walletToken }, "socket connected");

    // Every signed-up user gets a creatorProfiles row at signup (see
    // auth/routes.ts) and can receive gifts, regardless of their `role`
    // (role is reserved for the separate streams/challenges RBAC gate and
    // is never actually set to "creator" anywhere in this codebase — gating
    // this join on it meant no authenticated user ever received their own
    // NEW_GIFT_EVENT). Any authenticated socket joins its own creator room.
    if (socket.data.userId) {
      socket.join(`creator:${socket.data.userId}`);
    }

    socket.on("subscribe:stream", (streamId: string) => {
      if (typeof streamId === "string" && streamId.length > 0) {
        socket.join(`stream:${streamId}`);
      }
    });

    socket.on("unsubscribe:stream", (streamId: string) => {
      if (typeof streamId === "string") socket.leave(`stream:${streamId}`);
    });

    socket.on("disconnect", () => {
      logger.debug({ userId: socket.data.userId }, "socket disconnected");
    });
  });

  return io;
}

export function getIO(): Server | undefined {
  return io;
}
