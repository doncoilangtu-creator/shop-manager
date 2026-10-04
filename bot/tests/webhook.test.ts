import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import { createWebhookListener } from "../src/lib/webhook";

const SECRET = "s3cret-s3cret-s3cret";
let server: Server | null = null;
afterEach(async () => { await new Promise((r) => (server ? server.close(() => r(null)) : r(null))); server = null; });

async function start(handle: (u: unknown) => Promise<unknown>, max?: number) {
  const listener = createWebhookListener({ path: "/telegram", secret: SECRET, handleUpdate: handle, maxBytes: max, log: () => {} });
  server = createServer(listener);
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}
const post = (base: string, path: string, body: string, headers: Record<string, string> = {}) =>
  fetch(base + path, { method: "POST", body, headers: { "content-type": "application/json", ...headers } });

describe("webhook listener", () => {
  it("refuses to start without a strong secret", () => {
    expect(() => createWebhookListener({ path: "/t", secret: "", handleUpdate: async () => {} })).toThrow(/WEBHOOK_SECRET/);
    expect(() => createWebhookListener({ path: "/t", secret: "short", handleUpdate: async () => {} })).toThrow();
  });
  it("accepts a correct secret and passes the parsed update", async () => {
    const h = vi.fn(async () => {});
    const base = await start(h);
    const r = await post(base, "/telegram", '{"update_id":1}', { "x-telegram-bot-api-secret-token": SECRET });
    expect(r.status).toBe(200);
    expect(h).toHaveBeenCalledWith({ update_id: 1 });
  });
  it("rejects missing/wrong secret with 401 and never calls the handler", async () => {
    const h = vi.fn(async () => {});
    const base = await start(h);
    expect((await post(base, "/telegram", "{}")).status).toBe(401);
    expect((await post(base, "/telegram", "{}", { "x-telegram-bot-api-secret-token": "x".repeat(SECRET.length) })).status).toBe(401);
    expect(h).not.toHaveBeenCalled();
  });
  it("404 for other paths/methods, health check works", async () => {
    const base = await start(async () => {});
    expect((await post(base, "/other", "{}", { "x-telegram-bot-api-secret-token": SECRET })).status).toBe(404);
    expect((await fetch(base + "/telegram")).status).toBe(404);
    expect((await fetch(base + "/healthz")).status).toBe(200);
  });
  it("413 for bodies over the limit (declared or streamed) without calling the handler", async () => {
    const h = vi.fn(async () => {});
    const base = await start(h, 1000);
    const r = await post(base, "/telegram", JSON.stringify({ x: "a".repeat(5000) }), { "x-telegram-bot-api-secret-token": SECRET });
    expect(r.status).toBe(413);
    expect(h).not.toHaveBeenCalled();
  });
  it("400 on invalid JSON; 200 even if the handler throws (no Telegram retry storm)", async () => {
    const base = await start(async () => { throw new Error("boom"); });
    const hdr = { "x-telegram-bot-api-secret-token": SECRET };
    expect((await post(base, "/telegram", "{not json", hdr)).status).toBe(400);
    expect((await post(base, "/telegram", "{}", hdr)).status).toBe(200);
  });
});
