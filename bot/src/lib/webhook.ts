import { timingSafeEqual } from "crypto";
import type { IncomingMessage, ServerResponse } from "http";

export type WebhookOptions = {
  path: string;
  secret: string;                         // required: Telegram echoes it in X-Telegram-Bot-Api-Secret-Token
  maxBytes?: number;                      // default 1 MiB (Telegram updates are a few KB)
  handleUpdate: (update: unknown) => Promise<unknown>;
  log?: (msg: string, err?: unknown) => void;
};

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Node http listener: POST <path> with the correct secret header, bounded body, JSON only. */
export function createWebhookListener(o: WebhookOptions) {
  if (!o.secret || o.secret.length < 16) throw new Error("WEBHOOK_SECRET must be set (>= 16 chars) in webhook mode");
  const max = o.maxBytes ?? 1024 * 1024;
  const log = o.log ?? ((m, e) => console.error(m, e));
  return (req: IncomingMessage, res: ServerResponse) => {
    const reply = (code: number, body: string) => { if (!res.headersSent) { res.statusCode = code; res.end(body); } };
    const pathOnly = (req.url ?? "").split("?")[0];
    if (req.method === "GET" && pathOnly === "/healthz") return reply(200, "ok");
    if (req.method !== "POST" || pathOnly !== o.path) return reply(404, "not found");
    const given = String(req.headers["x-telegram-bot-api-secret-token"] ?? "");
    if (!safeEqual(given, o.secret)) return reply(401, "unauthorized");
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > max) return reply(413, "too large");

    const chunks: Buffer[] = []; let size = 0; let aborted = false;
    req.on("data", (c: Buffer) => {
      if (aborted) return;
      size += c.length;
      if (size > max) { aborted = true; reply(413, "too large"); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", async () => {
      if (aborted) return;
      let update: unknown;
      try { update = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return reply(400, "bad json"); }
      try { await o.handleUpdate(update); reply(200, "ok"); }
      catch (e) {
        // Always 200: a non-2xx makes Telegram redeliver the same update, which could repeat a non-idempotent command (e.g. a sale).
        log("Webhook handle error:", e); reply(200, "ok");
      }
    });
    req.on("error", () => { aborted = true; });
  };
}
