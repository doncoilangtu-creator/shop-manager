import { z } from "zod";

/** Pure validation/parsing for maintenance forms (kept out of the "use server" file so it is unit-testable). */
export const ContractSchema = z
  .object({
    customer_id: z.string().uuid("Chọn khách hàng"),
    code: z.string().min(1).max(50).optional(),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày bắt đầu không hợp lệ"),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày kết thúc không hợp lệ"),
    scope: z.string().max(4000).optional().default(""),
    devices_description: z.string().max(4000).optional().default(""),
    monthly_fee: z.coerce.number().min(0).max(1e12).default(0),
    sla_hours: z.coerce.number().int().min(1).max(24 * 365).default(24),
    status: z.enum(["active", "expired", "cancelled"]).default("active"),
  })
  .refine((v) => v.end_date >= v.start_date, { message: "Ngày kết thúc phải sau ngày bắt đầu", path: ["end_date"] });

export const ContractUpdateSchema = z
  .object({
    customer_id: z.string().uuid("Chọn khách hàng"),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày bắt đầu không hợp lệ"),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày kết thúc không hợp lệ"),
    scope: z.string().max(4000),
    devices_description: z.string().max(4000),
    monthly_fee: z.coerce.number().min(0).max(1e12),
    sla_hours: z.coerce.number().int().min(1).max(24 * 365),
    status: z.enum(["active", "expired", "cancelled"]),
  })
  .partial();

/**
 * Only fields that are actually present in the form are updated. The old code defaulted missing fields
 * (`status || "active"`, `scope || ""`, `monthly_fee || 0`), so any partial update silently reset them.
 */
export function contractPatchFromForm(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ["customer_id", "start_date", "end_date", "scope", "devices_description", "monthly_fee", "sla_hours", "status"]) {
    if (formData.has(k)) out[k] = formData.get(k);
  }
  return out;
}

export const TicketSchema = z.object({
  customer_id: z.string().uuid("Chọn khách hàng"),
  contract_id: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1, "Nhập tiêu đề").max(200),
  description: z.string().max(4000).optional().default(""),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  device_info: z.string().max(1000).optional().default(""),
});

export const LogSchema = z.object({
  ticket_id: z.string().uuid(),
  log_type: z.enum(["periodic", "incident", "note"]).default("note"),
  description: z.string().trim().min(1, "Nhập mô tả").max(4000),
  work_done: z.string().max(4000).optional().default(""),
  parts_used: z.array(z.string().max(120)).max(50).optional().default([]),
});

export function parseParts(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== "string") return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** SLA deadline for a ticket given contract SLA hours (default 24h). */
export function slaDueAt(now: Date, slaHours: number | null | undefined): string {
  return new Date(now.getTime() + (slaHours && slaHours > 0 ? slaHours : 24) * 3600_000).toISOString();
}
