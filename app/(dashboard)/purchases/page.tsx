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
export const metadata = { title: "Mua hàng | Shop Manager" };

type Row = {
  id: string; bill_no: string; supplier_ref: string | null; bill_date: string; due_date: string; total: number; vat_amount: number; voided_at: string | null;
  suppliers: { name: string } | null;
};

export default async function PurchasesPage() {
  const sb = await createClient();
  const rows = unwrap<Row[]>(
    typed<Row[]>(await sb
      .from("purchase_bills")
      .select("id, bill_no, supplier_ref, bill_date, due_date, total, vat_amount, voided_at, suppliers(name)")
      .order("bill_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200)),
    "purchase_bills",
  );
  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Mua hàng</h1>
          <p className="text-sm text-muted-foreground">
            Nhập hàng phải có chứng từ mua và nhà cung cấp. Hộ kinh doanh không khấu trừ VAT đầu vào: thuế trên hóa đơn mua (nếu có) được tính vào giá vốn hàng hóa.
          </p>
        </div>
        <Button asChild><Link href="/purchases/new"><Plus className="mr-2 h-4 w-4" />Lập phiếu mua</Link></Button>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Số phiếu</TableHead><TableHead>Ngày</TableHead><TableHead>Nhà cung cấp</TableHead><TableHead>Số chứng từ NCC</TableHead>
              <TableHead className="text-right">Tổng tiền</TableHead><TableHead>Hạn thanh toán</TableHead><TableHead>Trạng thái</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Chưa có phiếu mua.</TableCell></TableRow>}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell><Link className="font-medium hover:underline" href={`/purchases/${r.id}`}>{r.bill_no}</Link></TableCell>
                <TableCell>{formatDate(r.bill_date)}</TableCell>
                <TableCell>{r.suppliers?.name ?? "—"}</TableCell>
                <TableCell>{r.supplier_ref ?? "—"}</TableCell>
                <TableCell className="text-right">{formatVND(r.total)}</TableCell>
                <TableCell>{formatDate(r.due_date)}</TableCell>
                <TableCell>{r.voided_at ? <Badge variant="destructive">Đã hủy</Badge> : <Badge>Hiệu lực</Badge>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
