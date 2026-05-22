import type { Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import type { User } from "@shared/schema";

// Augment Express Request to carry the authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

/** Read the sid cookie, validate the session, attach req.user. Returns 401 on failure. */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const sid = req.cookies?.sid as string | undefined;
  if (!sid) {
    return res.status(401).json({ error: "unauthenticated" });
  }
  try {
    const user = await storage.getSessionUser(sid);
    if (!user) {
      clearSessionCookie(res);
      return res.status(401).json({ error: "unauthenticated" });
    }
    req.user = user;
    next();
  } catch (e: any) {
    console.error("[auth] requireAuth error:", e.message);
    return res.status(401).json({ error: "unauthenticated" });
  }
}

/** Same as requireAuth but doesn't 401 — just sets req.user if session is valid. */
export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const sid = req.cookies?.sid as string | undefined;
  if (sid) {
    try {
      const user = await storage.getSessionUser(sid);
      if (user) req.user = user;
    } catch {
      // swallow — optional auth never errors
    }
  }
  next();
}

const isProd = process.env.NODE_ENV === "production";

export function setSessionCookie(res: Response, sessionId: string, expiresAt: number) {
  res.cookie("sid", sessionId, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    expires: new Date(expiresAt),
    path: "/",
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie("sid", { path: "/" });
}
