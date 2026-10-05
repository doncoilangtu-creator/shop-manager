import { z } from "zod";

/**
 * Zod schemas for quotation server actions.
 *
 * Discount model:
 *   line_total = qty * unit_price * (1 - discount / 100)
 *
 * Quotation-level:
 *   subtotal = sum(line_total for each line)
 *   discount = quotation-level discount amount (VND) — applied after subtotal
 *   vat      = (subtotal - discount) * vatRate / 100   (vatRate luôn 0 ở chế độ hộ kinh doanh: giá đã gồm thuế)
 *   total    = subtotal - discount + vat
 */

export const quotationItemSchema = z.object({
  // Empty string when no product picked yet (UI uses "" for blank rows).
  product_id: z.string().uuid("Chọn sản phẩm từ kho").or(z.literal("")),
  qty: z.coerce.number().positive("Số lượng phải > 0"),
  unit_price: z.coerce.number().nonnegative("Đơn giá không âm"),
  discount: z.coerce.number().min(0, "CK không âm").max(100, "CK tối đa 100%"),
  notes: z.string().max(500).optional().nullable(),
});

export const quotationFormSchema = z.object({
  customer_id: z.string().uuid("Chọn khách hàng").or(z.literal("")),
  valid_until: z
    .string()
    .min(1, "Chọn ngày hiệu lực")
    .refine(
      (v) => !Number.isNaN(Date.parse(v)),
      "Ngày hiệu lực không hợp lệ",
    ),
  notes: z.string().max(2000).optional().nullable(),
  discount: z.coerce.number().min(0, "CK không âm"), // VND amount
  // Chế độ hộ kinh doanh (0014): báo giá dùng GIÁ ĐÃ GỒM THUẾ, không tách VAT. Giữ trường để tương thích, nhưng chỉ chấp nhận 0.
  vat_rate: z.coerce.number().min(0).max(0, "Báo giá hộ kinh doanh không tách VAT (giá đã gồm thuế)").default(0),
  items: z
    .array(quotationItemSchema)
    .min(1, "Phải có ít nhất 1 dòng sản phẩm")
    .refine(
      (items) => items.some((i) => i.product_id !== "" && i.qty > 0),
      "Phải có ít nhất 1 dòng có sản phẩm và số lượng > 0",
    ),
});

export type QuotationFormInput = z.infer<typeof quotationFormSchema>;

/**
 * Compute all monetary totals from a list of items + quotation-level discount & VAT rate.
 */
export function computeQuotationTotals(input: {
  items: Array<{
    product_id: string;
    qty: number;
    unit_price: number;
    discount: number;
  }>;
  discount: number;
  vat_rate: number;
}) {
  const lines = input.items
    .filter((i) => i.product_id && i.qty > 0)
    .map((i) => {
      const gross = i.qty * i.unit_price;
      const lineTotal = gross * (1 - (i.discount || 0) / 100);
      return { ...i, gross, line_total: round2(lineTotal) };
    });

  const subtotal = round2(lines.reduce((s, l) => s + l.line_total, 0));
  const quotationDiscount = round2(Math.min(input.discount || 0, subtotal));
  const vatBase = round2(subtotal - quotationDiscount);
  const vat = round2(vatBase * ((input.vat_rate || 0) / 100));
  const total = round2(vatBase + vat);

  return { subtotal, discount: quotationDiscount, vat, total, lines };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Items sent to save_quotation(): blank rows dropped, per-line notes kept with THEIR line (by index). */
export function toRpcItems(items: QuotationFormInput["items"]) {
  return items
    .filter((i) => i.product_id && i.qty > 0)
    .map((i) => ({
      product_id: i.product_id,
      qty: i.qty,
      unit_price: i.unit_price,
      discount: i.discount || 0,
      notes: i.notes?.trim() ? i.notes.trim() : null,
    }));
}

