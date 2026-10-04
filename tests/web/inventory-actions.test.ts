import { beforeEach, describe, expect, it, vi } from "vitest";

// C4: stock changes only via RPC (ledger); deleting a product with history gives a clear message.
const rpc = vi.fn();
const getUser = vi.fn();
const adminCalls: Array<{ table: string; op: string; payload?: unknown }> = [];
let deleteError: { code?: string; message: string } | null = null;

function admin() {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = self; chain.eq = self; chain.neq = self; chain.limit = async () => ({ data: [], error: null });
      chain.maybeSingle = async () => ({ data: null, error: null });
      chain.single = async () => ({ data: { id: "p1" }, error: null });
      chain.update = (payload: unknown) => { adminCalls.push({ table, op: "update", payload }); return chain; };
      chain.insert = (payload: unknown) => { adminCalls.push({ table, op: "insert", payload }); return chain; };
      chain.delete = () => { adminCalls.push({ table, op: "delete" }); return { eq: async () => ({ error: deleteError }) }; };
      // awaiting the chain (update().eq()) resolves OK
      (chain as { then?: unknown }).then = (res: (v: unknown) => void) => res({ data: null, error: null });
      return chain;
    },
  };
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser }, rpc }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const UUID = "11111111-1111-4111-8111-111111111111";
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

beforeEach(() => {
  rpc.mockReset(); getUser.mockReset(); adminCalls.length = 0; deleteError = null;
  getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
});

describe("countStock", () => {
  it("calls stock_count with the counted quantity (delta is computed in SQL, not in JS)", async () => {
    rpc.mockResolvedValue({ data: { changed: true, delta: -3, stock_qty: 7 }, error: null });
    const { countStock } = await import("@/lib/actions/inventory");
    const r = await countStock(form({ product_id: UUID, counted: "7", notes: "đếm lại" }));
    expect(rpc).toHaveBeenCalledWith("stock_count", { p_product_id: UUID, p_counted: 7, p_notes: "đếm lại" });
    expect(r).toEqual({ ok: true, data: { changed: true, stock_qty: 7, delta: -3 } });
  });
  it("rejects negative / fractional counts before any RPC", async () => {
    const { countStock } = await import("@/lib/actions/inventory");
    expect((await countStock(form({ product_id: UUID, counted: "-1" }))).ok).toBe(false);
    expect((await countStock(form({ product_id: UUID, counted: "2.5" }))).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("maps DB errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "product_not_found" } });
    const { countStock } = await import("@/lib/actions/inventory");
    expect(await countStock(form({ product_id: UUID, counted: "1" }))).toEqual({ ok: false, error: "Không tìm thấy sản phẩm" });
  });
});

describe("updateProduct never writes stock", () => {
  it("ignores stock_qty from the form and does not call stock_adjust", async () => {
    const { updateProduct } = await import("@/lib/actions/inventory");
    const r = await updateProduct(UUID, form({ sku: "S1", name: "N", stock_qty: "999", cost_price: "1", sell_price: "2" }));
    expect(r.ok).toBe(true);
    const upd = adminCalls.find((c) => c.table === "products" && c.op === "update");
    expect(upd).toBeTruthy();
    expect(Object.keys(upd!.payload as object)).not.toContain("stock_qty");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("stockIn", () => {
  it("is a ledger RPC with integer positive qty", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    const { stockIn } = await import("@/lib/actions/inventory");
    expect((await stockIn(form({ product_id: UUID, qty: "0" }))).ok).toBe(false);
    expect((await stockIn(form({ product_id: UUID, qty: "1.5" }))).ok).toBe(false);
    expect((await stockIn(form({ product_id: UUID, qty: "4", unit_cost: "100" }))).ok).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe("stock_adjust");
  });
});

describe("deleteProduct", () => {
  it("explains FK-restricted deletes instead of leaking a constraint name", async () => {
    deleteError = { code: "23503", message: 'update or delete on table "products" violates foreign key constraint "stock_movements_product_id_fkey"' };
    const { deleteProduct } = await import("@/lib/actions/inventory");
    const r = await deleteProduct(UUID);
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/lịch sử nhập\/xuất kho/);
    expect((r as { error: string }).error).not.toMatch(/constraint/);
  });
});
