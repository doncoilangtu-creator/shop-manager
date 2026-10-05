/**
 * Bán hàng hộ kinh doanh (A2): schema đầu vào + tính tiền phía client.
 * - Đơn giá là giá ĐÃ GỒM thuế; không có trường VAT (hóa đơn bán hàng không tách VAT).
 * - Số liệu chính thức luôn do RPC `post_sale_hkd` (nguyên tử) tính lại trên máy chủ.
 */
import { z } from "zod";

export const PAYMENT_METHODS = ["cash", "bank"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const METHOD_LABEL: Record<PaymentMethod, string> = { cash: "Tiền mặt", bank: "Chuyển khoản" };

export const CHANNELS = ["store", "online", "marketplace", "other"] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABEL: Record<Channel, string> = { store: "Tại cửa hàng", online: "Online (web/Zalo/Facebook)", marketplace: "Sàn TMĐT", other: "Khác" };

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const text = (max: number) =>
  z.preprocess((v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v), z.string().max(max).nullable().optional());
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ");
const money = (label: string) => z.coerce.number({ invalid_type_error: `${label} không hợp lệ` });

export const saleLineSchema = z
  .object({
    product_id: z.preprocess((v) => (v === "" ? null : v), z.string().uuid().nullable().optional()),
    description: text(255),
    qty: money("Số lượng").int("Số lượng phải là số nguyên").positive("Số lượng phải > 0").max(1_000_000),
    unit_price: money("Đơn giá").min(0, "Đơn giá không được âm").max(1e12),
    discount_pct: money("Chiết khấu").min(0).max(100).default(0),
    tax_group: text(40),
  })
  .refine((l) => !!l.product_id || !!l.description, { message: "Mỗi dòng cần chọn sản phẩm hoặc nhập mô tả (dịch vụ)", path: ["description"] });

export const salePaymentSchema = z.object({
  method: z.enum(PAYMENT_METHODS, { errorMap: () => ({ message: "Phương thức thanh toán không hợp lệ" }) }),
  amount: money("Số tiền").positive("Số tiền thanh toán phải > 0").max(1e13),
  note: text(200),
  money_account_id: z.preprocess((v) => (v === "" ? null : v), z.string().uuid("Tài khoản tiền không hợp lệ").nullable().optional()),
});

const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const httpUrl = (msg: string) => z.preprocess(blankToNull, z.string().trim().max(500, "Đường dẫn tối đa 500 ký tự").regex(/^https?:\/\//i, msg).nullable().optional());

export const EINVOICE_KINDS = ["original", "replace", "adjust"] as const;
export type EinvoiceKind = (typeof EINVOICE_KINDS)[number];
export const EINVOICE_KIND_LABEL: Record<EinvoiceKind, string> = { original: "Ghi mới", replace: "Thay thế", adjust: "Điều chỉnh" };

/** Thông tin HĐĐT do nhà cung cấp bên ngoài phát hành. Các trường mới đều tùy chọn → form ghi mới cũ vẫn hợp lệ. */
export const einvoiceBaseSchema = z.object({
  kind: z.enum(EINVOICE_KINDS, { errorMap: () => ({ message: "Loại hóa đơn điện tử không hợp lệ" }) }).default("original"),
  provider: text(100),
  symbol: z.preprocess(blankToNull, z.string().trim().regex(/^[A-Za-z0-9]{1,15}$/, "Ký hiệu hóa đơn chỉ gồm chữ và số (tối đa 15 ký tự)").nullable().optional()),
  number: z.string({ required_error: "Nhập số hóa đơn điện tử" }).trim().regex(/^[A-Za-z0-9/_-]{1,30}$/, "Số hóa đơn chỉ gồm chữ, số, / _ - (tối đa 30 ký tự)"),
  lookup_code: text(100),
  lookup_url: httpUrl("Đường dẫn tra cứu phải bắt đầu bằng http:// hoặc https://"),
  issued_on: z.preprocess((v) => (v === "" ? null : v), dateStr.nullable().optional()),
  note: text(500),
  return_id: z.preprocess((v) => (v === "" ? null : v), z.string().uuid().nullable().optional()),
  // ---- thay thế / điều chỉnh (0019)
  replaces_id: z.preprocess(blankToNull, z.string().uuid("Hóa đơn gốc không hợp lệ").nullable().optional()),
  cqt_code: z.preprocess(blankToNull, z.string().trim().regex(/^[A-Za-z0-9-]{1,50}$/, "Mã của cơ quan thuế chỉ gồm chữ, số và dấu - (tối đa 50 ký tự)").nullable().optional()),
  pdf_url: httpUrl("Đường dẫn PDF phải bắt đầu bằng http:// hoặc https://"),
  adjust_amount: z.preprocess(
    (v) => (v === "" || v === undefined ? null : typeof v === "string" ? v.replace(/[\s.,](?=\d{3}(\D|$))/g, "") : v),
    z.coerce.number({ invalid_type_error: "Số tiền điều chỉnh không hợp lệ" }).finite("Số tiền điều chỉnh không hợp lệ").min(-1e13).max(1e13).nullable().optional(),
  ),
  adjust_reason: text(500),
});

export const einvoiceSchema = einvoiceBaseSchema
  .superRefine((v, ctx) => {
    if (v.kind === "adjust") {
      if (v.adjust_amount == null || v.adjust_amount === 0)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["adjust_amount"], message: "Nhập số tiền điều chỉnh khác 0 (âm = giảm, dương = tăng)" });
      if (!v.adjust_reason || v.adjust_reason.length < 5)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["adjust_reason"], message: "Nhập lý do điều chỉnh (ít nhất 5 ký tự)" });
    }
  })
  .transform((v) => {
    // Bỏ các trường không thuộc loại đã chọn để RPC không nhận dữ liệu thừa.
    if (v.kind === "original") return { ...v, replaces_id: null, adjust_amount: null, adjust_reason: null, return_id: null };
    if (v.kind === "replace") return { ...v, adjust_amount: null, adjust_reason: null, return_id: null };
    return { ...v, adjust_amount: v.adjust_amount == null ? null : round2(v.adjust_amount) };
  });
export type EinvoiceInput = z.infer<typeof einvoiceSchema>;

export const buyerSchema = z.object({ name: text(255), tax_code: text(20), address: text(500), email: text(255) });

export const saleInputSchema = z.object({
  customer_id: z.preprocess((v) => (v === "" ? null : v), z.string().uuid().nullable().optional()),
  date: z.preprocess((v) => (v === "" ? null : v), dateStr.nullable().optional()),
  due_date: z.preprocess((v) => (v === "" ? null : v), dateStr.nullable().optional()),
  channel: z.enum(CHANNELS).default("store"),
  lines: z.array(saleLineSchema).min(1, "Cần ít nhất một dòng hàng").max(200),
  payments: z.array(salePaymentSchema).max(10).default([]),
  memo: text(500),
  buyer: buyerSchema.optional().nullable(),
  einvoice: einvoiceSchema.optional().nullable(),
});
export type SaleInput = z.infer<typeof saleInputSchema>;

export type SaleTotals = { lineNets: number[]; total: number; paid: number; debt: number; over: number };

type LineLike = { qty: number; unit_price: number; discount_pct?: number | null };
export function lineNet(l: LineLike): number {
  const qty = Number(l.qty) || 0;
  const price = Number(l.unit_price) || 0;
  const pct = Math.min(Math.max(Number(l.discount_pct) || 0, 0), 100);
  return round2(qty * price * (1 - pct / 100));
}

/** Tổng tiền (đã gồm thuế), đã thu, còn nợ (>= 0) và phần thu dư (> 0 nghĩa là sai). */
export function computeSaleTotals(lines: LineLike[], payments: Array<{ amount: number }>): SaleTotals {
  const lineNets = lines.map(lineNet);
  const total = round2(lineNets.reduce((a, b) => a + b, 0));
  const paid = round2(payments.reduce((a, p) => a + (Number(p.amount) || 0), 0));
  return { lineNets, total, paid, debt: round2(Math.max(total - paid, 0)), over: round2(Math.max(paid - total, 0)) };
}

/** Kiểm tra nghiệp vụ phía máy chủ trước khi gọi RPC (RPC vẫn kiểm tra lại). Trả thông báo lỗi tiếng Việt hoặc null. */
export function validateSaleBusiness(input: SaleInput): string | null {
  const t = computeSaleTotals(input.lines, input.payments);
  if (t.total <= 0) return "Tổng tiền phải lớn hơn 0";
  if (t.over > 0) return "Số tiền thu lớn hơn tổng tiền đơn hàng";
  if (!input.customer_id && t.debt > 0) return "Khách lẻ phải thanh toán đủ — chọn khách hàng có tên nếu muốn ghi công nợ";
  return null;
}

// ------------------------------------------------------------------ trả hàng
export const returnInputSchema = z.object({
  sale_id: z.string().uuid(),
  date: z.preprocess((v) => (v === "" ? null : v), dateStr.nullable().optional()),
  reason: text(500),
  lines: z
    .array(
      z.object({
        sale_line_id: z.string().uuid(),
        qty: money("Số lượng trả").int("Số lượng trả phải là số nguyên").min(0),
        amount: z.preprocess((v) => (v === "" || v === null || v === undefined ? null : v), z.coerce.number().positive("Số tiền giảm phải > 0").nullable().optional()),
      }),
    )
    .transform((ls) => ls.filter((l) => l.qty > 0 || (l.amount ?? 0) > 0))
    .pipe(z.array(z.any()).min(1, "Chọn ít nhất một dòng cần trả/giảm giá")),
  refunds: z.array(salePaymentSchema).max(10).optional().nullable(),
  refund_method: z.enum(PAYMENT_METHODS).default("cash"),
  refund_account_id: z.preprocess((v) => (v === "" ? null : v), z.string().uuid("Tài khoản hoàn tiền không hợp lệ").nullable().optional()),
});
export type ReturnInput = z.infer<typeof returnInputSchema>;
