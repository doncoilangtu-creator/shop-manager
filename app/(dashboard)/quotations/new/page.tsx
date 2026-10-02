import { QuotationForm } from "../quotation-form";
import { listCustomersForPicker, listProductsForPicker } from "@/lib/quotations/queries";
import { vnDate } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function NewQuotationPage() {
  const [customers, products] = await Promise.all([listCustomersForPicker(), listProductsForPicker()]);
  const in30 = vnDate(new Date(Date.now() + 30 * 86400_000));
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Báo giá mới</h1>
        <p className="text-sm text-muted-foreground">Chọn khách hàng, thêm sản phẩm từ kho. Giá và thuế được tính lại ở máy chủ.</p>
      </div>
      <QuotationForm customers={customers} products={products} defaultValidUntil={in30} />
    </div>
  );
}
