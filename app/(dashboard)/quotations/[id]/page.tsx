import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";
import { getQuotationDetail } from "@/lib/quotations/queries";
import { STATUS_LABEL, STATUS_VARIANT } from "@/lib/quotations/status";
import { formatDate, formatVND } from "@/lib/utils";
import { QuotationActions } from "./quotation-actions";

export const dynamic = "force-dynamic";

export default async function QuotationDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const q = await getQuotationDetail(id);
  if (!q) notFound();
  const supabase = await createClient();
  const inv = await supabase.from("sales_invoices").select("invoice_no, total").eq("quotation_id", id).is("voided_at", null).maybeSingle();
  if (inv.error) throw new Error("sales_invoices: " + inv.error.message);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon"><Link href="/quotations"><ChevronLeft className="h-5 w-5" /></Link></Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="font-mono text-2xl font-semibold tracking-tight">{q.code}</h1>
            <Badge variant={STATUS_VARIANT[q.status] ?? "outline"}>{STATUS_LABEL[q.status] ?? q.status}</Badge>
            {inv.data && <Badge variant="success">Đã lập HĐ {inv.data.invoice_no}</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            Tạo {formatDate(q.created_at)} · Hiệu lực đến {formatDate(q.valid_until) || "—"} · Khách: {q.customer?.name ?? "—"}
          </p>
        </div>
      </div>

      <QuotationActions id={q.id} status={q.status} hasPdf={!!q.pdf_path} invoiced={!!inv.data} />

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sản phẩm</TableHead><TableHead className="text-right">SL</TableHead>
              <TableHead className="text-right">Đơn giá</TableHead><TableHead className="text-right">CK %</TableHead>
              <TableHead className="text-right">Thành tiền</TableHead><TableHead>Ghi chú</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.items.map((i) => (
              <TableRow key={i.id}>
                <TableCell>{i.product ? `${i.product.sku} · ${i.product.name}` : "(Sản phẩm đã xóa)"}</TableCell>
                <TableCell className="text-right">{Number(i.qty)}</TableCell>
                <TableCell className="text-right">{formatVND(i.unit_price)}</TableCell>
                <TableCell className="text-right">{Number(i.discount)}</TableCell>
                <TableCell className="text-right font-medium">{formatVND(i.line_total)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{i.notes ?? ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="ml-auto w-full max-w-sm space-y-1 p-4 text-sm">
          <div className="flex justify-between"><span>Tạm tính</span><span>{formatVND(q.subtotal)}</span></div>
          <div className="flex justify-between"><span>Chiết khấu</span><span>- {formatVND(q.discount)}</span></div>
          <div className="flex justify-between"><span>VAT</span><span>{formatVND(q.vat)}</span></div>
          <div className="flex justify-between border-t pt-2 text-base font-semibold"><span>Tổng cộng</span><span>{formatVND(q.total)}</span></div>
        </div>
      </Card>
      {q.notes && <Card className="p-4 text-sm"><b>Ghi chú:</b> {q.notes}</Card>}
    </div>
  );
}
