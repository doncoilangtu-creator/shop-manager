/**
 * Mua hàng có chứng từ (A3): schema đầu vào + tính tiền phía client.
 * - Chế độ hộ kinh doanh: KHÔNG ghi thuế GTGT đầu vào (TK 133). VAT trên hóa đơn mua (nếu có) được cộng vào giá vốn hàng tồn.
 * - Số liệu chính thức do RPC `post_purchase_bill` tính lại trên máy chủ (một giao dịch: kho + công nợ NCC + sổ cái).
 */
import { z } from "zod";

export const VAT_RATES = [0, 5, 8, 10] as const;
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const text = (max: number) =>
  z.preprocess((v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v), z.string().max(max).nullable().optional());
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ");

export const purchaseLineSchema = z.object({
  product_id: z.string({ required_error: "Chọn sản phẩm" }).uuid("Chọn sản phẩm"),
  qty: z.coerce.number({ invalid_type_error: "Số lượng không hợp lệ" }).int("Số lượng phải là số nguyên").positive("Số lượng phải > 0").max(1_000_000),
  unit_cost: z.coerce.number({ invalid_type_error: "Giá nhập không hợp lệ" }).min(0, "Giá nhập không được âm").max(1e12),
  vat_rate: z.coerce
    .number()
    .refine((v) => (VAT_RATES as readonly number[]).includes(v), "Thuế suất trên hóa đơn mua phải là 0, 5, 8 hoặc 10%")
    .default(0),
});

export const purchaseInputSchema = z
  .object({
    supplier_id: z.string({ required_error: "Chọn nhà cung cấp" }).uuid("Chọn nhà cung cấp"),
    bill_date: z.preprocess((v) => (v === "" ? null : v), dateStr.nullable().optional()),
    due_date: z.preprocess((v) => (v === "" ? null : v), dateStr.nullable().optional()),
    supplier_ref: text(60),
    memo: text(500),
    lines: z.array(purchaseLineSchema).min(1, "Cần ít nhất một dòng hàng").max(200),
  })
  .refine((v) => !v.bill_date || !v.due_date || v.due_date >= v.bill_date, { message: "Hạn thanh toán không được trước ngày chứng từ", path: ["due_date"] });
export type PurchaseInput = z.infer<typeof purchaseInputSchema>;

type LineLike = { qty: number; unit_cost: number; vat_rate?: number | null };

export type PurchaseTotals = {
  lines: Array<{ net: number; vat: number; cost: number; unit_cost_incl: number }>;
  subtotal: number; vat: number; total: number;
};

/**
 * Giá trị mỗi dòng: net = SL × giá nhập; vat = net × thuế suất; giá vốn nhập kho = net + vat (VAT cộng vào giá vốn);
 * giá vốn bình quân/đơn vị = giá vốn ÷ SL (làm tròn 2 số lẻ, giống RPC).
 */
export function computePurchaseTotals(lines: LineLike[]): PurchaseTotals {
  const rows = lines.map((l) => {
    const qty = Number(l.qty) || 0;
    const net = round2(qty * (Number(l.unit_cost) || 0));
    const vat = round2((net * (Number(l.vat_rate) || 0)) / 100);
    const cost = round2(net + vat);
    return { net, vat, cost, unit_cost_incl: qty > 0 ? round2(cost / qty) : 0 };
  });
  const subtotal = round2(rows.reduce((a, r) => a + r.net, 0));
  const vat = round2(rows.reduce((a, r) => a + r.vat, 0));
  return { lines: rows, subtotal, vat, total: round2(subtotal + vat) };
}

export function validatePurchaseBusiness(input: PurchaseInput): string | null {
  const t = computePurchaseTotals(input.lines);
  if (t.total <= 0) return "Tổng tiền phiếu mua phải lớn hơn 0";
  const ids = input.lines.map((l) => l.product_id);
  if (new Set(ids).size !== ids.length) return "Mỗi sản phẩm chỉ nên xuất hiện một lần trong phiếu mua (gộp số lượng)";
  return null;
}
