import { beforeEach, describe, expect, it, vi } from "vitest";
import { getShopInfo } from "@/lib/shop";
import { toRpcItems } from "@/lib/quotations/schema";

const rpc = vi.fn();
const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser }, rpc }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { throw new Error("admin not expected"); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const base = {
  customer_id: C, valid_until: "2026-12-31", notes: "n", discount: 1000, vat_rate: 10,
  items: [
    { product_id: P1, qty: 1, unit_price: 100, discount: 0, notes: "ghi chú dòng 1" },
    { product_id: "", qty: 1, unit_price: 0, discount: 0, notes: "dòng trống" },   // blank row between real rows
    { product_id: P2, qty: 2, unit_price: 50, discount: 5, notes: "ghi chú dòng 3" },
  ],
};

beforeEach(() => {
  rpc.mockReset(); getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
});

describe("toRpcItems (notes stay with their own line)", () => {
  it("drops blank rows WITHOUT shifting notes (old code matched notes by product_id)", () => {
    const items = toRpcItems(base.items);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ product_id: P1, notes: "ghi chú dòng 1" });
    expect(items[1]).toMatchObject({ product_id: P2, notes: "ghi chú dòng 3", discount: 5 });
  });
  it("same product on two lines keeps two different notes", () => {
    const items = toRpcItems([
      { product_id: P1, qty: 1, unit_price: 1, discount: 0, notes: "A" },
      { product_id: P1, qty: 2, unit_price: 1, discount: 0, notes: "B" },
    ]);
    expect(items.map((i) => i.notes)).toEqual(["A", "B"]);
  });
});

describe("createQuotationAction", () => {
  it("is ONE save_quotation call (atomic); totals are not sent from the client", async () => {
    rpc.mockResolvedValue({ data: { id: "q1", code: "BG-X" }, error: null });
    const { createQuotationAction } = await import("@/lib/quotations/actions");
    const r = await createQuotationAction(base, "sent");
    expect(r).toEqual({ ok: true, id: "q1", code: "BG-X" });
    expect(rpc).toHaveBeenCalledTimes(1);
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe("save_quotation");
    expect(args).toMatchObject({ p_id: null, p_status: "sent", p_customer_id: C, p_discount: 1000, p_vat_rate: 10 });
    expect(args.p_code).toMatch(/^BG-\d{8}-[0-9A-Z]{8}$/);
    expect(Object.keys(args)).not.toContain("p_total");
  });
  it("retries with a NEW code on unique violation, gives up on other errors", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "23505", message: "dup" } })
       .mockResolvedValueOnce({ data: { id: "q2" }, error: null });
    const { createQuotationAction } = await import("@/lib/quotations/actions");
    expect((await createQuotationAction(base)).ok).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0][1].p_code).not.toBe(rpc.mock.calls[1][1].p_code);

    rpc.mockReset();
    rpc.mockResolvedValue({ data: null, error: { code: "23514", message: "quotation_not_draft" } });
    const r = await createQuotationAction(base);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: false, error: "Chỉ báo giá ở trạng thái Nháp mới có thể chỉnh sửa" });
  });
  it("validates before touching the DB", async () => {
    const { createQuotationAction } = await import("@/lib/quotations/actions");
    const r = await createQuotationAction({ ...base, items: [] });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("update / invoice / pdf link", () => {
  it("updateQuotationAction sends the id to the same RPC", async () => {
    rpc.mockResolvedValue({ data: { id: "q1", code: "BG-X" }, error: null });
    const { updateQuotationAction } = await import("@/lib/quotations/actions");
    expect(await updateQuotationAction(P1, base)).toEqual({ ok: true, id: P1, code: "BG-X" });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_id: P1, p_code: null, p_status: "draft" });
  });
  it("invoiceFromQuotationAction maps DB codes", async () => {
    const { invoiceFromQuotationAction } = await import("@/lib/quotations/actions");
    rpc.mockResolvedValueOnce({ data: { invoice_no: "INV-2026-000007", total: 8305000 }, error: null });
    expect(await invoiceFromQuotationAction(P1)).toEqual({ ok: true, invoiceNo: "INV-2026-000007", total: 8305000 });
    expect(rpc.mock.calls[0][0]).toBe("invoice_from_quotation");
    rpc.mockResolvedValueOnce({ data: null, error: { message: "quotation_already_invoiced" } });
    expect(await invoiceFromQuotationAction(P1)).toEqual({ ok: false, error: "Báo giá này đã được lập hóa đơn" });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "period_closed" } });
    expect(((await invoiceFromQuotationAction(P1)) as { error: string }).error).toMatch(/đã khóa/);
  });
});

describe("shop identity env", () => {
  it("prefers SHOP_*, falls back to the documented NEXT_PUBLIC_SHOP_* names", () => {
    expect(getShopInfo({ SHOP_NAME: "A", NEXT_PUBLIC_SHOP_NAME: "B" }).name).toBe("A");
    expect(getShopInfo({ NEXT_PUBLIC_SHOP_NAME: "B", NEXT_PUBLIC_SHOP_PHONE: "090" })).toMatchObject({ name: "B", phone: "090" });
    expect(getShopInfo({})).toEqual({ name: "Shop Manager", taxCode: undefined, address: undefined, phone: undefined, email: undefined });
  });
});
