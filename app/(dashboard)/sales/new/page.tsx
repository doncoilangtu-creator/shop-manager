import { SaleForm, type SaleCustomer, type SaleProduct, type TaxGroupOption } from "./sale-form";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "@/lib/actions/_shared";
import { vnDate } from "@/lib/time";
import { listActiveMoneyAccounts } from "@/lib/money/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bán hàng mới | Shop Manager" };

export default async function NewSalePage() {
  const sb = await createClient();
  const [products, customers, groups] = await Promise.all([
    sb.from("products").select("id, sku, name, sell_price, stock_qty, tax_group").order("name").limit(1000),
    sb.from("customers").select("id, name, phone, is_walkin").eq("is_walkin", false).order("name").limit(1000),
    sb.from("tax_groups").select("code, name_vi").order("sort_order"),
  ]);
  const accounts = await listActiveMoneyAccounts(sb);
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Bán hàng</h1>
        <p className="text-sm text-muted-foreground">Đơn giá là giá đã gồm thuế. Hệ thống ghi doanh thu bằng tổng tiền, không tách VAT trên hóa đơn bán hàng.</p>
      </div>
      <SaleForm
        products={unwrap<SaleProduct[]>(products, "products")}
        customers={unwrap<SaleCustomer[]>(customers, "customers")}
        taxGroups={unwrap<TaxGroupOption[]>(groups, "tax_groups")}
        today={vnDate()}
        accounts={accounts}
      />
    </div>
  );
}
