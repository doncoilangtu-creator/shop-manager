"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/require-user";
import type { ActionResult } from "@/lib/actions/_shared";
import { accountingErrorMessage } from "@/lib/accounting/errors";
import { vnDate } from "@/lib/time";
import { einvoiceSchema, returnInputSchema, saleInputSchema, validateSaleBusiness } from "@/lib/sales/schema";

const firstIssue = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "Dữ liệu không hợp lệ";
const refresh = (saleId?: string) => {
  revalidatePath("/sales");
  if (saleId) revalidatePath(`/sales/${saleId}`);
  revalidatePath("/reports/revenue");
  revalidatePath("/", "layout");
};

export type SaleResult = { invoice_id: string; invoice_no: string; total: number; paid: number; debt: number; is_walkin: boolean };

/** Tạo đơn bán MỘT lần gọi RPC nguyên tử `post_sale_hkd` (kho + thu tiền + công nợ + sổ cái). Giá đã gồm thuế. */
export async function createSaleAction(payload: unknown): Promise<ActionResult<SaleResult>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const parsed = saleInputSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const d = parsed.data;
  const biz = validateSaleBusiness(d);
  if (biz) return { ok: false, error: biz };
  const { data, error } = await auth.supabase.rpc("post_sale_hkd", {
    p_customer_id: d.customer_id ?? null,
    p_date: d.date ?? vnDate(),
    p_lines: d.lines.map((l) => ({
      product_id: l.product_id ?? null,
      description: l.description ?? null,
      qty: l.qty,
      unit_price: l.unit_price,
      discount_pct: l.discount_pct,
      tax_group: l.tax_group ?? null,
    })),
    p_payments: d.payments.map((p) => ({ method: p.method, amount: p.amount, note: p.note ?? null, money_account_id: p.money_account_id ?? null })),
    p_channel: d.channel,
    p_location_id: null,
    p_buyer: d.buyer && Object.values(d.buyer).some(Boolean) ? d.buyer : null,
    p_memo: d.memo ?? null,
    p_due_date: d.due_date ?? null,
    p_einvoice: d.einvoice ? d.einvoice : null,
    p_allow_over_limit: false,
  });
  if (error) return { ok: false, error: accountingErrorMessage(error.message) };
  const r = (data ?? {}) as Record<string, unknown>;
  refresh();
  return {
    ok: true,
    data: {
      invoice_id: String(r.invoice_id ?? ""),
      invoice_no: String(r.invoice_no ?? ""),
      total: Number(r.total ?? 0),
      paid: Number(r.paid ?? 0),
      debt: Number(r.debt ?? 0),
      is_walkin: Boolean(r.is_walkin),
    },
  };
}

/**
 * Lưu thông tin hóa đơn điện tử (số, ký hiệu, mã tra cứu, mã CQT, PDF) do nhà cung cấp bên ngoài phát hành. Không gọi API nhà cung cấp.
 * Một action cho cả 3 loại: kind = original (ghi mới) | replace (thay thế, replaces_id = hóa đơn gốc còn hiệu lực hoặc đã hủy)
 * | adjust (điều chỉnh, replaces_id + adjust_amount ≠ 0 + adjust_reason). RPC record_sale_einvoice (0019) kiểm tra lại; lỗi → tiếng Việt.
 */
export async function recordEinvoiceAction(saleId: string, payload: unknown): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!z.string().uuid().safeParse(saleId).success) return { ok: false, error: "Đơn bán không hợp lệ" };
  const parsed = einvoiceSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const d = parsed.data;
  const { error } = await auth.supabase.rpc("record_sale_einvoice", {
    p_sale_id: saleId,
    p: {
      kind: d.kind, number: d.number, symbol: d.symbol ?? null, provider: d.provider ?? null, lookup_code: d.lookup_code ?? null,
      lookup_url: d.lookup_url ?? null, issued_on: d.issued_on ?? null, note: d.note ?? null, return_id: d.return_id ?? null,
      replaces_id: d.replaces_id ?? null, cqt_code: d.cqt_code ?? null, pdf_url: d.pdf_url ?? null,
      adjust_amount: d.adjust_amount ?? null, adjust_reason: d.adjust_reason ?? null,
    },
  });
  if (error) return { ok: false, error: accountingErrorMessage(error.message) };
  refresh(saleId);
  return { ok: true, data: undefined };
}

export async function cancelEinvoiceAction(saleId: string, einvoiceId: string, reason: string): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!z.string().uuid().safeParse(einvoiceId).success) return { ok: false, error: "Hóa đơn điện tử không hợp lệ" };
  const { error } = await auth.supabase.rpc("cancel_sale_einvoice", { p_einvoice_id: einvoiceId, p_reason: reason });
  if (error) return { ok: false, error: accountingErrorMessage(error.message) };
  refresh(saleId);
  return { ok: true, data: undefined };
}

/** Hàng bán trả lại / giảm giá hàng bán (TK 521): nhập lại kho theo giá vốn gốc, hoàn tiền hoặc trừ công nợ. */
export async function returnSaleAction(payload: unknown): Promise<ActionResult<{ return_no: string; total: number; applied_to_debt: number; refunded: number }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const parsed = returnInputSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const d = parsed.data;
  const { data, error } = await auth.supabase.rpc("post_sale_return", {
    p_sale_id: d.sale_id,
    p_date: d.date ?? vnDate(),
    p_lines: d.lines.map((l: { sale_line_id: string; qty: number; amount?: number | null }) => ({ sale_line_id: l.sale_line_id, qty: l.qty, amount: l.amount ?? null })),
    p_refunds: d.refunds && d.refunds.length ? d.refunds.map((p) => ({ method: p.method, amount: p.amount, note: p.note ?? null, money_account_id: p.money_account_id ?? null })) : null,
    p_reason: d.reason ?? null,
    p_refund_method: d.refund_method,
    p_refund_account_id: d.refund_account_id ?? undefined,
  });
  if (error) return { ok: false, error: accountingErrorMessage(error.message) };
  const r = (data ?? {}) as Record<string, unknown>;
  refresh(d.sale_id);
  return { ok: true, data: { return_no: String(r.return_no ?? ""), total: Number(r.total ?? 0), applied_to_debt: Number(r.applied_to_debt ?? 0), refunded: Number(r.refunded ?? 0) } };
}

export async function voidSaleReturnAction(saleId: string, returnId: string, reason: string): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!z.string().uuid().safeParse(returnId).success) return { ok: false, error: "Phiếu trả hàng không hợp lệ" };
  const { error } = await auth.supabase.rpc("reverse_sales_return", { p_return_id: returnId, p_date: vnDate(), p_reason: reason || null });
  if (error) return { ok: false, error: accountingErrorMessage(error.message) };
  refresh(saleId);
  return { ok: true, data: undefined };
}

export async function voidSaleAction(saleId: string, reason: string): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!z.string().uuid().safeParse(saleId).success) return { ok: false, error: "Đơn bán không hợp lệ" };
  if (reason.trim().length < 3) return { ok: false, error: "Cần nhập lý do hủy" };
  const { error } = await auth.supabase.rpc("reverse_sales_invoice", { p_invoice_id: saleId, p_date: vnDate(), p_reason: reason.trim() });
  if (error) return { ok: false, error: accountingErrorMessage(error.message) };
  refresh(saleId);
  return { ok: true, data: undefined };
}
