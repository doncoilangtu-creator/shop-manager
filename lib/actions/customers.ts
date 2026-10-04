"use server";

import { requireUser } from "@/lib/auth/require-user";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formDataToObject, type ActionResult } from "@/lib/actions/_shared";
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

  // Check references
  const [{ data: quotes }, { data: tickets }] = await Promise.all([
    supabase.from("quotations").select("id").eq("customer_id", id).limit(1),
    supabase.from("maintenance_tickets").select("id").eq("customer_id", id).limit(1),
  ]);

  if (quotes && quotes.length > 0) {
    return {
      ok: false,
      error: "Không thể xóa: khách hàng đang có báo giá liên quan.",
    };
  }
  if (tickets && tickets.length > 0) {
    return {
      ok: false,
      error: "Không thể xóa: khách hàng đang có ticket bảo trì liên quan.",
    };
  }

  const { error } = await supabase.from("customers").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/customers");
  return { ok: true, data: null };
}
