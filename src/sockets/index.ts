import type { Server as HttpServer } from "http";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createRedisClient } from "../redis.js";
import { verifyAccessToken } from "../auth/jwt.js";
import { corsOrigins } from "../env.js";
import { logger } from "../logger.js";

let io: Server | undefined;

export function initSockets(httpServer: HttpServer) {
  io = new Server(httpServer, {
    cors: { origin: corsOrigins, credentials: true },
    transports: ["websocket", "polling"],
  });

  const pubClient = createRedisClient();
  const subClient = pubClient.duplicate();
  io.adapter(createAdapter(pubClient, subClient));

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    const walletToken = socket.handshake.auth?.walletToken as string | undefined;

    if (token) {
      try {
        const payload = verifyAccessToken(token);
        socket.data.userId = payload.sub;
        socket.data.role = payload.role;
        socket.data.username = payload.username;
      } catch {
        // fall through to anonymous — invalid/expired tokens don't hard-fail the socket
      }
    }
    if (walletToken) socket.data.walletToken = walletToken;
    next();
  });

  io.on("connection", (socket) => {
    logger.debug({ userId: socket.data.userId, walletToken: socket.data.walletToken }, "socket connected");

    if (socket.data.role === "creator" && socket.data.userId) {
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
