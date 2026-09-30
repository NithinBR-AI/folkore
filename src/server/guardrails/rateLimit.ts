/**
 * In-memory rate limiter for /api/converse.
 *
 * Limits each IP to MAX_REQUESTS calls within WINDOW_MS.
 * Uses a sliding window — the counter resets after WINDOW_MS of inactivity.
 *
 * Suitable for single-process demo deployments. For multi-instance production,
 * replace with a Redis-backed store (e.g. rate-limiter-flexible).
 */

import type { Request, Response, NextFunction } from "express";

const WINDOW_MS    = 60_000; // 1 minute
const MAX_REQUESTS = 20;     // max calls per IP per window

interface Entry {
  count:     number;
  resetAt:   number;
}

const store = new Map<string, Entry>();

function getIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

export function rateLimitConverse(req: Request, res: Response, next: NextFunction): void {
  const ip  = getIp(req);
  const now = Date.now();

  const entry = store.get(ip);

  if (!entry || now > entry.resetAt) {
    store.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    next();
    return;
  }

  if (entry.count >= MAX_REQUESTS) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    res.setHeader("Retry-After", retryAfter);
    res.status(429).json({
      error: `Too many requests. Try again in ${retryAfter}s.`,
    });
    return;
  }

  entry.count++;
  next();
}

/** Clears the store — used in tests only. */
export function _resetRateLimitStore(): void {
  store.clear();
}
