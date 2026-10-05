"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/require-user";
import type { ActionResult } from "@/lib/actions/_shared";
import { accountingErrorMessage } from "@/lib/accounting/errors";
import { vnDate } from "@/lib/time";
import { moneyAccountInputSchema, openingInputSchema, transferInputSchema } from "@/lib/money/schema";

const firstIssue = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "Dữ liệu không hợp lệ";
const refresh = () => {
  revalidatePath("/money");
  revalidatePath("/sales/new");
  revalidatePath("/books/tax-forms");
  revalidatePath("/", "layout");
};

/** Thêm / sửa tài khoản tiền (chỉ chủ hộ — kiểm tra trong RPC SECURITY DEFINER). Số tài khoản đầy đủ lưu ở bảng riêng chỉ chủ hộ đọc (dùng cho 01/BK-STK); nhân viên chỉ thấy bản che ****1234. */
export async function saveMoneyAccountAction(payload: unknown): Promise<ActionResult<{ id: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const parsed = moneyAccountInputSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const d = parsed.data;
  const isNew = !d.id;
  const p: Record<string, unknown> = {
    label: d.label,
    provider: d.provider ?? "",
    holder: d.holder ?? "",
    tax_notified: d.kind === "cash" ? false : d.tax_notified,
    tax_notified_at: d.kind === "cash" || !d.tax_notified ? null : d.tax_notified_at ?? null,
    is_default: d.is_default,
    active: d.active,
  };
  if (isNew) p.kind = d.kind;
  if (d.account_no) p.account_no = d.account_no;
  if (d.location_id !== undefined) p.location_id = d.location_id ?? "";
  const { data, error } = await auth.supabase.rpc("upsert_money_account", { p_id: d.id ?? null, p });
  if (error) return { ok: false, error: accountingErrorMessage(error.message) };
  refresh();
  return { ok: true, data: { id: String((data as { id?: string } | null)?.id ?? "") } };
}

/** Nhập số dư đầu kỳ cho một tài khoản (Nợ 111/112 · Có 411) — chỉ chủ hộ. */
export async function postMoneyOpeningAction(payload: unknown): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const parsed = openingInputSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const d = parsed.data;
  const { error } = await auth.supabase.rpc("post_money_opening", { p_account_id: d.account_id, p_amount: d.amount, p_date: d.date, p_memo: d.memo ?? undefined });
  if (error) return { ok: false, error: accountingErrorMessage(error.message) };
  refresh();
  return { ok: true, data: undefined };
}

/** Chuyển tiền nội bộ giữa hai tài khoản (nộp/rút tiền mặt, chuyển ngân hàng ↔ ví). Không phải doanh thu/chi phí. */
export async function transferMoneyAction(payload: unknown): Promise<ActionResult<{ transfer_no: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const parsed = transferInputSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const d = parsed.data;
  const { data, error } = await auth.supabase.rpc("post_money_transfer", { p_from: d.from, p_to: d.to, p_amount: d.amount, p_date: d.date ?? vnDate(), p_memo: d.memo ?? undefined });
  if (error) return { ok: false, error: accountingErrorMessage(error.message) };
  refresh();
  return { ok: true, data: { transfer_no: String((data as { transfer_no?: string } | null)?.transfer_no ?? "") } };
}

/** Hủy phiếu chuyển tiền bằng bút toán đảo (sổ cái không sửa/xóa). */
export async function reverseMoneyTransferAction(transferId: string, reason: string): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!z.string().uuid().safeParse(transferId).success) return { ok: false, error: "Phiếu chuyển tiền không hợp lệ" };
  if (reason.trim().length < 3) return { ok: false, error: "Cần nhập lý do hủy" };
  const { error } = await auth.supabase.rpc("reverse_money_transfer", { p_transfer_id: transferId, p_date: vnDate(), p_reason: reason.trim() });
  if (error) return { ok: false, error: accountingErrorMessage(error.message) };
  refresh();
  return { ok: true, data: undefined };
}
