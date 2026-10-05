import Link from "next/link";
import { AlertTriangle, CheckCircle2, FileDown, FileSpreadsheet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";
import { vnDate } from "@/lib/time";
import { formatVND } from "@/lib/utils";
import { monthsIn, parsePeriodParam, periodLabel, periodOptions, vnDateText } from "@/lib/books/period";
import { s1aByGroup, s1aTotal, S1A_FORM } from "@/lib/books/s1a";
import { loadS1a } from "@/lib/books/s1a-export";
import { loadBookHeader } from "@/lib/books/server";
import { PeriodControls } from "../reports/accounting/period-controls";
import { BooksNav } from "@/components/books/books-nav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sổ sách | Shop Manager" };

type Sp = { p?: string; from?: string; to?: string; location?: string; mode?: string };
type ExportRow = { id: string; kind: string; period_from: string; period_to: string; format: string; file_name: string; sha256: string; row_count: number; total: number | null; exported_at: string };
const selectCls = "h-9 rounded-md border bg-background px-3 text-sm";

export default async function BooksPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const today = vnDate();
  const { key, period } = parsePeriodParam(sp.p, today, { from: sp.from, to: sp.to });
  const sb = await createClient();
  const locParam = sp.location && /^[0-9a-f-]{36}$/i.test(sp.location) ? sp.location : null;
  const mode = sp.mode === "daily" ? "daily" : "detail";
  const [{ header, locations, location }, rows, groupsRes, checkRes, periodsRes, exportsRes, ownerRes] = await Promise.all([
    loadBookHeader(sb, locParam),
    loadS1a(sb, period, locParam, mode),
    sb.from("tax_groups").select("code, name_vi"),
    sb.rpc("book_s1a_check", { p_from: period.from, p_to: period.to }),
    sb.from("fiscal_periods").select("year, month, status").gte("start_date", period.from.slice(0, 8) + "01").lte("start_date", period.to),
    sb.from("book_exports").select("id, kind, period_from, period_to, format, file_name, sha256, row_count, total, exported_at").order("exported_at", { ascending: false }).limit(15),
    sb.rpc("is_owner"),
  ]);
  const gname = new Map(((groupsRes.data ?? []) as Array<{ code: string; name_vi: string }>).map((g) => [g.code, g.name_vi]));
  const check = ((checkRes.data ?? []) as Array<{ s1a_total: number; gl_total: number; diff: number }>)[0];
  const status = new Map(((periodsRes.data ?? []) as Array<{ year: number; month: number; status: "open" | "closed" }>).map((r) => [`${r.year}-${r.month}`, r.status]));
  const months = monthsIn(period);
  const exports = (exportsRes.data ?? []) as ExportRow[];
  const isOwner = ownerRes.data === true;
  const total = s1aTotal(rows);
  const groups = s1aByGroup(rows, (c) => gname.get(c) ?? c);
  const qs = (format: string) => new URLSearchParams({ from: period.from, to: period.to, location: locParam ?? "", mode, format }).toString();
  const lastClosedIdx = (() => { let i = -1; months.forEach((m, k) => { if (status.get(`${m.year}-${m.month}`) === "closed") i = k; }); return i; })();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sổ sách</h1>
        <p className="text-sm text-muted-foreground">
          {S1A_FORM.title} ({S1A_FORM.code}, Thông tư 152/2025/TT-BTC) — sinh tự động từ đơn bán, phiếu trả hàng đã ghi. Số tiền là tổng tiền thanh toán (đã gồm thuế), trừ hàng bán bị trả lại/giảm giá.
        </p>
      </div>

      <BooksNav active="/books" />

      <Card className="p-4">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label htmlFor="bk-p" className="text-sm font-medium">Kỳ kê khai</label>
            <select id="bk-p" name="p" defaultValue={key} className={selectCls}>
              {periodOptions(today).map((g) => (
                <optgroup key={g.group} label={g.group}>{g.options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</optgroup>
              ))}
              <option value="c">Tự chọn (từ ngày – đến ngày)</option>
            </select>
          </div>
          <div className="space-y-1"><label htmlFor="bk-from" className="text-sm font-medium">Từ ngày</label><input id="bk-from" name="from" type="date" defaultValue={key === "c" ? period.from : ""} className={selectCls} /></div>
          <div className="space-y-1"><label htmlFor="bk-to" className="text-sm font-medium">Đến ngày</label><input id="bk-to" name="to" type="date" defaultValue={key === "c" ? period.to : ""} className={selectCls} /></div>
          <div className="space-y-1">
            <label htmlFor="bk-loc" className="text-sm font-medium">Địa điểm kinh doanh</label>
            <select id="bk-loc" name="location" defaultValue={locParam ?? ""} className={selectCls}>
              <option value="">{locations.length > 1 ? "Tất cả (tổng hợp)" : locations[0]?.name ?? "Tất cả"}</option>
              {locations.length > 1 && locations.map((l) => <option key={l.id} value={l.id}>{l.name}{l.status === "closed" ? " (đã đóng)" : ""}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="bk-mode" className="text-sm font-medium">Cách ghi</label>
            <select id="bk-mode" name="mode" defaultValue={mode} className={selectCls}>
              <option value="detail">Từng nghiệp vụ (từng đơn)</option>
              <option value="daily">Tổng hợp theo ngày</option>
            </select>
          </div>
          <Button type="submit" variant="outline">Xem sổ</Button>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">Chọn “Tự chọn” rồi nhập ngày để xem một khoảng ngày bất kỳ. Đơn chưa gắn địa điểm được tính cho trụ sở.</p>
      </Card>

      {locations.length > 1 && !locParam && (
        <Card className="border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Có {locations.length} địa điểm kinh doanh: sổ S1a lập riêng cho từng địa điểm. Bảng “Tất cả” chỉ để xem tổng hợp — hãy chọn từng địa điểm trước khi xuất sổ để ký.</div>
        </Card>
      )}
      {!header.taxCode && (
        <Card className="border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Chưa có mã số thuế trong hồ sơ hộ kinh doanh. <Link href="/settings" className="underline">Cập nhật ở Cài đặt</Link> để tiêu đề sổ đầy đủ.</div>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardHeader className="pb-2"><CardDescription>Doanh thu kỳ {periodLabel(period)}</CardDescription><CardTitle>{formatVND(total)}</CardTitle></CardHeader><CardContent className="text-xs text-muted-foreground">{rows.length} dòng sổ · {location ? location.name : header.locationLabel}</CardContent></Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Đối chiếu sổ cái (511 − 521)</CardDescription>
            <CardTitle className={check && check.diff !== 0 ? "text-destructive" : ""}>
              {check ? (check.diff === 0 ? <span className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-green-600" />Khớp</span> : `Lệch ${formatVND(check.diff)}`) : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">Toàn bộ địa điểm: S1a {formatVND(check?.s1a_total ?? 0)} · sổ cái {formatVND(check?.gl_total ?? 0)}. Chỉ so được khi kỳ trọn tháng.</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Xuất sổ để in, ký và lưu (≥ 5 năm)</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild size="sm"><a href={`/api/books/s1a?${qs("xlsx")}`}><FileSpreadsheet className="mr-2 h-4 w-4" />Excel (.xlsx)</a></Button>
            <Button asChild size="sm" variant="outline"><a href={`/api/books/s1a?${qs("pdf")}`}><FileDown className="mr-2 h-4 w-4" />PDF</a></Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-center text-base">{S1A_FORM.title}</CardTitle>
          <CardDescription className="text-center">Địa điểm kinh doanh: {header.locationLabel} · Kỳ kê khai: {periodLabel(period)} · Đơn vị tính: đồng</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead className="w-32">Ngày tháng</TableHead><TableHead>Diễn giải</TableHead><TableHead className="w-40 text-right">Số tiền</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.length === 0 && <TableRow><TableCell colSpan={3} className="py-8 text-center text-muted-foreground">Không phát sinh doanh thu trong kỳ.</TableCell></TableRow>}
              {rows.map((r, i) => (
                <TableRow key={`${r.doc_id ?? r.line_date}-${r.tax_group}-${i}`}>
                  <TableCell>{vnDateText(r.line_date)}</TableCell>
                  <TableCell>
                    {r.doc_type === "sale" && r.doc_id ? <Link className="hover:underline" href={`/sales/${r.doc_id}`}>{r.description}</Link> : r.description}
                  </TableCell>
                  <TableCell className={`text-right ${r.amount < 0 ? "text-destructive" : ""}`}>{formatVND(r.amount)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold"><TableCell /><TableCell>Tổng cộng</TableCell><TableCell className="text-right">{formatVND(total)}</TableCell></TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Theo nhóm ngành</CardTitle><CardDescription>Số liệu dùng cho thông báo doanh thu (01/TKN-CNKD).</CardDescription></CardHeader>
          <CardContent>
            <Table><TableBody>
              {groups.length === 0 && <TableRow><TableCell className="text-muted-foreground">—</TableCell></TableRow>}
              {groups.map((g) => <TableRow key={g.code}><TableCell>{g.name}</TableCell><TableCell className="text-right">{formatVND(g.amount)}</TableCell></TableRow>)}
            </TableBody></Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Khóa sổ theo tháng</CardTitle><CardDescription>Tháng đã khóa không ghi thêm chứng từ; hủy đơn sau đó được ghi thành dòng điều chỉnh ở tháng hủy, nên sổ đã in của tháng khóa không đổi.</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {months.map((m, k) => {
              const st = status.get(`${m.year}-${m.month}`) ?? "open";
              return (
                <div key={`${m.year}-${m.month}`} className="flex items-center justify-between gap-2 text-sm">
                  <span>Tháng {String(m.month).padStart(2, "0")}/{m.year} {st === "closed" ? <Badge className="ml-2">Đã khóa</Badge> : <Badge variant="outline" className="ml-2">Đang mở</Badge>}</span>
                  {isOwner && <PeriodControls year={m.year} month={m.month} status={st} canReopen={k === lastClosedIdx} />}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Lịch sử xuất sổ / tờ khai</CardTitle><CardDescription>Mỗi lần xuất được ghi lại kèm mã băm SHA-256 của file để đối chiếu bản đã ký.</CardDescription></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Thời điểm</TableHead><TableHead>File</TableHead><TableHead>Kỳ</TableHead><TableHead className="text-right">Số dòng</TableHead><TableHead className="text-right">Tổng</TableHead><TableHead>SHA-256</TableHead></TableRow></TableHeader>
            <TableBody>
              {exports.length === 0 && <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">Chưa xuất lần nào.</TableCell></TableRow>}
              {exports.map((x) => (
                <TableRow key={x.id}>
                  <TableCell className="whitespace-nowrap text-xs">{new Date(x.exported_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</TableCell>
                  <TableCell className="text-xs">{x.file_name}</TableCell>
                  <TableCell className="text-xs">{periodLabel({ from: x.period_from, to: x.period_to })}</TableCell>
                  <TableCell className="text-right text-xs">{x.row_count}</TableCell>
                  <TableCell className="text-right text-xs">{x.total === null ? "—" : formatVND(x.total)}</TableCell>
                  <TableCell className="font-mono text-[10px]" title={x.sha256}>{x.sha256.slice(0, 16)}…</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
