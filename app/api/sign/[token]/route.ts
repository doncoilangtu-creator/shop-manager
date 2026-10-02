import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getTokenInfo, signWithToken, SIGN_ERROR_HTTP } from "@/lib/signing";

// Public endpoint (whitelisted in middleware). All DB access is server-side via
// the sign_ticket() RPC (atomic, single-use token, state-aware) — see migration 0003.
const MAX_BODY_BYTES = 400_000;

const bodySchema = z.object({
  ticketId: z.string().uuid(),
  signerName: z.string().trim().min(1).max(200),
  signerRole: z.enum(["customer", "technician"]),
  signaturePng: z.string().min(20).max(300_000), // base64 PNG
});

export async function POST(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;

  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Chữ ký quá lớn" }, { status: 413 });
  }
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body không hợp lệ", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null;
  const result = await signWithToken({
    token,
    ticketId: parsed.data.ticketId,
    signerName: parsed.data.signerName,
    signerRole: parsed.data.signerRole,
    signaturePng: parsed.data.signaturePng,
    ip,
    userAgent: req.headers.get("user-agent"),
  });
  if (!result.ok) {
    const { status, message } = SIGN_ERROR_HTTP[result.error];
    return NextResponse.json({ error: message, code: result.error }, { status });
  }
  return NextResponse.json({ ok: true, status: result.status, bothSigned: result.bothSigned });
}

export async function GET(_req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  // Lightweight token info for diagnostics / preflight (no ticket details).
  const info = await getTokenInfo(token);
  if (!info) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({
    ticketId: info.ticket_id,
    expiresAt: info.expires_at,
    usedAt: info.used_at,
  });
}
