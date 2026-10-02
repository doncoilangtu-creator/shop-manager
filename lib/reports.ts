import type { SupabaseClient } from "@supabase/supabase-js";

export type DashboardStats = {
  products: number; low_stock: number; customers: number; business_customers: number;
  open_tickets: number; pending_quotations: number;
  month_revenue: number; month_cogs: number; ar_balance: number; ap_balance: number; stock_value: number;
  overdue_invoices: number;
};
export type PnlRow = { month: string; revenue: number; cogs: number; gross_profit: number };
export type TopProduct = { product_id: string; sku: string | null; name: string | null; qty: number; revenue: number; cogs: number; margin: number };
export type TopCustomer = { customer_id: string; name: string; invoices: number; revenue: number; outstanding: number };

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** The RPC returns jsonb; coerce every field to a finite number so the UI never renders NaN/undefined. */
export function parseDashboard(raw: unknown): DashboardStats {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    products: num(o.products), low_stock: num(o.low_stock), customers: num(o.customers),
    business_customers: num(o.business_customers), open_tickets: num(o.open_tickets),
    pending_quotations: num(o.pending_quotations), month_revenue: num(o.month_revenue), month_cogs: num(o.month_cogs),
    ar_balance: num(o.ar_balance), ap_balance: num(o.ap_balance), stock_value: num(o.stock_value),
    overdue_invoices: num(o.overdue_invoices),
  };
}

export const parsePnl = (raw: unknown): PnlRow[] =>
  (Array.isArray(raw) ? raw : []).map((r) => { const o = r as Record<string, unknown>; return { month: String(o.month), revenue: num(o.revenue), cogs: num(o.cogs), gross_profit: num(o.gross_profit) }; });

export const parseTopProducts = (raw: unknown): TopProduct[] =>
  (Array.isArray(raw) ? raw : []).map((r) => { const o = r as Record<string, unknown>; return {
    product_id: String(o.product_id), sku: (o.sku as string | null) ?? null, name: (o.name as string | null) ?? null,
    qty: num(o.qty), revenue: num(o.revenue), cogs: num(o.cogs), margin: num(o.margin) }; });

export const parseTopCustomers = (raw: unknown): TopCustomer[] =>
  (Array.isArray(raw) ? raw : []).map((r) => { const o = r as Record<string, unknown>; return {
    customer_id: String(o.customer_id), name: String(o.name ?? ""), invoices: num(o.invoices), revenue: num(o.revenue), outstanding: num(o.outstanding) }; });

/** Throws with the PostgREST message instead of rendering an empty report on failure. */
export async function rpcOrThrow<T>(sb: SupabaseClient, fn: string, args: Record<string, unknown> | undefined, parse: (raw: unknown) => T): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return parse(data);
}
