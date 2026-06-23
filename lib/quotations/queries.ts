import { createClient } from "@/lib/supabase/server";
import type {
  Customer,
  Product,
  Quotation,
  QuotationItem,
} from "@/types/db";

/** List products (for line-item picker). Lightweight — only id, sku, name, sell_price, unit, stock_qty. */
export async function listProductsForPicker(): Promise<
  Array<Pick<Product, "id" | "sku" | "name" | "sell_price" | "unit" | "stock_qty">>
> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, sku, name, sell_price, unit, stock_qty")
    .order("name", { ascending: true })
    .limit(500);
  if (error) {
    console.error("listProductsForPicker error:", error);
    return [];
  }
  return (data ?? []) as Array<
    Pick<Product, "id" | "sku" | "name" | "sell_price" | "unit" | "stock_qty">
  >;
}

/** List customers (for picker). */
export async function listCustomersForPicker(): Promise<
  Array<Pick<Customer, "id" | "name" | "type" | "phone" | "tax_code" | "address">>
> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("id, name, type, phone, tax_code, address")
    .order("name", { ascending: true })
    .limit(500);
  if (error) {
    console.error("listCustomersForPicker error:", error);
    return [];
  }
  return (data ?? []) as Array<
    Pick<Customer, "id" | "name" | "type" | "phone" | "tax_code" | "address">
  >;
}

export interface QuotationListFilters {
  status?: "draft" | "sent" | "approved" | "rejected" | "";
  customer_id?: string;
  search?: string;
}

/** Paginated quotations list, joined with customer name. */
export async function listQuotations(filters: QuotationListFilters = {}) {
  const supabase = createClient();
  let q = supabase
    .from("quotations")
    .select(
      "id, code, customer_id, status, valid_until, subtotal, discount, vat, total, created_at, updated_at, customer:customers(id, name)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (filters.status) q = q.eq("status", filters.status);
  if (filters.customer_id) q = q.eq("customer_id", filters.customer_id);
  if (filters.search) {
    const s = filters.search.trim();
    if (s.length > 0) {
      // ilike on code; the customer filter is handled separately when needed.
      q = q.ilike("code", `%${s}%`);
    }
  }

  const { data, error, count } = await q;
  if (error) {
    console.error("listQuotations error:", error);
    return { rows: [] as Quotation[], count: 0 };
  }
  return { rows: (data ?? []) as unknown as Quotation[], count: count ?? 0 };
}

export interface QuotationDetail extends Quotation {
  customer: Pick<Customer, "id" | "name" | "type" | "phone" | "email" | "address" | "tax_code" | "contact_person"> | null;
  items: Array<
    QuotationItem & { product: Pick<Product, "id" | "name" | "sku" | "unit"> | null }
  >;
}

/** Get a single quotation with items + customer (for detail page). */
export async function getQuotationDetail(id: string): Promise<QuotationDetail | null> {
  const supabase = createClient();
  const { data: header, error } = await supabase
    .from("quotations")
    .select(
      "id, code, customer_id, status, valid_until, notes, subtotal, discount, vat, total, pdf_url, created_at, updated_at, customer:customers(id, name, type, phone, email, address, tax_code, contact_person)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error || !header) return null;

  const { data: items, error: iErr } = await supabase
    .from("quotation_items")
    .select("id, quotation_id, product_id, qty, unit_price, discount, line_total, notes, product:products(id, name, sku, unit)")
    .eq("quotation_id", id)
    .order("created_at", { ascending: true, referencedTable: undefined });

  if (iErr) {
    console.error("getQuotationDetail items error:", iErr);
    return null;
  }

  return {
    ...(header as unknown as Quotation),
    customer: (header as unknown as { customer: QuotationDetail["customer"] }).customer,
    items: (items ?? []) as unknown as QuotationDetail["items"],
  };
}
