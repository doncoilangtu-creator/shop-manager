"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/require-user";
import type { ActionResult } from "@/lib/actions/_shared";
import { accountingErrorMessage } from "@/lib/accounting/errors";
import { vnDate } from "@/lib/time";
import { purchaseInputSchema, validatePurchaseBusiness } from "@/lib/purchases/schema";

const firstIssue = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "Dữ liệu không hợp lệ";
const refresh = (billId?: string) => {
  revalidatePath("/purchases");
  if (billId) revalidatePath(`/purchases/${billId}`);
  revalidatePath("/inventory");
  revalidatePath("/suppliers");
  revalidatePath("/", "layout");
};

export type PurchaseResult = { bill_id: string; bill_no: string; subtotal: number; vat: number; total: number };

/** Lập phiếu mua có chứng từ MỘT lần gọi RPC `post_purchase_bill` (nhập kho + công nợ NCC + sổ cái, VAT vào giá vốn). */
export async function createPurchaseAction(payload: unknown): Promise<ActionResult<PurchaseResult>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const parsed = purchaseInputSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const d = parsed.data;
  const biz = validatePurchaseBusiness(d);
  if (biz) return { ok: false, error: biz };
  const { data, error } = await auth.supabase.rpc("post_purchase_bill", {
    p_supplier_id: d.supplier_id,
    p_bill_date: d.bill_date ?? vnDate(),
    p_due_date: d.due_date ?? null,
    p_lines: d.lines.map((l) => ({ product_id: l.product_id, qty: l.qty, unit_cost: l.unit_cost, vat_rate: l.vat_rate })),
    p_supplier_ref: d.supplier_ref ?? null,
    p_memo: d.memo ?? null,
  });
  if (error) {
    if (error.code === "23505" || /uq_pb_supplier_ref/.test(error.message)) return { ok: false, error: "Số chứng từ của nhà cung cấp này đã được nhập trước đó." };
    return { ok: false, error: accountingErrorMessage(error.message) };
  }
  const r = (data ?? {}) as Record<string, unknown>;
  refresh();
  return { ok: true, data: { bill_id: String(r.bill_id ?? ""), bill_no: String(r.bill_no ?? ""), subtotal: Number(r.subtotal ?? 0), vat: Number(r.vat ?? 0), total: Number(r.total ?? 0) } };
}

/** Hủy phiếu mua: đảo bút toán, hoàn kho đúng giá trị đã nhập. Chặn nếu đã chi tiền hoặc hàng đã bán hết. */
export async function voidPurchaseAction(billId: string, reason: string): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!z.string().uuid().safeParse(billId).success) return { ok: false, error: "Phiếu mua không hợp lệ" };
  if (reason.trim().length < 3) return { ok: false, error: "Cần nhập lý do hủy" };
  const { error } = await auth.supabase.rpc("reverse_purchase_bill", { p_bill_id: billId, p_date: vnDate(), p_reason: reason.trim() });
  if (error) return { ok: false, error: accountingErrorMessage(error.message) };
  refresh(billId);
  return { ok: true, data: undefined };
}
