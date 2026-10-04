"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/require-user";
import { formDataToObject, type ActionResult } from "@/lib/actions/_shared";
import { accountingErrorMessage } from "@/lib/accounting/errors";
import { vnDate } from "@/lib/time";

const paymentSchema = z.object({
  partner_id: z.string().uuid(),
  amount: z.coerce.number().positive("Số tiền phải > 0").max(1e13),
  method: z.enum(["cash", "bank"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ").optional().nullable(),
  memo: z.string().max(500).optional().nullable(),
});

type PaymentOut = { payment_no: string; allocated: number; unapplied: number };

async function pay(rpcName: "post_receipt_fifo" | "post_disbursement_fifo", partnerKey: "p_customer_id" | "p_supplier_id", formData: FormData, revalidate: string): Promise<ActionResult<PaymentOut>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const parsed = paymentSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const d = parsed.data;
  const { data, error } = await auth.supabase.rpc(rpcName, {
    [partnerKey]: d.partner_id,
    p_amount: d.amount,
    p_method: d.method,
    p_date: d.date ?? vnDate(),
    p_memo: d.memo ?? undefined,
  });
  if (error) return { ok: false, error: accountingErrorMessage(error.message) };
  const r = (data ?? {}) as { payment_no?: string; allocated?: number; unapplied?: number };
  revalidatePath(revalidate);
  revalidatePath(`${revalidate}/${d.partner_id}`);
  return { ok: true, data: { payment_no: r.payment_no ?? "", allocated: Number(r.allocated ?? 0), unapplied: Number(r.unapplied ?? 0) } };
}

/** Thu tiền khách hàng: tự phân bổ vào hóa đơn cũ nhất trước. */
export async function receiveCustomerPayment(formData: FormData): Promise<ActionResult<PaymentOut>> {
  return pay("post_receipt_fifo", "p_customer_id", formData, "/customers");
}

/** Chi tiền nhà cung cấp: tự phân bổ vào phiếu nhập cũ nhất trước. */
export async function paySupplier(formData: FormData): Promise<ActionResult<PaymentOut>> {
  return pay("post_disbursement_fifo", "p_supplier_id", formData, "/suppliers");
}
