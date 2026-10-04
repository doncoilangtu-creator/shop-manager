import { notFound, redirect } from "next/navigation";
import { QuotationForm } from "../../quotation-form";
import { getQuotationDetail, listCustomersForPicker, listProductsForPicker } from "@/lib/quotations/queries";

export const dynamic = "force-dynamic";

export default async function EditQuotationPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const [q, customers, products] = await Promise.all([getQuotationDetail(id), listCustomersForPicker(), listProductsForPicker()]);
  if (!q) notFound();
  if (q.status !== "draft") redirect(`/quotations/${id}`);
  const base = Number(q.subtotal) - Number(q.discount);
  const vatRate = base > 0 ? Math.round((Number(q.vat) * 100) / base) : 10;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Sửa báo giá {q.code}</h1>
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
          vat_rate: [0, 5, 8, 10].includes(vatRate) ? vatRate : 10,
          lines: q.items.map((i) => ({
            product_id: i.product_id ?? "", qty: Number(i.qty), unit_price: Number(i.unit_price),
            discount: Number(i.discount), notes: i.notes ?? "",
          })),
        }}
      />
    </div>
  );
}
