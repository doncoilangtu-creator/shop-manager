import { notFound, redirect } from "next/navigation";
import { QuotationForm } from "../../quotation-form";
import { getQuotationDetail, listCustomersForPicker, listProductsForPicker } from "@/lib/quotations/queries";

export const dynamic = "force-dynamic";

export default async function EditQuotationPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const [q, customers, products] = await Promise.all([getQuotationDetail(id), listCustomersForPicker(), listProductsForPicker()]);
  if (!q) notFound();
  if (q.status !== "draft") redirect(`/quotations/${id}`);
  const legacyVat = Number(q.vat) > 0;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Sửa báo giá {q.code}</h1>
      {legacyVat && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Báo giá cũ này có tách VAT ({Number(q.vat).toLocaleString("vi-VN")} đ). Hộ kinh doanh dùng giá đã gồm thuế nên khi lưu, VAT sẽ được gỡ và tổng tiền tính lại theo đơn giá hiện có.
        </p>
      )}
      <QuotationForm
        customers={customers}
        products={products}
        quotationId={q.id}
        defaultValidUntil={q.valid_until ?? ""}
        initial={{
          customer_id: q.customer_id ?? "",
          valid_until: q.valid_until ?? "",
          notes: q.notes ?? "",
          discount: Number(q.discount),
          vat_rate: 0,
          lines: q.items.map((i) => ({
            product_id: i.product_id ?? "", qty: Number(i.qty), unit_price: Number(i.unit_price),
            discount: Number(i.discount), notes: i.notes ?? "",
          })),
        }}
      />
    </div>
  );
}
