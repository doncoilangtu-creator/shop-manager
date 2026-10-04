import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountingErrorMessage } from "@/lib/accounting/errors";

const rpc = vi.fn();
const getUser = vi.fn();
let refs: Record<string, number> = {};   // table -> rows referencing the partner
const deleted: string[] = [];

function admin() {
  return {
    from(table: string) {
      const c: Record<string, unknown> = {};
      const self = () => c;
      c.select = self; c.eq = self;
      c.limit = async () => ({ data: Array.from({ length: refs[table] ?? 0 }, (_, i) => ({ id: String(i) })), error: null });
      c.delete = () => ({ eq: async () => { deleted.push(table); return { error: null }; } });
      return c;
    },
  };
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser }, rpc }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const UUID = "11111111-1111-4111-8111-111111111111";
const form = (o: Record<string, string | undefined>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) { if (v !== undefined) f.set(k, v); } return f; };

beforeEach(() => {
  rpc.mockReset(); getUser.mockReset(); refs = {}; deleted.length = 0;
  getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
});

describe("receipts / disbursements", () => {
  it("receiveCustomerPayment -> post_receipt_fifo with VN date default", async () => {
    rpc.mockResolvedValue({ data: { payment_no: "RC-2026-000009", allocated: 5, unapplied: 2 }, error: null });
    const { receiveCustomerPayment } = await import("@/lib/actions/accounting");
    const r = await receiveCustomerPayment(form({ partner_id: UUID, amount: "7", method: "bank" }));
    expect(r).toEqual({ ok: true, data: { payment_no: "RC-2026-000009", allocated: 5, unapplied: 2 } });
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe("post_receipt_fifo");
    expect(args).toMatchObject({ p_customer_id: UUID, p_amount: 7, p_method: "bank" });
    expect(args.p_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("paySupplier -> post_disbursement_fifo", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    const { paySupplier } = await import("@/lib/actions/accounting");
    await paySupplier(form({ partner_id: UUID, amount: "100", method: "cash", date: "2026-10-01" }));
    expect(rpc.mock.calls[0][0]).toBe("post_disbursement_fifo");
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_supplier_id: UUID, p_date: "2026-10-01" });
  });
  it("validates amount / method / date before calling the DB", async () => {
    const { receiveCustomerPayment } = await import("@/lib/actions/accounting");
    for (const bad of [{ amount: "0" }, { amount: "-5" }, { amount: "abc" }, { method: "crypto" }, { date: "01/10/2026" }]) {
      const r = await receiveCustomerPayment(form({ partner_id: UUID, amount: "5", method: "cash", ...bad }));
      expect(r.ok, JSON.stringify(bad)).toBe(false);
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it("closed period is explained in Vietnamese", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "period_closed" } });
    const { receiveCustomerPayment } = await import("@/lib/actions/accounting");
    const r = await receiveCustomerPayment(form({ partner_id: UUID, amount: "5", method: "cash" }));
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(/Kỳ kế toán .* đã khóa/);
  });
  it("accountingErrorMessage covers codes and falls back to the raw text", () => {
    expect(accountingErrorMessage("insufficient_stock_to_void: product x")).toMatch(/hoàn lại/);
    expect(accountingErrorMessage("insufficient_stock")).toBe("Tồn kho không đủ.");
    expect(accountingErrorMessage("permission denied for function x")).toMatch(/quyền/);
    expect(accountingErrorMessage("weird")).toBe("weird");
    expect(accountingErrorMessage(null)).toBe("Có lỗi xảy ra");
  });
});

describe("deleting partners with accounting history", () => {
  it.each([
    ["quotations", "báo giá"], ["maintenance_tickets", "ticket"], ["maintenance_contracts", "hợp đồng"],
    ["customer_debts", "công nợ"], ["sales_invoices", "hóa đơn"], ["payments", "phiếu thu"],
  ])("deleteCustomer is blocked by %s", async (table, word) => {
    refs[table] = 1;
    const { deleteCustomer } = await import("@/lib/actions/customers");
    const r = await deleteCustomer(UUID);
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain(word);
    expect(deleted).toEqual([]);
  });
  it("deleteCustomer proceeds when nothing references it", async () => {
    const { deleteCustomer } = await import("@/lib/actions/customers");
    expect((await deleteCustomer(UUID)).ok).toBe(true);
    expect(deleted).toEqual(["customers"]);
  });
  it("deleteSupplier is blocked by bills, payments and unpaid manual debts", async () => {
    const { deleteSupplier } = await import("@/lib/actions/suppliers");
    for (const t of ["purchase_bills", "payments", "supplier_debts"]) {
      refs = { [t]: 1 };
      const r = await deleteSupplier(UUID);
      expect(r.ok, t).toBe(false);
    }
    expect(deleted).toEqual([]);
    refs = {};
    expect((await deleteSupplier(UUID)).ok).toBe(true);
  });
});
