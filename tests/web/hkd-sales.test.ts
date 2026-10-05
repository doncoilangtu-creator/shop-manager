import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeSaleTotals, einvoiceSchema, lineNet, returnInputSchema, saleInputSchema, validateSaleBusiness } from "@/lib/sales/schema";
import { accountingErrorMessage } from "@/lib/accounting/errors";
import { cancelEinvoiceAction, createSaleAction, recordEinvoiceAction, returnSaleAction, voidSaleAction } from "@/lib/actions/sales";
import { parseRevenueByTaxGroup } from "@/lib/hkd/threshold";

const rpc = vi.fn();
const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser }, rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const P1 = "11111111-1111-4111-8111-111111111111";
const C1 = "22222222-2222-4222-8222-222222222222";
const L1 = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  rpc.mockReset(); getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
});

describe("totals (giá đã gồm thuế, không tách VAT)", () => {
  it("lineNet applies % discount and rounds to 2 decimals", () => {
    expect(lineNet({ qty: 3, unit_price: 1000, discount_pct: 10 })).toBe(2700);
    expect(lineNet({ qty: 3, unit_price: 333.33, discount_pct: 0 })).toBe(999.99);
    expect(lineNet({ qty: 1, unit_price: 100, discount_pct: 150 })).toBe(0); // clamp
  });
  it("computeSaleTotals: total, paid, debt, over", () => {
    const t = computeSaleTotals([{ qty: 2, unit_price: 1500000 }, { qty: 1, unit_price: 500000, discount_pct: 20 }], [{ amount: 3000000 }, { amount: 100000 }]);
    expect(t).toMatchObject({ total: 3400000, paid: 3100000, debt: 300000, over: 0 });
    expect(computeSaleTotals([{ qty: 1, unit_price: 100 }], [{ amount: 150 }])).toMatchObject({ debt: 0, over: 50 });
  });
});

describe("saleInputSchema / business validation", () => {
  const base = { lines: [{ product_id: P1, qty: 1, unit_price: 1000000 }] };
  it("accepts a walk-in cash sale and defaults channel/discount", () => {
    const r = saleInputSchema.parse({ ...base, customer_id: "", payments: [{ method: "cash", amount: 1000000 }] });
    expect(r.customer_id).toBeNull();
    expect(r.channel).toBe("store");
    expect(r.lines[0].discount_pct).toBe(0);
    expect(validateSaleBusiness(r)).toBeNull();
  });
  it("walk-in must pay in full", () => {
    const r = saleInputSchema.parse({ ...base, payments: [{ method: "cash", amount: 500000 }] });
    expect(validateSaleBusiness(r)).toMatch(/Khách lẻ phải thanh toán đủ/);
  });
  it("named customer may leave debt; overpayment rejected", () => {
    expect(validateSaleBusiness(saleInputSchema.parse({ ...base, customer_id: C1, payments: [] }))).toBeNull();
    expect(validateSaleBusiness(saleInputSchema.parse({ ...base, customer_id: C1, payments: [{ method: "bank", amount: 2000000 }] }))).toMatch(/lớn hơn tổng tiền/);
  });
  it("requires a product or a description per line, positive integer qty, valid method", () => {
    expect(saleInputSchema.safeParse({ lines: [{ qty: 1, unit_price: 1 }] }).success).toBe(false);
    expect(saleInputSchema.safeParse({ lines: [{ description: "Công", qty: 1, unit_price: 1 }] }).success).toBe(true);
    expect(saleInputSchema.safeParse({ lines: [{ product_id: P1, qty: 1.5, unit_price: 1 }] }).success).toBe(false);
    expect(saleInputSchema.safeParse({ lines: [{ product_id: P1, qty: 0, unit_price: 1 }] }).success).toBe(false);
    expect(saleInputSchema.safeParse({ ...base, payments: [{ method: "card", amount: 1 }] }).success).toBe(false);
    expect(saleInputSchema.safeParse({ lines: [] }).success).toBe(false);
  });
  it("has no VAT field: unknown vat_rate on a line is dropped", () => {
    const r = saleInputSchema.parse({ lines: [{ product_id: P1, qty: 1, unit_price: 100, vat_rate: 10 }] });
    expect("vat_rate" in r.lines[0]).toBe(false);
  });
});

describe("einvoiceSchema", () => {
  it("validates number/symbol/url", () => {
    expect(einvoiceSchema.safeParse({ number: "0000123", symbol: "C26TAA", lookup_url: "https://tracuu.example.vn/x" }).success).toBe(true);
    expect(einvoiceSchema.safeParse({ number: "" }).success).toBe(false);
    expect(einvoiceSchema.safeParse({ number: "12 3" }).success).toBe(false);
    expect(einvoiceSchema.safeParse({ number: "1", symbol: "C26-TAA" }).success).toBe(false);
    expect(einvoiceSchema.safeParse({ number: "1", lookup_url: "javascript:alert(1)" }).success).toBe(false);
    expect(einvoiceSchema.parse({ number: "1", symbol: "", lookup_url: "" })).toMatchObject({ symbol: null, lookup_url: null, kind: "original" });
  });
});

describe("returnInputSchema", () => {
  it("drops empty lines and requires at least one", () => {
    const r = returnInputSchema.parse({ sale_id: C1, lines: [{ sale_line_id: L1, qty: 0 }, { sale_line_id: L1, qty: 2 }] });
    expect(r.lines).toHaveLength(1);
    expect(r.refund_method).toBe("cash");
    expect(returnInputSchema.safeParse({ sale_id: C1, lines: [{ sale_line_id: L1, qty: 0 }] }).success).toBe(false);
    expect(returnInputSchema.safeParse({ sale_id: C1, lines: [{ sale_line_id: L1, qty: 0, amount: 100 }] }).success).toBe(true);
  });
});

describe("actions", () => {
  it("createSaleAction calls post_sale_hkd once with VAT-free payload", async () => {
    rpc.mockResolvedValue({ data: { invoice_id: "i1", invoice_no: "INV-2026-000001", total: 3000000, paid: 3000000, debt: 0, is_walkin: true }, error: null });
    const res = await createSaleAction({
      customer_id: "", date: "2026-05-10", channel: "online",
      lines: [{ product_id: P1, qty: 2, unit_price: 1500000, discount_pct: 0 }],
      payments: [{ method: "cash", amount: 1000000 }, { method: "bank", amount: 2000000, note: "MB" }],
    });
    expect(res).toMatchObject({ ok: true, data: { invoice_no: "INV-2026-000001", is_walkin: true } });
    expect(rpc).toHaveBeenCalledTimes(1);
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe("post_sale_hkd");
    expect(args).toMatchObject({ p_customer_id: null, p_date: "2026-05-10", p_channel: "online", p_allow_over_limit: false });
    expect(args.p_payments).toEqual([{ method: "cash", amount: 1000000, note: null, money_account_id: null }, { method: "bank", amount: 2000000, note: "MB", money_account_id: null }]);
    expect(JSON.stringify(args.p_lines)).not.toContain("vat");
  });
  it("blocks walk-in under-payment before calling the DB", async () => {
    const res = await createSaleAction({ lines: [{ product_id: P1, qty: 1, unit_price: 1000 }], payments: [{ method: "cash", amount: 10 }] });
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("maps DB errors to Vietnamese, including stock details", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "insufficient_stock: HP-1 (have 1, need 3)" } });
    const res = await createSaleAction({ customer_id: C1, lines: [{ product_id: P1, qty: 3, unit_price: 1000 }] });
    expect(res).toEqual({ ok: false, error: "Tồn kho không đủ: HP-1 (còn 1, cần 3)." });
  });
  it("requires login", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await createSaleAction({})).ok).toBe(false);
    expect((await voidSaleAction(C1, "nhập sai")).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("returnSaleAction sends post_sale_return with refund method", async () => {
    rpc.mockResolvedValue({ data: { return_no: "RT-2026-000001", total: 1500000, applied_to_debt: 0, refunded: 1500000 }, error: null });
    const res = await returnSaleAction({ sale_id: C1, lines: [{ sale_line_id: L1, qty: 1 }], refund_method: "bank", reason: "Lỗi" });
    expect(res).toMatchObject({ ok: true, data: { return_no: "RT-2026-000001", refunded: 1500000 } });
    expect(rpc).toHaveBeenCalledWith("post_sale_return", expect.objectContaining({ p_sale_id: C1, p_refund_method: "bank", p_refunds: null, p_lines: [{ sale_line_id: L1, qty: 1, amount: null }] }));
  });
  it("record/cancel e-invoice and void call the right RPCs", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    expect((await recordEinvoiceAction(C1, { number: "0000123", symbol: "C26TAA" })).ok).toBe(true);
    expect(rpc).toHaveBeenLastCalledWith("record_sale_einvoice", { p_sale_id: C1, p: expect.objectContaining({ number: "0000123", symbol: "C26TAA", kind: "original" }) });
    expect((await recordEinvoiceAction(C1, { number: "" })).ok).toBe(false);
    expect((await cancelEinvoiceAction(C1, L1, "Sai thông tin")).ok).toBe(true);
    expect(rpc).toHaveBeenLastCalledWith("cancel_sale_einvoice", { p_einvoice_id: L1, p_reason: "Sai thông tin" });
    expect((await voidSaleAction(C1, "ab")).ok).toBe(false);
    expect((await voidSaleAction(C1, "nhập sai")).ok).toBe(true);
    expect(rpc).toHaveBeenLastCalledWith("reverse_sales_invoice", expect.objectContaining({ p_invoice_id: C1, p_reason: "nhập sai" }));
  });
});

describe("error messages + report parsing", () => {
  it.each([
    ["walkin_must_pay_in_full", "Khách lẻ"], ["invoice_has_returns", "phiếu trả hàng"], ["invoice_has_einvoice", "hóa đơn điện tử"],
    ["refund_mismatch", "hoàn lại"], ["einvoice_number_duplicate", "Số hóa đơn điện tử"], ["return_exceeds_sold", "vượt số đã bán"],
  ])("%s", (code, frag) => {
    expect(accountingErrorMessage(`P0001: ${code}`)).toContain(frag);
  });
  it("parseRevenueByTaxGroup", () => {
    expect(parseRevenueByTaxGroup([{ tax_group: "goods", name_vi: "Phân phối, cung cấp hàng hóa", revenue: "1500000.00", vat_pct: "1.00", pit_pct: "0.50" }, { tax_group: "other", revenue: 0, vat_pct: null, pit_pct: null }]))
      .toEqual([{ tax_group: "goods", name_vi: "Phân phối, cung cấp hàng hóa", revenue: 1500000, vat_pct: 1, pit_pct: 0.5 }, { tax_group: "other", name_vi: "other", revenue: 0, vat_pct: null, pit_pct: null }]);
    expect(parseRevenueByTaxGroup(null)).toEqual([]);
  });
});
