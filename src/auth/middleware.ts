import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { verifyAccessToken } from "./jwt.js";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; role: string; username: string };
    }
  }
}

export function requireAuth() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.header("authorization") || req.header("Authorization");
    if (!header?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "unauthorized" });
    }
    try {
      const payload = verifyAccessToken(header.slice(7));
      req.user = { id: payload.sub, role: payload.role, username: payload.username };
      next();
    } catch {
      return res.status(401).json({ error: "invalid_or_expired_token" });
    }
  };
}

export function optionalAuth() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.header("authorization");
    if (header?.startsWith("Bearer ")) {
      try {
        const payload = verifyAccessToken(header.slice(7));
        req.user = { id: payload.sub, role: payload.role, username: payload.username };
      } catch {
        // ignore — anonymous
      }
    }
    next();
  };
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "forbidden" });
    }
    next();
  };
}

export function requireVerified() {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "unauthorized" });
    const [u] = await db.select().from(users).where(eq(users.id, req.user.id));
    if (!u?.emailVerifiedAt) {
      return res.status(403).json({ error: "email_not_verified" });
    }
    next();
  };
}

/** Requires a valid TOTP code in req.body.code (or already-verified 2FA session). */
export function require2FA() {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "unauthorized" });
    const [u] = await db.select().from(users).where(eq(users.id, req.user.id));
    if (!u) return res.status(401).json({ error: "unauthorized" });

    if (!u.totpEnabled) {
      return res.status(403).json({ error: "2fa_required", message: "Enable 2FA before this action." });
    }

    const code = req.body?.totp || req.header("x-totp-code");
    if (!code) return res.status(403).json({ error: "2fa_code_required" });

    const { verifyTotp } = await import("./totp.js");
    if (!u.totpSecret || !verifyTotp(u.totpSecret, code)) {
      return res.status(403).json({ error: "invalid_2fa_code" });
    }
    next();
  };
}
