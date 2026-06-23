/**
 * Maintenance business logic helpers.
 * - ticket status workflow
 * - signature token lifecycle
 * - signature count helpers
 *
 * Server-side only (imports @supabase/ssr).
 */

// server-only marker omitted (server-only package not installed)
import { randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type {
  TicketStatus,
  SignatureToken,
} from "@/types/db";

/** Allowed next-status transitions from current state. */
export const TICKET_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  received: ["assigned", "in_progress", "closed"],
  assigned: ["in_progress", "waiting_parts", "received"],
  in_progress: ["waiting_parts", "completed", "assigned"],
  waiting_parts: ["in_progress", "completed"],
  completed: ["awaiting_signature", "in_progress"],
  awaiting_signature: ["signed", "in_progress"],
  signed: ["closed"],
  closed: [],
};

// cancelled isn't a real enum value in the schema; we keep the keys exhaustive
// for TS to be happy. The transitions table above intentionally omits 'cancelled'
// (the workflow terminates in closed).

/** Compute the next set of buttons we should show for a ticket. */
export function nextStatuses(current: TicketStatus): TicketStatus[] {
  return TICKET_TRANSITIONS[current] ?? [];
}

/** Human label for status (Vietnamese). */
export function statusLabel(s: TicketStatus): string {
  return (
    {
      received: "Tiếp nhận",
      assigned: "Đã phân công",
      in_progress: "Đang xử lý",
      waiting_parts: "Chờ linh kiện",
      completed: "Hoàn thành",
      awaiting_signature: "Chờ ký",
      signed: "Đã ký",
      closed: "Đóng",
    } as Record<TicketStatus, string>
  )[s];
}

/** Status → badge variant. */
export function statusVariant(
  s: TicketStatus,
): "default" | "secondary" | "destructive" | "outline" | "success" | "warning" {
  switch (s) {
    case "received":
      return "secondary";
    case "assigned":
      return "outline";
    case "in_progress":
      return "default";
    case "waiting_parts":
      return "warning";
    case "completed":
    case "signed":
      return "success";
    case "closed":
      return "secondary";
    case "awaiting_signature":
      return "warning";
  }
}

export function priorityLabel(p: "low" | "medium" | "high"): string {
  return { low: "Thấp", medium: "Trung bình", high: "Cao" }[p];
}

export function priorityVariant(p: "low" | "medium" | "high") {
  return (
    { low: "secondary", medium: "outline", high: "destructive" } as const
  )[p];
}

export function contractStatusLabel(s: "active" | "expired" | "cancelled") {
  return { active: "Đang hiệu lực", expired: "Hết hạn", cancelled: "Đã hủy" }[s];
}

/** Generate a URL-safe random token. */
export function generateToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Create (or reuse) an unused signature token for a ticket.
 * Returns the token row including the absolute URL.
 *
 * If there's already an unused unexpired token, we reuse it.
 */
export async function issueSignatureToken(
  ticketId: string,
  ttlDays = 14,
): Promise<{ token: string; url: string; expiresAt: string } | null> {
  const admin = createAdminClient();

  // Look for a fresh unused token first
  const { data: existing } = await admin
    .from("signature_tokens")
    .select("id, token, expires_at")
    .eq("ticket_id", ticketId)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  if (existing) {
    const url = `${baseUrl.replace(/\/$/, "")}/sign/${existing.token}`;
    return { token: existing.token, url, expiresAt: existing.expires_at };
  }

  const token = generateToken();
  const expiresAt = new Date(
    Date.now() + ttlDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data, error } = await admin
    .from("signature_tokens")
    .insert({
      ticket_id: ticketId,
      token,
      expires_at: expiresAt,
    })
    .select("token, expires_at")
    .single();

  if (error || !data) return null;
  const url = `${baseUrl.replace(/\/$/, "")}/sign/${data.token}`;
  return { token: data.token, url, expiresAt: data.expires_at };
}

/**
 * Fetch a ticket's signature metadata.
 * Returns which roles have signed and the latest active token (if any).
 */
export async function getTicketSignatureState(ticketId: string) {
  const supabase = createClient();
  const [sigs, tokens] = await Promise.all([
    supabase
      .from("signatures")
      .select("id, signer_role, signer_name, signed_at, signature_png")
      .eq("ticket_id", ticketId)
      .order("signed_at", { ascending: true }),
    supabase
      .from("signature_tokens")
      .select("id, token, expires_at, used_at, created_at")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    signatures: sigs.data ?? [],
    latestToken: (tokens.data as SignatureToken | null) ?? null,
  };
}

/** Check if a ticket has both customer + technician signatures. */
export function hasBothSignatures(
  signatures: Array<{ signer_role: "customer" | "technician" }>,
): boolean {
  const roles = new Set(signatures.map((s) => s.signer_role));
  return roles.has("customer") && roles.has("technician");
}