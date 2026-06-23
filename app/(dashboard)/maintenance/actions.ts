"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// ============================================================
// MAINTENANCE CONTRACT ACTIONS
// ============================================================

const ContractSchema = z.object({
  customer_id: z.string().uuid(),
  code: z.string().min(1).max(50).optional(),
  start_date: z.string().min(1),
  end_date: z.string().min(1),
  scope: z.string().optional().default(""),
  devices_description: z.string().optional().default(""),
  monthly_fee: z.coerce.number().min(0).default(0),
  sla_hours: z.coerce.number().int().min(1).default(24),
  status: z.enum(["active", "expired", "cancelled"]).default("active"),
});

function generateContractCode(): string {
  const year = new Date().getFullYear();
  const rand = randomBytes(2).toString("hex").toUpperCase();
  return `HD-${year}-${rand}`;
}

export async function createContractAction(formData: FormData) {
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

  const admin = createAdminClient();
  const code = parsed.data.code ?? generateContractCode();
  const { data, error } = await admin
    .from("maintenance_contracts")
    .insert({ ...parsed.data, code })
    .select("id")
    .single();

  if (error) return { ok: false as const, error: error.message };
  revalidatePath("/maintenance/contracts");
  redirect(`/maintenance/contracts/${data.id}`);
}

export async function updateContractAction(id: string, formData: FormData) {
  const parsed = ContractSchema.partial().safeParse({
    customer_id: formData.get("customer_id"),
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

  const admin = createAdminClient();
  const { error } = await admin.from("maintenance_contracts").update(parsed.data).eq("id", id);

  if (error) return { ok: false as const, error: error.message };
  revalidatePath(`/maintenance/contracts/${id}`);
  revalidatePath("/maintenance/contracts");
  return { ok: true as const };
}

export async function deleteContractAction(id: string) {
  const admin = createAdminClient();
  const { error } = await admin.from("maintenance_contracts").delete().eq("id", id);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath("/maintenance/contracts");
  return { ok: true as const };
}

// ============================================================
// MAINTENANCE TICKET ACTIONS
// ============================================================

const TicketSchema = z.object({
  customer_id: z.string().uuid(),
  contract_id: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(200),
  description: z.string().optional().default(""),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  device_info: z.string().optional().default(""),
});

function generateTicketCode(): string {
  const ts = Date.now().toString(36).toUpperCase();
  return `TK-${ts.slice(-6)}`;
}

export async function createTicketAction(formData: FormData) {
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

  const admin = createAdminClient();
  const code = generateTicketCode();
  const slaHours = parsed.data.contract_id
    ? await getContractSla(parsed.data.contract_id)
    : 24;
  const slaDueAt = new Date(Date.now() + slaHours * 60 * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from("maintenance_tickets")
    .insert({
      ...parsed.data,
      code,
      status: "received",
      sla_due_at: slaDueAt,
    })
    .select("id")
    .single();

  if (error) return { ok: false as const, error: error.message };
  revalidatePath("/maintenance/tickets");
  redirect(`/maintenance/tickets/${data.id}`);
}

async function getContractSla(contractId: string): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("maintenance_contracts")
    .select("sla_hours")
    .eq("id", contractId)
    .single();
  return data?.sla_hours ?? 24;
}

const TICKET_STATUS_TRANSITIONS: Record<string, string[]> = {
  received: ["assigned", "in_progress", "closed"],
  assigned: ["in_progress", "completed", "closed"],
  in_progress: ["waiting_parts", "completed", "closed"],
  waiting_parts: ["in_progress", "completed", "closed"],
  completed: ["awaiting_signature", "closed"],
  awaiting_signature: ["signed", "completed"],
  signed: ["closed"],
  closed: [],
};

export async function updateTicketStatusAction(id: string, newStatus: string) {
  const admin = createAdminClient();
  const { data: ticket } = await admin
    .from("maintenance_tickets")
    .select("status")
    .eq("id", id)
    .single();

  if (!ticket) return { ok: false as const, error: "Không tìm thấy ticket" };

  const allowed = TICKET_STATUS_TRANSITIONS[ticket.status] ?? [];
  if (!allowed.includes(newStatus)) {
    return { ok: false as const, error: `Không thể chuyển từ ${ticket.status} sang ${newStatus}` };
  }

  const updates: Record<string, unknown> = { status: newStatus };
  if (newStatus === "in_progress") updates.started_at = new Date().toISOString();
  if (newStatus === "completed") updates.completed_at = new Date().toISOString();

  const { error } = await admin.from("maintenance_tickets").update(updates).eq("id", id);
  if (error) return { ok: false as const, error: error.message };

  revalidatePath(`/maintenance/tickets/${id}`);
  revalidatePath("/maintenance/tickets");
  return { ok: true as const };
}

// ============================================================
// MAINTENANCE LOG ACTIONS
// ============================================================

const LogSchema = z.object({
  ticket_id: z.string().uuid(),
  log_type: z.enum(["periodic", "incident", "note"]).default("note"),
  description: z.string().min(1),
  work_done: z.string().optional().default(""),
  parts_used: z.array(z.string()).optional().default([]),
  performed_by: z.string().min(1),
});

export async function addMaintenanceLogAction(formData: FormData) {
  const partsRaw = formData.get("parts_used");
  const parts = partsRaw
    ? (partsRaw as string).split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const parsed = LogSchema.safeParse({
    ticket_id: formData.get("ticket_id"),
    log_type: formData.get("log_type") || "note",
    description: formData.get("description"),
    work_done: formData.get("work_done") || "",
    parts_used: parts,
    performed_by: formData.get("performed_by"),
  });

  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues.map((i) => i.message).join(", ") };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("maintenance_logs").insert({
    ...parsed.data,
    performed_at: new Date().toISOString(),
  });

  if (error) return { ok: false as const, error: error.message };
  revalidatePath(`/maintenance/tickets/${parsed.data.ticket_id}`);
  return { ok: true as const };
}

// ============================================================
// SIGNATURE TOKEN ACTIONS
// ============================================================

export async function issueSignatureTokenAction(ticketId: string) {
  const admin = createAdminClient();
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await admin.from("signature_tokens").insert({
    ticket_id: ticketId,
    token,
    expires_at: expiresAt,
  });

  if (error) return { ok: false as const, error: error.message };

  const url = `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/sign/${token}`;
  return { ok: true as const, url };
}