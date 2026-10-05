"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { formDataToObject, type ActionResult } from "@/lib/actions/_shared";
import { accountingErrorMessage } from "@/lib/accounting/errors";
import { formBool, locationSchema, profileSchema } from "@/lib/hkd/profile";

const firstIssue = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "Dữ liệu không hợp lệ";

/** Lưu hồ sơ hộ kinh doanh. Quyền owner được kiểm tra trong RPC (SECURITY DEFINER), không chỉ ở UI. */
export async function saveBusinessProfileAction(formData: FormData): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const parsed = profileSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { error } = await auth.supabase.rpc("set_business_profile", { p: parsed.data });
  if (error) return { ok: false, error: accountingErrorMessage(error.message) };
  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

/** Thêm / sửa / đóng địa điểm kinh doanh (owner). */
export async function saveBusinessLocationAction(formData: FormData): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const raw = formDataToObject(formData);
  raw.is_hq = formBool(raw.is_hq);
  const parsed = locationSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { error } = await auth.supabase.rpc("upsert_business_location", { p: parsed.data });
  if (error) return { ok: false, error: accountingErrorMessage(error.message) };
  revalidatePath("/settings");
  return { ok: true, data: undefined };
}
