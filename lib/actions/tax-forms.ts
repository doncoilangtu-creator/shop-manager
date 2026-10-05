"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/require-user";
import type { ActionResult } from "@/lib/actions/_shared";
import { accountingErrorMessage } from "@/lib/accounting/errors";

const schema = z.object({
  ids: z.array(z.string().uuid()).min(1, "Chọn ít nhất một tài khoản đã kê khai").max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày nộp không hợp lệ"),
});

/** Đánh dấu đã nộp bảng kê 01/BK-STK cho các tài khoản đã chọn (chỉ chủ hộ — RPC tự kiểm tra). */
export async function markBkStkFiledAction(payload: unknown): Promise<ActionResult<{ count: number }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const { data, error } = await auth.supabase.rpc("mark_bk_stk_filed", { p_ids: parsed.data.ids, p_date: parsed.data.date });
  if (error) {
    if (error.message.includes("date_invalid")) return { ok: false, error: "Ngày nộp không hợp lệ (không được ở tương lai)" };
    if (error.message.includes("bk_stk_invalid")) return { ok: false, error: "Có tài khoản không cần kê khai hoặc không hợp lệ — tải lại trang rồi thử lại" };
    return { ok: false, error: accountingErrorMessage(error.message) };
  }
  revalidatePath("/books/tax-forms");
  revalidatePath("/money");
  revalidatePath("/", "layout");
  return { ok: true, data: { count: Number(data ?? 0) } };
}
