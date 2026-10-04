import { createRateLimiter } from "@/lib/rate-limit";

// best-effort throttles for the public signing endpoints (see lib/rate-limit.ts)
export let ipLimiter = createRateLimiter({ limit: 30, windowMs: 60_000 });
export let tokenLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

/** Test helper: start from empty counters. */
export function resetSignThrottle() {
  ipLimiter = createRateLimiter({ limit: 30, windowMs: 60_000 });
  tokenLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });
}
