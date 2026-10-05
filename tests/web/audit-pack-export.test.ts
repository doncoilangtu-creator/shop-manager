import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAuditPackInput } from "@/lib/books/audit-pack-export";

type Res = { data: unknown; error: null | { message: string } };

/** Supabase giả: from(table) trả builder chainable (thenable), rpc(name,args) theo bảng tra. */
function fakeSb(tables: Record<string, unknown[]>, rpcs: (name: string, args: Record<string, unknown>) => Res) {
  const calls: Array<{ table: string; ops: Array<[string, unknown[]]> }> = [];
  const from = (table: string) => {
    const rec = { table, ops: [] as Array<[string, unknown[]]> };
    calls.push(rec);
    const b: Record<string, unknown> = {};
    for (const m of ["select", "is", "gte", "lte", "order", "eq", "limit"]) b[m] = (...a: unknown[]) => { rec.ops.push([m, a]); return b; };
    b.then = (ok: (r: Res) => unknown) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(ok);
    return b;
  };
  const rpcCalls: Array<[string, Record<string, unknown>]> = [];
  const rpc = (name: string, args: Record<string, unknown> = {}) => { rpcCalls.push([name, args]); return Promise.resolve(rpcs(name, args)); };
  return { sb: { from, rpc } as unknown as SupabaseClient, calls, rpcCalls };
}

const tables = {
  sales_invoices: [
    { id: "s1", invoice_no: "HD1", invoice_date: "2026-01-02", total: 100, customers: { name: "A" }, einvoices: [{ number: "1", symbol: "1C26TAA", status: "issued", kind: "original" }] },
    { id: "s2", invoice_no: "HD2", invoice_date: "2026-02-02", total: 200, customers: { name: "B" }, einvoices: [] },
    { id: "s3", invoice_no: "HD3", invoice_date: "2026-03-02", total: 300, customers: null, einvoices: [{ number: "7", symbol: "1C26TAA", status: "cancelled", kind: "original" }] },
  ],
  purchase_bills: [{ bill_no: "PB1", bill_date: "2026-01-05", supplier_ref: "X1", total: 500, suppliers: { name: "NCC" } }],
  v_purchase_bill_open: [{ bill_no: "PB1", allocated: 120, outstanding: 380 }],
};

function rpcs(owner: boolean) {
  return (name: string, args: Record<string, unknown>): Res => {
    switch (name) {
      case "get_business_profile": return { data: { profile: { business_name: "HKD Test", tax_code: "8012345678", residence_address: "HN", owner_name: "Chủ", industries: "Bán lẻ" } }, error: null };
      case "is_owner": return { data: owner, error: null };
      case "book_s1a_check": return { data: [{ s1a_total: 600, gl_total: 590, diff: 10 }], error: null };
      case "money_balances": {
        const open = args.p_as_of === "2025-12-31";
        return { data: [
          { account_id: "m1", kind: "cash", label: "Quỹ", gl_account: "111", balance: open ? 1000 : 1500, unassigned: false, active: true },
          { account_id: "m2", kind: "bank", label: "Bỏ", gl_account: "112", balance: 0, unassigned: false, active: false },
          { account_id: null, kind: "bank", label: "Chưa gán tài khoản (TK 112)", gl_account: "112", balance: open ? 0 : 40, unassigned: true, active: true },
        ], error: null };
      }
      case "money_book":
        if (args.p_account_id === "m1") return { data: [{ debit: 700, credit: 0 }, { debit: 0, credit: 200 }], error: null };
        if (args.p_account_id === null && args.p_gl === "112") return { data: [{ debit: 40, credit: 0 }], error: null };
        return { data: [], error: null };
      default: return { data: null, error: { message: `unexpected rpc ${name}` } };
    }
  };
}

describe("loadAuditPackInput", () => {
  it("maps profile, sales/einvoice status, purchases paid, balances and s1a check", async () => {
    const { sb, calls, rpcCalls } = fakeSb(tables, rpcs(true));
    const input = await loadAuditPackInput(sb, { year: 2026, kind: "h1", generatedBy: "me@x" });
    expect(input.period).toEqual({ kind: "h1", year: 2026, from: "2026-01-01", to: "2026-06-30", label: "6 tháng đầu năm 2026" });
    expect(input.header).toMatchObject({ businessName: "HKD Test", taxCode: "8012345678", ownerName: "Chủ", industry: "Bán lẻ" });
    expect(input.isOwner).toBe(true);
    expect(input.generatedBy).toBe("me@x");
    expect(input.sales.map((s) => [s.docNo, s.einvoiceStatus, s.einvoiceNo])).toEqual([["HD1", "issued", "1"], ["HD2", "missing", null], ["HD3", "cancelled", "7"]]);
    expect(input.purchases).toEqual([{ date: "2026-01-05", docNo: "PB1", supplier: "NCC", supplierInvoiceNo: "X1", total: 500, paid: 120 }]);
    expect(input.balances).toEqual([
      { accountName: "Quỹ", kind: "cash", opening: 1000, inflow: 700, outflow: 200, closing: 1500 },
      { accountName: "Chưa gán tài khoản (TK 112)", kind: "bank", opening: 0, inflow: 40, outflow: 0, closing: 40 },
    ]);
    expect(input.s1aCheck).toEqual({ s1aTotal: 600, glTotal: 590, diff: 10 });
    // lọc kỳ + bỏ chứng từ đã hủy
    const sales = calls.find((c) => c.table === "sales_invoices")!;
    expect(sales.ops).toContainEqual(["is", ["voided_at", null]]);
    expect(sales.ops).toContainEqual(["gte", ["invoice_date", "2026-01-01"]]);
    expect(sales.ops).toContainEqual(["lte", ["invoice_date", "2026-06-30"]]);
    expect(rpcCalls).toContainEqual(["book_s1a_check", { p_from: "2026-01-01", p_to: "2026-06-30" }]);
    expect(rpcCalls).toContainEqual(["money_balances", { p_as_of: "2025-12-31" }]);
  });

  it("rpc error surfaces with the rpc name", async () => {
    const base = rpcs(false);
    const { sb } = fakeSb(tables, (n, a) => (n === "book_s1a_check" ? { data: null, error: { message: "forbidden" } } : base(n, a)));
    await expect(loadAuditPackInput(sb, { year: 2026, kind: "year" })).rejects.toThrow(/book_s1a_check: forbidden/);
  });
});
