import { PosClient, type PosCustomer } from "./pos-client";
import type { PosProduct } from "@/lib/pos/cart";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "@/lib/actions/_shared";
import { listActiveMoneyAccounts } from "@/lib/money/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bán nhanh | Shop Manager" };

export default async function BanNhanhPage() {
  const sb = await createClient();
  const [products, customers] = await Promise.all([
    sb.from("products").select("id, sku, name, sell_price, stock_qty, tax_group").order("name").limit(2000),
    sb.from("customers").select("id, name, phone, is_walkin").eq("is_walkin", false).order("name").limit(1000),
  ]);
  const accounts = await listActiveMoneyAccounts(sb);
  return (
    <PosClient
      products={unwrap<PosProduct[]>(products, "products")}
      customers={unwrap<PosCustomer[]>(customers, "customers")}
      accounts={accounts}
    />
  );
}
