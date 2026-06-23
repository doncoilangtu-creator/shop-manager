import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  ticketId: z.string().uuid(),
  signerName: z.string().min(1).max(200),
  signerRole: z.enum(["customer", "technician"]),
  signaturePng: z.string().min(20), // base64 PNG
});

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } },
) {
  const { token } = params;
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body không hợp lệ", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { ticketId, signerName, signerRole, signaturePng } = parsed.data;

  const supabase = createClient();

  // 1. Resolve the token (anon-readable per RLS policy).
  const { data: row, error: tokenErr } = await supabase
    .from("signature_tokens")
    .select("id, ticket_id, expires_at, used_at")
    .eq("token", token)
    .maybeSingle();

  if (tokenErr || !row) {
    return NextResponse.json({ error: "Token không tồn tại" }, { status: 404 });
  }
  if (row.used_at) {
    return NextResponse.json({ error: "Token đã được sử dụng" }, { status: 410 });
  }
  if (new Date(row.expires_at) < new Date()) {
    return NextResponse.json({ error: "Token đã hết hạn" }, { status: 410 });
  }
  if (row.ticket_id !== ticketId) {
    return NextResponse.json({ error: "Token không khớp ticket" }, { status: 400 });
  }

  // 2. Check this role is not already signed
  const { data: existing } = await supabase
    .from("signatures")
    .select("id")
    .eq("ticket_id", ticketId)
    .eq("signer_role", signerRole)
    .limit(1);
  if (existing && existing.length > 0) {
    return NextResponse.json(
      { error: `Vai trò "${signerRole}" đã ký rồi` },
      { status: 409 },
    );
  }

  // 3. Insert signature via anon-allowed policy.
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const ua = req.headers.get("user-agent") || "unknown";

  const { error: sigErr } = await supabase.from("signatures").insert({
    ticket_id: ticketId,
    signer_name: signerName,
    signer_role: signerRole,
    signature_png: signaturePng,
    ip_address: ip,
    user_agent: ua,
  });
  if (sigErr) {
    return NextResponse.json(
      { error: "Không lưu được chữ ký", details: sigErr.message },
      { status: 500 },
    );
  }

  // 4. Mark THIS token as used (admin client bypasses RLS for the update).
  const admin = createAdminClient();
  const { error: usedErr } = await admin
    .from("signature_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("id", row.id);
  if (usedErr) {
    // log-only; signature is already saved
    console.error("Failed to mark token used:", usedErr);
  }

  // 5. Mark OTHER unused tokens for the same ticket as used too (they're
  //    now stale — the current token has been consumed).
  await admin
    .from("signature_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("ticket_id", ticketId)
    .is("used_at", null)
    .neq("id", row.id);

  // 6. Advance ticket status:
  //    - if we now have BOTH customer + technician signatures → 'signed'
  //    - if we have just one (not the final) → 'awaiting_signature'
  //    - admin client used to bypass RLS for status update
  const { data: allSigs } = await admin
    .from("signatures")
    .select("signer_role")
    .eq("ticket_id", ticketId);
  const roles = new Set(
    (allSigs ?? []).map((s) => s.signer_role as string),
  );
  const bothSigned = roles.has("customer") && roles.has("technician");
  const newStatus = bothSigned ? "signed" : "awaiting_signature";
  const patch: Record<string, unknown> = { status: newStatus };
  if (bothSigned) {
    patch.completed_at = new Date().toISOString();
  }
  await admin
    .from("maintenance_tickets")
    .update(patch)
    .eq("id", ticketId);

  return NextResponse.json({ ok: true, status: newStatus, bothSigned });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } },
) {
  // Lightweight token info for diagnostics / preflight.
  const supabase = createClient();
  const { data } = await supabase
    .from("signature_tokens")
    .select("ticket_id, expires_at, used_at")
    .eq("token", params.token)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({
    ticketId: data.ticket_id,
    expiresAt: data.expires_at,
    usedAt: data.used_at,
  });
}