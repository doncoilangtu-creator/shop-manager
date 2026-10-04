import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "APP_URL"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  vi.resetModules();
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("getSupabase", () => {
  it("throws a clear error when env is missing", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { getSupabase } = await import("../src/lib/supabase");
    expect(() => getSupabase()).toThrow(/Missing SUPABASE_URL/);
  });

  it("creates (and memoizes) a client when env is present", async () => {
    process.env.SUPABASE_URL = "https://dummy.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy";
    const { getSupabase } = await import("../src/lib/supabase");
    const a = getSupabase();
    expect(a).toBe(getSupabase());
  });
});

describe("appLink", () => {
  it("joins APP_URL and path without double slashes", async () => {
    process.env.APP_URL = "https://shop.example.com/";
    const { appLink } = await import("../src/lib/supabase");
    expect(appLink("/sign/abc")).toBe("https://shop.example.com/sign/abc");
    expect(appLink("sign/abc")).toBe("https://shop.example.com/sign/abc");
  });

  it("falls back to localhost", async () => {
    delete process.env.APP_URL;
    const { appLink } = await import("../src/lib/supabase");
    expect(appLink("/x")).toBe("http://localhost:3000/x");
  });
});
