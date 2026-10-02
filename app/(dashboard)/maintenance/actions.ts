"use server";

import { requireUser } from "@/lib/auth/require-user";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ContractSchema, ContractUpdateSchema, LogSchema, TicketSchema, contractPatchFromForm, parseParts, slaDueAt } from "@/lib/maintenance-input";
import { nextStatuses, issueSignatureToken } from "@/lib/maintenance";
import { generateCode } from "@/lib/codes";
import { insertWithGeneratedCode, pgErrorMessage } from "@/lib/actions/_shared";
import type { TicketStatus } from "@/types/db";

// ============================================================
// MAINTENANCE CONTRACT ACTIONS  (user client => RLS "is_staff" applies; no service-role needed)
// ============================================================

export async function createContractAction(formData: FormData) {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const parsed = ContractSchema.safeParse({
    customer_id: formData.get("customer_id"),
    code: formData.get("code") || undefined,
    start_date: formData.get("start_date"),
    end_date: formData.get("end_date"),
    scope: formData.get("scope") || "",
    devices_description: formData.get("devices_description") || "",
    monthly_fee: formData.get("monthly_fee") || 0,
    sla_hours: formData.get("sla_hours") || 24,
    status: formData.get("status") || "active",
  });
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues.map((i) => i.message).join(", ") };
  }

  const { data, error } = await insertWithGeneratedCode<{ id: string }>(
    () => parsed.data.code ?? generateCode("HD"),
    (code) => auth.supabase.from("maintenance_contracts").insert({ ...parsed.data, code }).select("id").single(),
    parsed.data.code ? 1 : 5, // a code typed by the user is never silently replaced
  );
  if (error || !data) return { ok: false as const, error: error ? pgErrorMessage(error) : "Không tạo được hợp đồng" };
  revalidatePath("/maintenance/contracts");
  redirect(`/maintenance/contracts/${data.id}`);
}

export async function updateContractAction(id: string, formData: FormData) {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const parsed = ContractUpdateSchema.safeParse(contractPatchFromForm(formData));
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues.map((i) => i.message).join(", ") };
  }
  const patch = parsed.data;
  if (patch.start_date && patch.end_date && patch.end_date < patch.start_date) {
    return { ok: false as const, error: "Ngày kết thúc phải sau ngày bắt đầu" };
  }
  if (Object.keys(patch).length === 0) return { ok: false as const, error: "Không có thay đổi" };

  const { error } = await auth.supabase.from("maintenance_contracts").update(patch).eq("id", id);
  if (error) return { ok: false as const, error: pgErrorMessage(error) };
  revalidatePath(`/maintenance/contracts/${id}`);
  revalidatePath("/maintenance/contracts");
  return { ok: true as const };
}

export async function deleteContractAction(id: string) {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const { error } = await auth.supabase.from("maintenance_contracts").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") return { ok: false as const, error: "Không thể xóa: hợp đồng đã có ticket bảo trì. Hãy chuyển trạng thái sang Đã hủy." };
    return { ok: false as const, error: pgErrorMessage(error) };
  }
  revalidatePath("/maintenance/contracts");
  return { ok: true as const };
}

// ============================================================
// MAINTENANCE TICKET ACTIONS
// ============================================================

export async function createTicketAction(formData: FormData) {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const parsed = TicketSchema.safeParse({
    customer_id: formData.get("customer_id"),
    contract_id: formData.get("contract_id") || null,
    title: formData.get("title"),
    description: formData.get("description") || "",
    priority: formData.get("priority") || "medium",
    device_info: formData.get("device_info") || "",
  });
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues.map((i) => i.message).join(", ") };
  }

  let slaHours: number | null = null;
  if (parsed.data.contract_id) {
    const { data: c, error: cErr } = await auth.supabase
      .from("maintenance_contracts")
      .select("sla_hours, customer_id, status")
      .eq("id", parsed.data.contract_id)
      .maybeSingle();
    if (cErr) return { ok: false as const, error: pgErrorMessage(cErr) };
    if (!c) return { ok: false as const, error: "Không tìm thấy hợp đồng" };
    if (c.customer_id !== parsed.data.customer_id) return { ok: false as const, error: "Hợp đồng không thuộc khách hàng này" };
    if (c.status !== "active") return { ok: false as const, error: "Hợp đồng không còn hiệu lực" };
    slaHours = c.sla_hours;
  }

  const { data, error } = await insertWithGeneratedCode<{ id: string }>(
    () => generateCode("TK"),
    (code) =>
      auth.supabase
        .from("maintenance_tickets")
        .insert({ ...parsed.data, code, status: "received", sla_due_at: slaDueAt(new Date(), slaHours) })
        .select("id")
        .single(),
  );
  if (error || !data) return { ok: false as const, error: error ? pgErrorMessage(error) : "Không tạo được ticket" };
  revalidatePath("/maintenance/tickets");
  redirect(`/maintenance/tickets/${data.id}`);
}

export async function updateTicketStatusAction(id: string, newStatus: string) {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const { data: ticket, error: tErr } = await auth.supabase
    .from("maintenance_tickets")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (tErr) return { ok: false as const, error: pgErrorMessage(tErr) };
  if (!ticket) return { ok: false as const, error: "Không tìm thấy ticket" };

  const allowed = nextStatuses(ticket.status as TicketStatus) as string[];
  if (!allowed.includes(newStatus)) {
    return { ok: false as const, error: `Không thể chuyển từ ${ticket.status} sang ${newStatus}` };
  }

  const updates: Record<string, unknown> = { status: newStatus };
  if (newStatus === "in_progress") updates.started_at = new Date().toISOString();
  if (newStatus === "completed") updates.completed_at = new Date().toISOString();

  // optimistic guard: only move the ticket if it is still in the status we validated against
  const { data: moved, error } = await auth.supabase
    .from("maintenance_tickets")
    .update(updates)
    .eq("id", id)
    .eq("status", ticket.status)
    .select("id");
  if (error) return { ok: false as const, error: pgErrorMessage(error) };
  if (!moved || moved.length === 0) return { ok: false as const, error: "Ticket vừa được cập nhật bởi người khác, hãy tải lại trang" };

  revalidatePath(`/maintenance/tickets/${id}`);
  revalidatePath("/maintenance/tickets");
  return { ok: true as const };
}

// ============================================================
// MAINTENANCE LOG ACTIONS
// ============================================================

export async function addMaintenanceLogAction(formData: FormData) {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const parsed = LogSchema.safeParse({
    ticket_id: formData.get("ticket_id"),
    log_type: formData.get("log_type") || "note",
    description: formData.get("description"),
    work_done: formData.get("work_done") || "",
    parts_used: parseParts(formData.get("parts_used")),
  });
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues.map((i) => i.message).join(", ") };
  }
  // performed_by is a uuid FK to auth.users: it is the logged-in user (the old form sent free text, which always failed)
  const { error } = await auth.supabase.from("maintenance_logs").insert({
    ...parsed.data,
    performed_by: auth.user.id,
    performed_at: new Date().toISOString(),
  });
  if (error) return { ok: false as const, error: pgErrorMessage(error) };
  revalidatePath(`/maintenance/tickets/${parsed.data.ticket_id}`);
  return { ok: true as const };
}

// ============================================================
// SIGNATURE TOKEN ACTIONS
// ============================================================

export async function issueSignatureTokenAction(ticketId: string) {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!z.string().uuid().safeParse(ticketId).success) return { ok: false as const, error: "Mã ticket không hợp lệ" };
  const res = await issueSignatureToken(ticketId, 7);
  if (!res) return { ok: false as const, error: "Không tạo được liên kết ký" };
  return { ok: true as const, url: res.url };
}
