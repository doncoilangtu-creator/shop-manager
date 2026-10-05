import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountingErrorMessage } from "@/lib/accounting/errors";
import { computePurchaseTotals, purchaseInputSchema, validatePurchaseBusiness } from "@/lib/purchases/schema";
import { parseAccountingMode } from "@/lib/reports";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const S = "33333333-3333-4333-8333-333333333333";

describe("computePurchaseTotals (VAT cộng vào giá vốn)", () => {
  it("không VAT: giá vốn = tiền hàng", () => {
    const t = computePurchaseTotals([{ qty: 10, unit_cost: 100000 }]);
    expect(t).toMatchObject({ subtotal: 1_000_000, vat: 0, total: 1_000_000 });
    expect(t.lines[0]).toMatchObject({ cost: 1_000_000, unit_cost_incl: 100000 });
  });
  it("VAT 10%: tổng phải trả gồm VAT, giá vốn mỗi dòng = net + VAT, giá vốn/đơn vị làm tròn 2 số lẻ", () => {
    const t = computePurchaseTotals([{ qty: 10, unit_cost: 100000, vat_rate: 10 }, { qty: 3, unit_cost: 33333, vat_rate: 8 }]);
    expect(t.lines[0]).toMatchObject({ net: 1_000_000, vat: 100_000, cost: 1_100_000, unit_cost_incl: 110000 });
    expect(t.lines[1]).toMatchObject({ net: 99_999, vat: 7999.92, cost: 107_998.92, unit_cost_incl: 35_999.64 });
    expect(t.subtotal).toBe(1_099_999);
    expect(t.vat).toBe(107_999.92);
    expect(t.total).toBe(1_207_998.92);
  });
  it("dòng rỗng / số lượng 0 không gây NaN", () => {
    const t = computePurchaseTotals([{ qty: 0, unit_cost: 5, vat_rate: 10 }, { qty: NaN, unit_cost: 5 }]);
    expect(t.total).toBe(0);
    expect(t.lines.every((l) => Number.isFinite(l.unit_cost_incl))).toBe(true);
  });
});

describe("purchaseInputSchema", () => {
  const base = { supplier_id: S, bill_date: "2026-10-01", lines: [{ product_id: P1, qty: 2, unit_cost: 1000, vat_rate: 10 }] };
  it("chấp nhận phiếu hợp lệ và ép kiểu số", () => {
    const r = purchaseInputSchema.safeParse({ ...base, supplier_ref: " HD-1 ", lines: [{ product_id: P1, qty: "2", unit_cost: "1000", vat_rate: "8" }] });
    expect(r.success).toBe(true);
    if (r.success) { expect(r.data.supplier_ref).toBe("HD-1"); expect(r.data.lines[0].vat_rate).toBe(8); }
  });
  it("bắt buộc nhà cung cấp (không nhập kho không chứng từ)", () => {
    expect(purchaseInputSchema.safeParse({ ...base, supplier_id: "" }).success).toBe(false);
    const { supplier_id: _s, ...noSup } = base;
    expect(purchaseInputSchema.safeParse(noSup).success).toBe(false);
  });
  it("từ chối thuế suất lạ, số lượng không nguyên/<=0, giá âm, phiếu rỗng", () => {
    expect(purchaseInputSchema.safeParse({ ...base, lines: [{ product_id: P1, qty: 1, unit_cost: 1, vat_rate: 7 }] }).success).toBe(false);
    expect(purchaseInputSchema.safeParse({ ...base, lines: [{ product_id: P1, qty: 1.5, unit_cost: 1 }] }).success).toBe(false);
    expect(purchaseInputSchema.safeParse({ ...base, lines: [{ product_id: P1, qty: 0, unit_cost: 1 }] }).success).toBe(false);
    expect(purchaseInputSchema.safeParse({ ...base, lines: [{ product_id: P1, qty: 1, unit_cost: -1 }] }).success).toBe(false);
    expect(purchaseInputSchema.safeParse({ ...base, lines: [] }).success).toBe(false);
  });
  it("hạn thanh toán không trước ngày chứng từ", () => {
    const r = purchaseInputSchema.safeParse({ ...base, due_date: "2026-09-30" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/Hạn thanh toán/);
  });
  it("validatePurchaseBusiness: tổng > 0 và không trùng sản phẩm", () => {
    const zero = purchaseInputSchema.parse({ ...base, lines: [{ product_id: P1, qty: 1, unit_cost: 0 }] });
    expect(validatePurchaseBusiness(zero)).toMatch(/lớn hơn 0/);
    const dup = purchaseInputSchema.parse({ ...base, lines: [{ product_id: P1, qty: 1, unit_cost: 5 }, { product_id: P1, qty: 1, unit_cost: 5 }] });
    expect(validatePurchaseBusiness(dup)).toMatch(/một lần/);
    expect(validatePurchaseBusiness(purchaseInputSchema.parse({ ...base, lines: [{ product_id: P1, qty: 1, unit_cost: 5 }, { product_id: P2, qty: 1, unit_cost: 5 }] }))).toBeNull();
  });
});

describe("thông báo lỗi tiếng Việt cho A3", () => {
  it("map mã lỗi RPC", () => {
    expect(accountingErrorMessage("stock_in_requires_purchase_bill")).toMatch(/chứng từ mua/);
    expect(accountingErrorMessage("vat_account_not_allowed_hkd: TK 3331 không dùng")).toMatch(/3331\/133/);
    expect(accountingErrorMessage("vat_not_allowed_hkd")).toMatch(/không tách VAT/);
    expect(accountingErrorMessage("due_before_bill_date")).toMatch(/Hạn thanh toán/);
    expect(accountingErrorMessage("bill_not_found")).toMatch(/phiếu mua/);
    expect(accountingErrorMessage("accounting_mode_invalid")).toMatch(/Chế độ/);
  });
  it("parseAccountingMode: giá trị lạ -> hkd (an toàn)", () => {
    expect(parseAccountingMode("enterprise")).toBe("enterprise");
    expect(parseAccountingMode("hkd")).toBe("hkd");
    expect(parseAccountingMode(null)).toBe("hkd");
    expect(parseAccountingMode("whatever")).toBe("hkd");
  });
});

// ---- server actions
const rpc = vi.fn();
let user: { id: string } | null = { id: "u1" };
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => (user ? { ok: true, user, supabase: { rpc } } : { ok: false, error: "Unauthorized" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("createPurchaseAction / voidPurchaseAction", () => {
  beforeEach(() => { rpc.mockReset(); user = { id: "u1" }; });

  it("một lần gọi post_purchase_bill, không gửi tổng tiền từ client", async () => {
    rpc.mockResolvedValue({ data: { bill_id: P2, bill_no: "PB-2026-000001", subtotal: 2000, vat: 200, total: 2200 }, error: null });
    const { createPurchaseAction } = await import("@/lib/actions/purchases");
    const r = await createPurchaseAction({ supplier_id: S, bill_date: "2026-10-01", supplier_ref: "A1", lines: [{ product_id: P1, qty: 2, unit_cost: 1000, vat_rate: 10 }] });
    expect(r).toEqual({ ok: true, data: { bill_id: P2, bill_no: "PB-2026-000001", subtotal: 2000, vat: 200, total: 2200 } });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe("post_purchase_bill");
    const args = rpc.mock.calls[0][1];
    expect(args).toMatchObject({ p_supplier_id: S, p_bill_date: "2026-10-01", p_supplier_ref: "A1", p_due_date: null });
    expect(args.p_lines).toEqual([{ product_id: P1, qty: 2, unit_cost: 1000, vat_rate: 10 }]);
    expect(JSON.stringify(args)).not.toMatch(/total|subtotal/);
  });
  it("lỗi dữ liệu không gọi RPC", async () => {
    const { createPurchaseAction } = await import("@/lib/actions/purchases");
    expect((await createPurchaseAction({ supplier_id: "", lines: [] })).ok).toBe(false);
    expect((await createPurchaseAction({ supplier_id: S, lines: [{ product_id: P1, qty: 1, unit_cost: 0 }] })).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("dịch lỗi RPC và trùng số chứng từ NCC", async () => {
    const { createPurchaseAction } = await import("@/lib/actions/purchases");
    rpc.mockResolvedValueOnce({ data: null, error: { message: "period_closed" } });
    const input = { supplier_id: S, bill_date: "2026-10-01", lines: [{ product_id: P1, qty: 1, unit_cost: 5 }] };
    expect(await createPurchaseAction(input)).toMatchObject({ ok: false, error: expect.stringMatching(/khóa/) });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "uq_pb_supplier_ref"' } });
    expect(await createPurchaseAction(input)).toMatchObject({ ok: false, error: expect.stringMatching(/Số chứng từ/) });
  });
  it("chưa đăng nhập: bị từ chối", async () => {
    user = null;
    const { createPurchaseAction, voidPurchaseAction } = await import("@/lib/actions/purchases");
    expect(await createPurchaseAction({})).toEqual({ ok: false, error: "Unauthorized" });
    expect(await voidPurchaseAction(P2, "nhập nhầm")).toEqual({ ok: false, error: "Unauthorized" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("hủy phiếu: cần lý do và id hợp lệ, gọi reverse_purchase_bill", async () => {
    const { voidPurchaseAction } = await import("@/lib/actions/purchases");
    expect((await voidPurchaseAction("x", "nhập nhầm")).ok).toBe(false);
    expect((await voidPurchaseAction(P2, " a ")).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: {}, error: null });
    expect(await voidPurchaseAction(P2, "nhập nhầm")).toEqual({ ok: true, data: undefined });
    expect(rpc.mock.calls[0][0]).toBe("reverse_purchase_bill");
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_bill_id: P2, p_reason: "nhập nhầm" });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "bill_has_allocations" } });
    expect(await voidPurchaseAction(P2, "nhập nhầm")).toMatchObject({ ok: false, error: expect.stringMatching(/chi tiền/) });
  });
});
