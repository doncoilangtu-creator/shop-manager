import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";
import { typed, unwrap, unwrapOne } from "@/lib/actions/_shared";
import { formatDate, formatVND } from "@/lib/utils";
import { VoidPurchaseButton } from "./void-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chi tiết phiếu mua | Shop Manager" };

type Bill = {
  id: string; bill_no: string; supplier_ref: string | null; supplier_id: string; bill_date: string; due_date: string; subtotal: number; vat_amount: number; total: number;
  memo: string | null; voided_at: string | null; suppliers: { name: string } | null;
};
type Line = { id: string; line_no: number; qty: number; unit_cost: number; vat_rate: number; line_net: number; vat_amount: number; products: { sku: string; name: string } | null };

export default async function PurchaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sb = await createClient();
  const bill = unwrapOne<Bill>(
    typed<Bill>(await sb.from("purchase_bills").select("id, bill_no, supplier_ref, supplier_id, bill_date, due_date, subtotal, vat_amount, total, memo, voided_at, suppliers(name)").eq("id", id).maybeSingle()),
    "purchase_bills",
  );
  if (!bill) notFound();
  const [lines, open] = await Promise.all([
    sb.from("purchase_bill_lines").select("id, line_no, qty, unit_cost, vat_rate, line_net, vat_amount, products(sku, name)").eq("bill_id", id).order("line_no"),
    sb.from("v_purchase_bill_open").select("outstanding").eq("bill_id", id).maybeSingle(),
  ]);
  const L = unwrap<Line[]>(typed<Line[]>(lines), "purchase_bill_lines");
  const outstanding = Number(unwrapOne<{ outstanding: number }>(open, "v_purchase_bill_open")?.outstanding ?? 0);
  const paid = Number(bill.total) - outstanding;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon"><Link href="/purchases" aria-label="Quay lại"><ArrowLeft className="h-5 w-5" /></Link></Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Phiếu mua {bill.bill_no}</h1>
            <p className="text-sm text-muted-foreground">
              {formatDate(bill.bill_date)} · {bill.suppliers?.name ?? "—"}{bill.supplier_ref ? ` · chứng từ NCC ${bill.supplier_ref}` : ""}
            </p>
          </div>
          {bill.voided_at ? <Badge variant="destructive">Đã hủy</Badge> : <Badge>Hiệu lực</Badge>}
        </div>
        {!bill.voided_at && (
          <div className="flex gap-2">
            <Button asChild size="sm"><Link href={`/suppliers/${bill.supplier_id}`}>Chi tiền nhà cung cấp</Link></Button>
            <VoidPurchaseButton billId={bill.id} />
          </div>
        )}
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sản phẩm</TableHead><TableHead className="text-right">SL</TableHead><TableHead className="text-right">Giá nhập</TableHead>
              <TableHead className="text-right">VAT hóa đơn mua</TableHead><TableHead className="text-right">Giá vốn nhập kho</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {L.map((l) => (
              <TableRow key={l.id}>
                <TableCell>{l.products ? `${l.products.sku} · ${l.products.name}` : "—"}</TableCell>
                <TableCell className="text-right">{l.qty}</TableCell>
                <TableCell className="text-right">{formatVND(l.unit_cost)}</TableCell>
                <TableCell className="text-right">{Number(l.vat_rate) > 0 ? `${Number(l.vat_rate)}% · ${formatVND(l.vat_amount)}` : "—"}</TableCell>
                <TableCell className="text-right font-medium">{formatVND(Number(l.line_net) + Number(l.vat_amount))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="ml-auto w-full max-w-sm space-y-1 p-4 text-sm">
          <div className="flex justify-between"><span>Tiền hàng</span><span>{formatVND(bill.subtotal)}</span></div>
          {Number(bill.vat_amount) > 0 && <div className="flex justify-between"><span>VAT hóa đơn mua (tính vào giá vốn)</span><span>{formatVND(bill.vat_amount)}</span></div>}
          <div className="flex justify-between border-t pt-2 text-base font-semibold"><span>Phải trả nhà cung cấp</span><span>{formatVND(bill.total)}</span></div>
          {!bill.voided_at && (
            <>
              <div className="flex justify-between text-muted-foreground"><span>Đã chi</span><span>{formatVND(paid)}</span></div>
              <div className="flex justify-between"><span>Còn nợ</span><span className={outstanding > 0 ? "font-semibold text-destructive" : ""}>{formatVND(outstanding)}</span></div>
              <div className="flex justify-between text-muted-foreground"><span>Hạn thanh toán</span><span>{formatDate(bill.due_date)}</span></div>
            </>
          )}
        </div>
      </Card>
      {bill.memo && <Card className="p-4 text-sm"><b>Ghi chú:</b> {bill.memo}</Card>}
      <p className="text-xs text-muted-foreground">Hủy phiếu chỉ được khi chưa chi tiền cho phiếu này và hàng chưa bán hết; hệ thống đảo bút toán và hoàn kho đúng giá trị đã nhập.</p>
    </div>
  );
}
