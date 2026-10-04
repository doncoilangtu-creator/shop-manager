import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Smoke/characterization test of the current auth middleware behaviour.
// C1: only /login, /sign/* and /api/sign/* are public; other /api/* → 401 JSON.
const getUser = vi.fn();
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser } }),
}));

import { middleware } from "@/middleware";

const req = (path: string) => new NextRequest(new URL(path, "http://localhost:3000"));
const loggedOut = () => getUser.mockResolvedValue({ data: { user: null } });
const loggedIn = () => getUser.mockResolvedValue({ data: { user: { id: "u1" } } });

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy";
});

describe("middleware (unauthenticated)", () => {
  beforeEach(loggedOut);

  it("redirects protected pages to /login with redirectTo", async () => {
    const res = await middleware(req("/customers"));
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("redirectTo")).toBe("/customers");
  });

  it("redirects the dashboard root", async () => {
    const res = await middleware(req("/"));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });

  it.each(["/login", "/sign/abc123"])("lets %s through", async (p) => {
    const res = await middleware(req(p));
    expect(res.headers.get("location")).toBeNull();
    expect(res.status).toBe(200);
  });

  it("lets the public signing API through", async () => {
    for (const p of ["/api/sign/abc", "/api/sign/abc/"]) {
      const res = await middleware(req(p));
      expect(res.status, p).toBe(200);
    }
  });

  it.each(["/api/quotations/x/pdf", "/api/other", "/api/signature", "/api/signx/abc", "/api"])(
    "answers 401 JSON (not a redirect) for %s",
    async (p) => {
      const res = await middleware(req(p));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
    },
  );
});

describe("middleware (authenticated)", () => {
  beforeEach(loggedIn);

  it("serves protected API routes to a logged-in user", async () => {
    const res = await middleware(req("/api/quotations/x/pdf"));
    expect(res.status).toBe(200);
  });

  it("serves protected pages", async () => {
    const res = await middleware(req("/inventory"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("bounces /login to the dashboard", async () => {
    const res = await middleware(req("/login?x=1"));
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/");
    expect(loc.search).toBe("");
  });
});
