import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listQuotations, type QuotationListFilters } from "@/lib/quotations/queries";
import { formatDate, formatVND } from "@/lib/utils";
import { STATUS_LABEL, STATUS_VARIANT } from "@/lib/quotations/status";

export const dynamic = "force-dynamic";

export default async function QuotationsPage(props: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const sp = await props.searchParams;
  const status = (["draft", "sent", "approved", "rejected"].includes(sp.status ?? "") ? sp.status : "") as QuotationListFilters["status"];
  const { rows, count } = await listQuotations({ status, search: sp.q });
  type Row = (typeof rows)[number] & { customer?: { name?: string } | { name?: string }[] | null };
  const custName = (r: Row) => (Array.isArray(r.customer) ? r.customer[0]?.name : r.customer?.name) ?? "—";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Báo giá</h1>
          <p className="text-sm text-muted-foreground">Tạo và quản lý báo giá cho khách hàng. {count} báo giá.</p>
        </div>
        <Button asChild><Link href="/quotations/new"><Plus className="mr-2 h-4 w-4" />Báo giá mới</Link></Button>
      </div>

      <Card className="flex flex-wrap items-center gap-2 p-3">
        {[["", "Tất cả"], ["draft", "Nháp"], ["sent", "Đã gửi"], ["approved", "Đã duyệt"], ["rejected", "Từ chối"]].map(([v, label]) => (
          <Button key={v} asChild size="sm" variant={(status || "") === v ? "default" : "outline"}>
            <Link href={{ pathname: "/quotations", query: { ...(v ? { status: v } : {}), ...(sp.q ? { q: sp.q } : {}) } }}>{label}</Link>
          </Button>
        ))}
        <form className="ml-auto flex gap-2" action="/quotations">
          {status && <input type="hidden" name="status" value={status} />}
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Tìm theo mã…" className="h-9 rounded-md border bg-background px-3 text-sm" />
          <Button type="submit" variant="secondary" size="sm">Tìm</Button>
        </form>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Mã</TableHead><TableHead>Khách hàng</TableHead><TableHead>Trạng thái</TableHead>
              <TableHead>Hiệu lực</TableHead><TableHead className="text-right">Tổng</TableHead><TableHead>Ngày tạo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">Chưa có báo giá phù hợp.</TableCell></TableRow>
            ) : (
              (rows as Row[]).map((r) => (
                <TableRow key={r.id}>
                  <TableCell><Link href={`/quotations/${r.id}`} className="font-mono text-xs font-medium hover:underline">{r.code}</Link></TableCell>
                  <TableCell>{custName(r)}</TableCell>
                  <TableCell><Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>{STATUS_LABEL[r.status] ?? r.status}</Badge></TableCell>
                  <TableCell>{formatDate(r.valid_until)}</TableCell>
                  <TableCell className="text-right font-medium">{formatVND(r.total)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(r.created_at)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
