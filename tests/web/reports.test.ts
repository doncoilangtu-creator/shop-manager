import { describe, expect, it, vi } from "vitest";
import { parseDashboard, parsePnl, parseTopCustomers, parseTopProducts, rpcOrThrow } from "@/lib/reports";

describe("report parsers", () => {
  it("coerces dashboard fields to finite numbers (no NaN reaches the UI)", () => {
    const d = parseDashboard({ products: "5", low_stock: null, month_revenue: 1234.5, ar_balance: "x" });
    expect(d.products).toBe(5);
    expect(d.low_stock).toBe(0);
    expect(d.month_revenue).toBe(1234.5);
    expect(d.ar_balance).toBe(0);
    expect(Object.values(parseDashboard(null)).every((v) => v === 0)).toBe(true);
  });
  it("parses row sets and tolerates non-arrays", () => {
    expect(parsePnl([{ month: "2026-09-01", revenue: "10", cogs: 4, gross_profit: 6 }])).toEqual([{ month: "2026-09-01", revenue: 10, cogs: 4, gross_profit: 6 }]);
    expect(parsePnl(null)).toEqual([]);
    expect(parseTopProducts([{ product_id: "p", sku: null, name: "A", qty: "3", revenue: 5, cogs: 1, margin: 4 }])[0]).toMatchObject({ qty: 3, sku: null });
    expect(parseTopCustomers({})).toEqual([]);
  });
  it("rpcOrThrow surfaces the database error instead of returning an empty report", async () => {
    const sb = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "forbidden" } }) };
    await expect(rpcOrThrow(sb as never, "report_dashboard", undefined, parseDashboard)).rejects.toThrow("report_dashboard: forbidden");
    const ok = { rpc: vi.fn().mockResolvedValue({ data: [{ month: "m", revenue: 1, cogs: 0, gross_profit: 1 }], error: null }) };
    await expect(rpcOrThrow(ok as never, "report_monthly_pnl", { p_from: "a" }, parsePnl)).resolves.toHaveLength(1);
    expect(ok.rpc).toHaveBeenCalledWith("report_monthly_pnl", { p_from: "a" });
  });
});
