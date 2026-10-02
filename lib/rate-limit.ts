/**
 * Small in-memory sliding-window limiter for the PUBLIC signing endpoints.
 * Best effort only: on serverless each instance has its own memory, so this slows brute force /
 * accidental double-submits but is NOT the security boundary. The boundary is the 256-bit single-use
 * token enforced in SQL (sign_ticket). Use a shared store (Upstash/Redis) if hard limits are needed.
 */
export type RateLimiter = { hit(key: string, now?: number): { ok: boolean; retryAfterSec: number } };

export function createRateLimiter(opts: { limit: number; windowMs: number; maxKeys?: number }): RateLimiter {
  const hits = new Map<string, number[]>();
  const maxKeys = opts.maxKeys ?? 5000;
  return {
    hit(key, now = Date.now()) {
      const from = now - opts.windowMs;
      const arr = (hits.get(key) ?? []).filter((t) => t > from);
      if (arr.length >= opts.limit) {
        hits.set(key, arr);
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((arr[0] + opts.windowMs - now) / 1000)) };
      }
      arr.push(now);
      hits.set(key, arr);
      if (hits.size > maxKeys) {                       // bound memory: drop the oldest keys
        for (const k of hits.keys()) { hits.delete(k); if (hits.size <= maxKeys * 0.9) break; }
      }
      return { ok: true, retryAfterSec: 0 };
    },
  };
}

/** Client IP from proxy headers (Vercel sets x-forwarded-for); never trusted for security decisions. */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  return (xff ? xff.split(",")[0].trim() : headers.get("x-real-ip") || "unknown").slice(0, 64);
}
