import { PurchaseForm, type PurchaseProduct, type PurchaseSupplier } from "./purchase-form";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "@/lib/actions/_shared";
import { vnDate } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lập phiếu mua | Shop Manager" };

export default async function NewPurchasePage() {
  const sb = await createClient();
  const [products, suppliers] = await Promise.all([
    sb.from("products").select("id, sku, name, stock_qty, cost_price").order("name").limit(2000),
    sb.from("suppliers").select("id, name, phone").order("name").limit(1000),
  ]);
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Lập phiếu mua</h1>
        <p className="text-sm text-muted-foreground">
          Nhập hàng vào kho kèm chứng từ mua. Phiếu ghi nhận công nợ nhà cung cấp; thanh toán thực hiện ở trang nhà cung cấp.
        </p>
      </div>
      <PurchaseForm
        products={unwrap<PurchaseProduct[]>(products, "products")}
        suppliers={unwrap<PurchaseSupplier[]>(suppliers, "suppliers")}
        today={vnDate()}
      />
    </div>
  );
}
