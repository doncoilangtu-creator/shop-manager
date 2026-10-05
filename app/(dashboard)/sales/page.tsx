import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";
import { typed, unwrap } from "@/lib/actions/_shared";
import { formatDate, formatVND } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bán hàng | Shop Manager" };

type Row = {
  id: string; invoice_no: string; invoice_date: string; total: number; paid_at_sale: number; voided_at: string | null; sale_source: string;
  customers: { name: string; is_walkin: boolean } | null;
  einvoices: Array<{ status: string; kind: string; number: string }>;
};

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const sp = await searchParams;
  const missingOnly = sp.filter === "missing-einvoice";
  const sb = await createClient();
  const rows = unwrap<Row[]>(
    typed<Row[]>(await sb
      .from("sales_invoices")
      .select("id, invoice_no, invoice_date, total, paid_at_sale, voided_at, sale_source, customers(name, is_walkin), einvoices(status, kind, number)")
      .order("invoice_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200)),
    "sales_invoices",
  );
  const active = (r: Row) => r.einvoices.find((e) => e.status === "issued" && e.kind !== "adjust");
  const shown = missingOnly ? rows.filter((r) => !r.voided_at && !active(r)) : rows;
  const missing = rows.filter((r) => !r.voided_at && !active(r)).length;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bán hàng</h1>
          <p className="text-sm text-muted-foreground">Đơn bán theo chế độ hộ kinh doanh: giá đã gồm thuế, không tách VAT. Thu tiền ngay hoặc ghi công nợ cho khách có tên.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="default"><Link href="/ban-nhanh"><Plus className="mr-2 h-4 w-4" />Bán nhanh</Link></Button>
          <Button asChild variant="outline"><Link href="/sales/new">Bán hàng (form đầy đủ)</Link></Button>
        </div>
      </div>
      <div className="flex gap-2 text-sm">
        <Button asChild size="sm" variant={missingOnly ? "outline" : "secondary"}><Link href="/sales">Tất cả</Link></Button>
        <Button asChild size="sm" variant={missingOnly ? "secondary" : "outline"}><Link href="/sales?filter=missing-einvoice">Chưa có hóa đơn điện tử ({missing})</Link></Button>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Số đơn</TableHead><TableHead>Ngày</TableHead><TableHead>Khách hàng</TableHead>
              <TableHead className="text-right">Tổng tiền</TableHead><TableHead className="text-right">Đã thu</TableHead>
              <TableHead>Hóa đơn điện tử</TableHead><TableHead>Trạng thái</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Chưa có đơn bán.</TableCell></TableRow>}
            {shown.map((r) => {
              const e = active(r);
              return (
                <TableRow key={r.id}>
                  <TableCell><Link className="font-medium hover:underline" href={`/sales/${r.id}`}>{r.invoice_no}</Link></TableCell>
                  <TableCell>{formatDate(r.invoice_date)}</TableCell>
                  <TableCell>{r.customers?.name ?? "—"}</TableCell>
                  <TableCell className="text-right">{formatVND(r.total)}</TableCell>
                  <TableCell className="text-right">{r.sale_source === "hkd_sale" ? formatVND(r.paid_at_sale) : "—"}</TableCell>
                  <TableCell>{e ? <Badge variant="secondary">{e.number}</Badge> : r.voided_at ? "—" : <Badge variant="outline">Chưa có</Badge>}</TableCell>
                  <TableCell>{r.voided_at ? <Badge variant="destructive">Đã hủy</Badge> : <Badge>Hiệu lực</Badge>}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
