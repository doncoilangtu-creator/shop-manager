"use server";

import { requireUser } from "@/lib/auth/require-user";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formDataToObject, pgErrorMessage, type ActionResult } from "@/lib/actions/_shared";
import { createAdminClient } from "@/lib/supabase/admin";

const supplierSchema = z.object({
  name: z.string().min(1, "Tên bắt buộc").max(255),
  tax_code: z.string().max(40).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  email: z.string().email("Email không hợp lệ").or(z.literal("")).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  contact_person: z.string().max(120).optional().nullable(),
  bank_account: z.string().max(120).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

export type SupplierInput = z.infer<typeof supplierSchema>;

const debtLineSchema = z.object({
  amount: z.coerce.number().min(0.01, "Số tiền > 0"),
  due_date: z.string().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export type DebtLineInput = z.infer<typeof debtLineSchema>;

export type { ActionResult };

function cleanInput(formData: FormData): Record<string, unknown> {
  return formDataToObject(formData, []);
}

export async function createSupplier(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const parsed = supplierSchema.safeParse(cleanInput(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("suppliers")
    .insert({
      name: parsed.data.name,
      tax_code: parsed.data.tax_code ?? null,
      phone: parsed.data.phone ?? null,
      email: parsed.data.email || null,
      address: parsed.data.address ?? null,
      contact_person: parsed.data.contact_person ?? null,
      bank_account: parsed.data.bank_account ?? null,
      notes: parsed.data.notes ?? null,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  // Insert initial debts if any
  const amountValues = formData.getAll("debt_amount").map(String);
  const dueDateValues = formData.getAll("debt_due_date").map(String);
  const notesValues = formData.getAll("debt_notes").map(String);

  const debtRows: { supplier_id: string; amount: number; due_date: string | null; notes: string | null }[] = [];
  for (let i = 0; i < amountValues.length; i++) {
    const amt = parseFloat(amountValues[i]);
    if (!amt || amt <= 0) continue;
    debtRows.push({
      supplier_id: data.id,
      amount: amt,
      due_date: dueDateValues[i] || null,
      notes: notesValues[i] || null,
    });
  }
  if (debtRows.length > 0) {
    const { error: debtErr } = await supabase.from("supplier_debts").insert(debtRows);
    if (debtErr) {
      // Roll back supplier
      await supabase.from("suppliers").delete().eq("id", data.id);
      return { ok: false, error: `Lỗi ghi công nợ: ${debtErr.message}` };
    }
  }

  revalidatePath("/suppliers");
  return { ok: true, data: { id: data.id } };
}

export async function updateSupplier(
  id: string,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const parsed = supplierSchema.safeParse(cleanInput(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("suppliers")
    .update({
      name: parsed.data.name,
      tax_code: parsed.data.tax_code ?? null,
      phone: parsed.data.phone ?? null,
      email: parsed.data.email || null,
      address: parsed.data.address ?? null,
      contact_person: parsed.data.contact_person ?? null,
      bank_account: parsed.data.bank_account ?? null,
      notes: parsed.data.notes ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };

  // Insert new debt rows
  const amountValues = formData.getAll("debt_amount").map(String);
  const dueDateValues = formData.getAll("debt_due_date").map(String);
  const notesValues = formData.getAll("debt_notes").map(String);

  const debtRows: { supplier_id: string; amount: number; due_date: string | null; notes: string | null }[] = [];
  for (let i = 0; i < amountValues.length; i++) {
    const amt = parseFloat(amountValues[i]);
    if (!amt || amt <= 0) continue;
    debtRows.push({
      supplier_id: id,
      amount: amt,
      due_date: dueDateValues[i] || null,
      notes: notesValues[i] || null,
    });
  }
  if (debtRows.length > 0) {
    const { error: debtErr } = await supabase.from("supplier_debts").insert(debtRows);
    if (debtErr) {
      return { ok: false, error: `Lỗi ghi công nợ: ${debtErr.message}` };
    }
  }

  revalidatePath("/suppliers");
  revalidatePath(`/suppliers/${id}`);
  return { ok: true, data: { id } };
}

export async function deleteSupplier(id: string): Promise<ActionResult<null>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const supabase = createAdminClient();

  // A supplier with accounting history (purchase bills / payments) must be kept for the books.
  const [bills, pays, debts] = await Promise.all([
    supabase.from("purchase_bills").select("id").eq("supplier_id", id).limit(1),
    supabase.from("payments").select("id").eq("supplier_id", id).limit(1),
    supabase.from("supplier_debts").select("id").eq("supplier_id", id).eq("paid", false).limit(1),
  ]);
  const failed = [bills, pays, debts].find((r) => r.error);
  if (failed?.error) return { ok: false, error: pgErrorMessage(failed.error) };
  if ((bills.data?.length ?? 0) > 0 || (pays.data?.length ?? 0) > 0) {
    return { ok: false, error: "Không thể xóa: nhà cung cấp đã có phiếu nhập/chi tiền trong sổ kế toán." };
  }
  if ((debts.data?.length ?? 0) > 0) {
    return { ok: false, error: "Không thể xóa: nhà cung cấp còn công nợ chưa trả." };
  }

  const { error } = await supabase.from("suppliers").delete().eq("id", id);
  if (error) return { ok: false, error: pgErrorMessage(error) };
  revalidatePath("/suppliers");
  return { ok: true, data: null };
}

export async function toggleSupplierDebtPaid(
  debtId: string,
  paid: boolean,
): Promise<ActionResult<null>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("supplier_debts")
    .update({
      paid,
      paid_at: paid ? new Date().toISOString() : null,
    })
    .eq("id", debtId)
    .select("supplier_id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/suppliers/${data.supplier_id}`);
  revalidatePath("/suppliers");
  return { ok: true, data: null };
}

export async function deleteSupplierDebt(debtId: string): Promise<ActionResult<null>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("supplier_debts")
    .delete()
    .eq("id", debtId)
    .select("supplier_id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/suppliers/${data.supplier_id}`);
  revalidatePath("/suppliers");
  return { ok: true, data: null };
}
