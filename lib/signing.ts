import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Public signing flow (/sign/[token], /api/sign/[token]).
 * Anonymous visitors have NO table privileges (migration 0003): everything goes
 * through the service-role client, independent of any cookie/session, so a
 * logged-in owner opening the link behaves exactly like a customer.
 */

export type SignError =
  | "token_not_found" | "token_used" | "token_expired" | "token_ticket_mismatch"
  | "already_signed" | "ticket_not_signable" | "ticket_not_found"
  | "signature_invalid" | "signature_too_large" | "signer_name_invalid" | "unknown";

export const SIGN_ERROR_HTTP: Record<SignError, { status: number; message: string }> = {
  token_not_found: { status: 404, message: "Token không tồn tại" },
  token_used: { status: 410, message: "Token đã được sử dụng" },
  token_expired: { status: 410, message: "Token đã hết hạn" },
  token_ticket_mismatch: { status: 400, message: "Token không khớp ticket" },
  already_signed: { status: 409, message: "Vai trò này đã ký rồi" },
  ticket_not_signable: { status: 409, message: "Ticket chưa sẵn sàng để ký (cần ở trạng thái Hoàn thành/Chờ ký)" },
  ticket_not_found: { status: 404, message: "Không tìm thấy ticket" },
  signature_invalid: { status: 400, message: "Chữ ký không hợp lệ" },
  signature_too_large: { status: 413, message: "Chữ ký quá lớn" },
  signer_name_invalid: { status: 400, message: "Tên người ký không hợp lệ" },
  unknown: { status: 500, message: "Không lưu được chữ ký" },
};

const KNOWN = Object.keys(SIGN_ERROR_HTTP).filter((k) => k !== "unknown") as SignError[];

export function parseSignError(message: string | undefined): SignError {
  const m = message ?? "";
  return KNOWN.find((k) => m.includes(k)) ?? "unknown";
}

export type TokenInfo = {
  id: string;
  ticket_id: string;
  expires_at: string;
  used_at: string | null;
  ticket: { id: string; code: string; title: string; description: string | null; customer_name: string | null } | null;
};

export async function getTokenInfo(token: string): Promise<TokenInfo | null> {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) return null;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("signature_tokens")
    .select("id, ticket_id, expires_at, used_at, maintenance_tickets(id, code, title, description, customers(name))")
    .eq("token", token)
    .maybeSingle();
  if (error || !data) return null;
  const t = Array.isArray(data.maintenance_tickets) ? data.maintenance_tickets[0] : data.maintenance_tickets;
  const c = t ? (Array.isArray(t.customers) ? t.customers[0] : t.customers) : null;
  return {
    id: data.id,
    ticket_id: data.ticket_id,
    expires_at: data.expires_at,
    used_at: data.used_at,
    ticket: t
      ? { id: t.id, code: t.code, title: t.title, description: t.description, customer_name: c?.name ?? null }
      : null,
  };
}

export async function signWithToken(input: {
  token: string; ticketId: string; signerName: string; signerRole: "customer" | "technician";
  signaturePng: string; ip: string | null; userAgent: string | null;
}): Promise<{ ok: true; status: string; bothSigned: boolean } | { ok: false; error: SignError }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("sign_ticket", {
    p_token: input.token,
    p_ticket_id: input.ticketId,
    p_signer_name: input.signerName,
    p_role: input.signerRole,
    p_png: input.signaturePng,
    p_ip: input.ip,
    p_ua: input.userAgent,
  });
  if (error) return { ok: false, error: parseSignError(error.message) };
  const r = data as { status: string; both_signed: boolean };
  return { ok: true, status: r.status, bothSigned: r.both_signed };
}

export async function getSignedRoles(ticketId: string): Promise<Set<string>> {
  const admin = createAdminClient();
  const { data } = await admin.from("signatures").select("signer_role").eq("ticket_id", ticketId);
  return new Set((data ?? []).map((r) => r.signer_role as string));
}
