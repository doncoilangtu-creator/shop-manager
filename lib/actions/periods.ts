"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/require-user";
import { formDataToObject, type ActionResult } from "@/lib/actions/_shared";
import { accountingErrorMessage } from "@/lib/accounting/errors";

const periodSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  reason: z.string().trim().max(500).optional(),
});

/** Khóa kỳ kế toán. Quyền owner được kiểm tra lại trong RPC (SECURITY DEFINER), không chỉ ở UI. */
export async function closePeriodAction(formData: FormData): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const p = periodSchema.safeParse(formDataToObject(formData));
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const { error } = await auth.supabase.rpc("close_period", { p_year: p.data.year, p_month: p.data.month });
  if (error) return { ok: false, error: accountingErrorMessage(error.message) };
  revalidatePath("/reports/accounting");
  revalidatePath("/books");
  return { ok: true, data: undefined };
}

export async function reopenPeriodAction(formData: FormData): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const p = periodSchema.safeParse(formDataToObject(formData));
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const { error } = await auth.supabase.rpc("reopen_period", { p_year: p.data.year, p_month: p.data.month, p_reason: p.data.reason ?? "" });
  if (error) return { ok: false, error: accountingErrorMessage(error.message) };
  revalidatePath("/reports/accounting");
  revalidatePath("/books");
  return { ok: true, data: undefined };
}

/** Hạch toán các phiếu kho không có chứng từ (nhập/xuất tay, kiểm kê, bot) vào sổ cái để TK 156 khớp giá trị tồn kho. */
export async function postStockAdjustmentsAction(): Promise<ActionResult<{ posted: unknown }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const { vnDate } = await import("@/lib/time");
  const { data, error } = await auth.supabase.rpc("post_stock_adjustments", { p_date: vnDate() });
  if (error) return { ok: false, error: accountingErrorMessage(error.message) };
  revalidatePath("/reports/accounting");
  revalidatePath("/books");
  return { ok: true, data: { posted: data } };
}
