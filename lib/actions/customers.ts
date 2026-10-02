"use server";

import { requireUser } from "@/lib/auth/require-user";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formDataToObject, pgErrorMessage, type ActionResult } from "@/lib/actions/_shared";
import { createAdminClient } from "@/lib/supabase/admin";

const customerSchema = z.object({
  type: z.enum(["retail", "business"]),
  name: z.string().min(1, "Tên bắt buộc").max(255),
  phone: z.string().max(40).optional().nullable(),
  email: z.string().email("Email không hợp lệ").or(z.literal("")).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  tax_code: z.string().max(40).optional().nullable(),
  contact_person: z.string().max(120).optional().nullable(),
  contact_phone: z.string().max(40).optional().nullable(),
  debt_limit: z.coerce.number().min(0).default(0),
  notes: z.string().max(2000).optional().nullable(),
  tags: z.array(z.string().min(1).max(40)).default([]),
});

export type CustomerInput = z.infer<typeof customerSchema>;
export type { ActionResult };

function cleanInput(formData: FormData): Record<string, unknown> {
  return formDataToObject(formData, ["tags"]);
}

export async function createCustomer(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const parsed = customerSchema.safeParse(cleanInput(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("customers")
    .insert({
      type: parsed.data.type,
      name: parsed.data.name,
      phone: parsed.data.phone ?? null,
      email: parsed.data.email || null,
      address: parsed.data.address ?? null,
      tax_code: parsed.data.tax_code ?? null,
      contact_person: parsed.data.contact_person ?? null,
      contact_phone: parsed.data.contact_phone ?? null,
      debt_limit: parsed.data.debt_limit,
      notes: parsed.data.notes ?? null,
      tags: parsed.data.tags,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  revalidatePath("/customers");
  return { ok: true, data: { id: data.id } };
}

export async function updateCustomer(
  id: string,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const parsed = customerSchema.safeParse(cleanInput(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("customers")
    .update({
      type: parsed.data.type,
      name: parsed.data.name,
      phone: parsed.data.phone ?? null,
      email: parsed.data.email || null,
      address: parsed.data.address ?? null,
      tax_code: parsed.data.tax_code ?? null,
      contact_person: parsed.data.contact_person ?? null,
      contact_phone: parsed.data.contact_phone ?? null,
      debt_limit: parsed.data.debt_limit,
      notes: parsed.data.notes ?? null,
      tags: parsed.data.tags,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/customers");
  revalidatePath(`/customers/${id}`);
  return { ok: true, data: { id } };
}

export async function deleteCustomer(id: string): Promise<ActionResult<null>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const supabase = createAdminClient();

  // Anything that references the customer blocks deletion (the DB also enforces RESTRICT, migration 0003/0006).
  const checks = await Promise.all([
    supabase.from("quotations").select("id").eq("customer_id", id).limit(1),
    supabase.from("maintenance_tickets").select("id").eq("customer_id", id).limit(1),
    supabase.from("maintenance_contracts").select("id").eq("customer_id", id).limit(1),
    supabase.from("customer_debts").select("id").eq("customer_id", id).limit(1),
    supabase.from("sales_invoices").select("id").eq("customer_id", id).limit(1),
    supabase.from("payments").select("id").eq("customer_id", id).limit(1),
  ]);
  const failed = checks.find((r) => r.error);
  if (failed?.error) return { ok: false, error: pgErrorMessage(failed.error) };
  const reasons = [
    "báo giá", "ticket bảo trì", "hợp đồng bảo trì", "công nợ", "hóa đơn bán hàng", "phiếu thu",
  ];
  const hit = checks.findIndex((r) => (r.data?.length ?? 0) > 0);
  if (hit >= 0) {
    return { ok: false, error: `Không thể xóa: khách hàng đang có ${reasons[hit]} liên quan.` };
  }

  const { error } = await supabase.from("customers").delete().eq("id", id);
  if (error) return { ok: false, error: pgErrorMessage(error) };
  revalidatePath("/customers");
  return { ok: true, data: null };
}
