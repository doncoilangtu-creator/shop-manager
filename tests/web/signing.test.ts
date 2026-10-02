import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { rpc, maybeSingle, createAdminClient } = vi.hoisted(() => {
  const rpc = vi.fn();
  const maybeSingle = vi.fn();
  const from = vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }));
  return { rpc, maybeSingle, createAdminClient: vi.fn(() => ({ rpc, from })) };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
// The signing route must NOT depend on the cookie session at all.
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => {
    throw new Error("signing flow must not use the cookie/user client");
  },
}));

import { parseSignError, signWithToken, getTokenInfo, SIGN_ERROR_HTTP } from "@/lib/signing";
import { POST, GET } from "@/app/api/sign/[token]/route";
import { resetSignThrottle } from "@/lib/sign-throttle";

const TOKEN = "abcdefghijklmnop1234567890";
const TICKET = "11111111-1111-4111-8111-111111111111";
const body = (o: Record<string, unknown> = {}) => ({
  ticketId: TICKET, signerName: "Nguyen Van A", signerRole: "customer", signaturePng: "A".repeat(60), ...o,
});
const post = (b: unknown, headers: Record<string, string> = {}) =>
  POST(
    new NextRequest(`http://localhost/api/sign/${TOKEN}`, {
      method: "POST", body: JSON.stringify(b), headers: { "content-type": "application/json", ...headers },
    }),
    { params: Promise.resolve({ token: TOKEN }) },
  );

beforeEach(() => { rpc.mockReset(); maybeSingle.mockReset(); createAdminClient.mockClear(); resetSignThrottle(); });

describe("parseSignError", () => {
  it.each(["token_used", "token_expired", "already_signed", "ticket_not_signable", "signature_too_large"])("maps %s", (k) => {
    expect(parseSignError(`ERROR: ${k}`)).toBe(k);
  });
  it("unknown → unknown", () => expect(parseSignError("boom")).toBe("unknown"));
  it("every code has a sane http status", () => {
    for (const v of Object.values(SIGN_ERROR_HTTP)) expect(v.status).toBeGreaterThanOrEqual(400);
  });
});

describe("signWithToken / getTokenInfo", () => {
  it("passes all fields to the sign_ticket RPC", async () => {
    rpc.mockResolvedValue({ data: { status: "signed", both_signed: true }, error: null });
    const r = await signWithToken({ token: TOKEN, ticketId: TICKET, signerName: "A", signerRole: "technician", signaturePng: "x", ip: "1.1.1.1", userAgent: "ua" });
    expect(r).toEqual({ ok: true, status: "signed", bothSigned: true });
    expect(rpc).toHaveBeenCalledWith("sign_ticket", { p_token: TOKEN, p_ticket_id: TICKET, p_signer_name: "A", p_role: "technician", p_png: "x", p_ip: "1.1.1.1", p_ua: "ua" });
  });
  it("rejects malformed tokens without touching the DB", async () => {
    expect(await getTokenInfo("short")).toBeNull();
    expect(await getTokenInfo("a/b/../c".padEnd(30, "x"))).toBeNull();
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});

describe("POST /api/sign/[token]", () => {
  it("200 on success", async () => {
    rpc.mockResolvedValue({ data: { status: "awaiting_signature", both_signed: false }, error: null });
    const res = await post(body());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "awaiting_signature", bothSigned: false });
  });
  it.each([
    ["token_used", 410], ["token_expired", 410], ["token_not_found", 404], ["already_signed", 409],
    ["ticket_not_signable", 409], ["token_ticket_mismatch", 400],
  ])("DB error %s → HTTP %i", async (code, status) => {
    rpc.mockResolvedValue({ data: null, error: { message: code } });
    const res = await post(body());
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
  });
  it("400 on invalid body, never calls the RPC", async () => {
    for (const b of [body({ signerRole: "admin" }), body({ ticketId: "x" }), body({ signaturePng: "short" }), body({ signerName: "  " }), null]) {
      expect((await post(b)).status).toBe(400);
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it("413 when the payload is too large (header and schema)", async () => {
    expect((await post(body(), { "content-length": "999999" })).status).toBe(413);
    expect((await post(body({ signaturePng: "A".repeat(300_001) }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("records client ip from x-forwarded-for", async () => {
    rpc.mockResolvedValue({ data: { status: "awaiting_signature", both_signed: false }, error: null });
    await post(body(), { "x-forwarded-for": "9.9.9.9, 10.0.0.1" });
    expect(rpc.mock.calls[0][1].p_ip).toBe("9.9.9.9");
  });
});

describe("GET /api/sign/[token]", () => {
  it("404 for unknown token, token metadata otherwise (no ticket details)", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await GET(new NextRequest("http://x/api/sign/" + TOKEN), { params: Promise.resolve({ token: TOKEN }) })).status).toBe(404);
    maybeSingle.mockResolvedValue({ data: { id: "i", ticket_id: TICKET, expires_at: "2030-01-01", used_at: null, maintenance_tickets: { id: TICKET, code: "TK-1", title: "secret", description: "d", customers: { name: "N" } } }, error: null });
    const res = await GET(new NextRequest("http://x/api/sign/" + TOKEN), { params: Promise.resolve({ token: TOKEN }) });
    expect(await res.json()).toEqual({ ticketId: TICKET, expiresAt: "2030-01-01", usedAt: null });
  });
});

describe("throttling of the public endpoint", () => {
  it("returns 429 + Retry-After after 10 POSTs/min for the same token, before touching the DB", async () => {
    const mk = () => new NextRequest("http://x/api/sign/tok", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "7.7.7.7" }, body: "{}" });
    let last: Response | null = null;
    for (let i = 0; i < 11; i++) last = await POST(mk(), { params: Promise.resolve({ token: "tok" }) });
    expect(last!.status).toBe(429);
    expect(last!.headers.get("Retry-After")).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a different token from another IP is not affected", async () => {
    const mk = (ip: string) => new NextRequest("http://x/api/sign/t2", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: "{}" });
    for (let i = 0; i < 11; i++) await POST(mk("7.7.7.7"), { params: Promise.resolve({ token: "t1" }) });
    const r = await POST(mk("8.8.8.8"), { params: Promise.resolve({ token: "t2" }) });
    expect(r.status).toBe(400);   // reaches body validation
  });
});
