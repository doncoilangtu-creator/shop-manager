import { describe, expect, it } from "vitest";
import { clientIp, createRateLimiter } from "@/lib/rate-limit";

describe("rate limiter", () => {
  it("allows `limit` hits per window then blocks with Retry-After", () => {
    const rl = createRateLimiter({ limit: 3, windowMs: 1000 });
    expect([1, 2, 3].map((i) => rl.hit("k", i).ok)).toEqual([true, true, true]);
    const r = rl.hit("k", 10);
    expect(r.ok).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThanOrEqual(1);
  });
  it("window slides and keys are independent", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(rl.hit("a", 0).ok).toBe(true);
    expect(rl.hit("b", 0).ok).toBe(true);
    expect(rl.hit("a", 500).ok).toBe(false);
    expect(rl.hit("a", 1001).ok).toBe(true);
  });
  it("bounds memory", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 1e9, maxKeys: 100 });
    for (let i = 0; i < 1000; i++) rl.hit("k" + i, i);
    // the oldest keys were evicted: an early key is allowed again
    expect(rl.hit("k0", 2000).ok).toBe(true);
  });
  it("clientIp prefers the first x-forwarded-for entry", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("1.2.3.4");
    expect(clientIp(new Headers({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
