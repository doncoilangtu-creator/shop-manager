import Link from "next/link";
import { AlertTriangle, FileDown, FileSpreadsheet, Info, Lock, OctagonAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BooksNav } from "@/components/books/books-nav";
import { ThresholdProgress } from "@/components/threshold-progress";
import { createClient } from "@/lib/supabase/server";
import { vnDate } from "@/lib/time";
import { cn, formatVND } from "@/lib/utils";
import { parseThresholdStatus, thresholdBanner } from "@/lib/hkd/threshold";
import {
  BK_STATUS_VI, TKN_INDICATORS, TKN_KINDS, bkStkMissingVi, bkStkSummary, isBkPending, parseBkStkRows, parseTknKind, parseTknRows, parseTknYear,
  tknDeadlineInfo, tknMap, tknPeriod, tknThresholdNote,
} from "@/lib/books/tax-forms";
import { BkStkFiledForm } from "./bk-stk-filed-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tờ khai & bảng kê | Shop Manager" };

type Sp = { year?: string; kind?: string };
const selectCls = "h-9 rounded-md border bg-background px-3 text-sm";
const toneCls = { muted: "text-muted-foreground", info: "border-sky-300 bg-sky-50 text-sky-900", warning: "border-amber-300 bg-amber-50 text-amber-900", danger: "border-red-300 bg-red-50 text-red-900" } as const;

export default async function TaxFormsPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const today = vnDate();
  const year = parseTknYear(sp.year, today);
  const kind = parseTknKind(sp.kind);
  const curYear = Number(today.slice(0, 4));
  const sb = await createClient();
  const ownerRes = await sb.rpc("is_owner");
  const isOwner = ownerRes.data === true;
  const [tknRes, thrRes, bkRes] = await Promise.all([
    sb.rpc("tkn_cnkd_data", { p_year: year, p_half: tknPeriod(year, kind).half }),
    sb.rpc("threshold_status", { p_year: year }),
    isOwner ? sb.rpc("bk_stk_data", { p_scope: "all" }) : Promise.resolve({ data: [], error: null }),
  ]);
  if (tknRes.error) throw new Error("tkn_cnkd_data: " + tknRes.error.message);
  const tkn = tknMap(parseTknRows(tknRes.data));
  const thr = parseThresholdStatus(thrRes.data);
  const banner = thresholdBanner(thr);
  const note = tknThresholdNote(thr.level, thr.pct);
  const deadline = tknDeadlineInfo(year, kind, today);
  const bkRows = parseBkStkRows(bkRes.data);
  const bk = bkStkSummary(bkRows);
  const pendingRows = bkRows.filter(isBkPending);
  const { label: periodText } = tknPeriod(year, kind);
  const qs = (format: string) => new URLSearchParams({ year: String(year), kind, format }).toString();
  const years = Array.from({ length: Math.max(1, curYear - 2024 + 1) }, (_, i) => curYear - i);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tờ khai & bảng kê</h1>
        <p className="text-sm text-muted-foreground">
          Số liệu để nộp tay trên cổng thuế / eTax Mobile cho hộ kinh doanh doanh thu năm ≤ 1 tỷ đồng: thông báo doanh thu 01/TKN-CNKD và bảng kê tài khoản 01/BK-STK. Phần mềm không nộp thay — chủ hộ kiểm tra lại trước khi nộp.
        </p>
      </div>
      <BooksNav active="/books/tax-forms" />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Doanh thu năm {year} so với ngưỡng 1 tỷ đồng</CardTitle>
          <CardDescription>Cảnh báo khi đạt {thr.warn_pct}% và 100% ngưỡng (cùng quy tắc với banner trên mọi trang).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ThresholdProgress status={thr} />
          {banner && (
            <div role="alert" className={cn("flex gap-2 rounded-md border p-3 text-sm", banner.tone === "danger" ? toneCls.danger : toneCls.warning)}>
              {banner.tone === "danger" ? <OctagonAlert className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
              <div><div className="font-semibold">{banner.title}</div><div>{banner.body}</div></div>
            </div>
          )}
          <Link href={`/reports/revenue?year=${year}`} className="text-sm underline">Doanh thu theo tháng / nhóm ngành →</Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">01/TKN-CNKD — Thông báo doanh thu năm</CardTitle>
          <CardDescription>Mẫu theo TT 50/2026/TT-BTC. HKD doanh thu ≤ 1 tỷ chỉ thông báo doanh thu theo nhóm ngành, không khai số thuế. Lấy cùng nguồn với sổ S1a (tổng tờ khai = tổng sổ).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label htmlFor="tk-year" className="text-sm font-medium">Năm</label>
              <select id="tk-year" name="year" defaultValue={String(year)} className={selectCls}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
            </div>
            <div className="space-y-1">
              <label htmlFor="tk-kind" className="text-sm font-medium">Kỳ</label>
              <select id="tk-kind" name="kind" defaultValue={kind} className={selectCls}>{TKN_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select>
            </div>
            <Button type="submit" variant="outline">Xem</Button>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button asChild size="sm"><a href={`/api/books/tkn-cnkd?${qs("xlsx")}`}><FileSpreadsheet className="mr-2 h-4 w-4" />Excel (.xlsx)</a></Button>
              <Button asChild size="sm" variant="outline"><a href={`/api/books/tkn-cnkd?${qs("pdf")}`}><FileDown className="mr-2 h-4 w-4" />PDF</a></Button>
            </div>
          </form>
          <p className={cn("text-sm", deadline.tone === "muted" ? toneCls.muted : cn("rounded-md border p-2", toneCls[deadline.tone]))}>
            Kỳ tính thuế: <b>{periodText}</b>. {deadline.text}
          </p>
          {note && (
            <div className={cn("flex gap-2 rounded-md border p-3 text-sm", toneCls[note.tone])}>
              {note.tone === "info" ? <Info className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}<span>{note.text}</span>
            </div>
          )}
          <Table>
            <TableHeader><TableRow><TableHead>Chỉ tiêu</TableHead><TableHead className="w-24 text-center">Mã</TableHead><TableHead className="w-44 text-right">Doanh thu (đồng)</TableHead></TableRow></TableHeader>
            <TableBody>
              {TKN_INDICATORS.map((ind) => {
                const v = tkn.get(ind.code) ?? 0;
                const strong = !ind.indent;
                return (
                  <TableRow key={ind.code} className={cn(strong && "font-medium", ind.code === "11" && "font-semibold")}>
                    <TableCell className={ind.indent ? "pl-8" : ""}>{ind.label.replace(/^\[\w+\]\s*/, "")}</TableCell>
                    <TableCell className="text-center font-mono text-xs">[{ind.code}]</TableCell>
                    <TableCell className={cn("text-right", v === 0 && "text-muted-foreground")}>{formatVND(v)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">
            Cách xếp chỉ tiêu: nhóm ngành của dòng hàng (hàng hóa → a, dịch vụ → b, sản xuất/vận tải/dịch vụ gắn hàng hóa → d, khác → g); kênh bán online/sàn TMĐT → [09], còn lại → [08]. Kiểm tra nhóm ngành sản phẩm ở Kho nếu số liệu chưa đúng.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">01/BK-STK — Bảng kê tài khoản ngân hàng / ví điện tử</CardTitle>
          <CardDescription>Mẫu theo TT 18/2026/TT-BTC: thông báo mọi tài khoản dùng cho kinh doanh, khai lại khi thay đổi hoặc đóng tài khoản. Số tài khoản đầy đủ chỉ chủ hộ xem/xuất.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isOwner ? (
            <div className="flex gap-2 rounded-md border p-3 text-sm text-muted-foreground"><Lock className="mt-0.5 h-4 w-4 shrink-0" />Chỉ chủ hộ xem và xuất được bảng kê (có số tài khoản đầy đủ).</div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {bk.pending === 0
                  ? <Badge variant="secondary">Không có tài khoản cần kê khai</Badge>
                  : <>
                      <Badge variant="destructive">{bk.pending} tài khoản cần kê khai</Badge>
                      {bk.first > 0 && <Badge variant="outline">{bk.first} khai lần đầu</Badge>}
                      {bk.changed > 0 && <Badge variant="outline">{bk.changed} thay đổi</Badge>}
                      {bk.closed > 0 && <Badge variant="outline">{bk.closed} đóng</Badge>}
                      {bk.missing > 0 && <Badge variant="outline" className="border-amber-400 text-amber-700">{bk.missing} thiếu thông tin</Badge>}
                    </>}
                <div className="ml-auto flex flex-wrap gap-2">
                  <Button asChild size="sm"><a href="/api/books/bk-stk?scope=pending&format=xlsx"><FileSpreadsheet className="mr-2 h-4 w-4" />Excel — cần kê khai</a></Button>
                  <Button asChild size="sm" variant="outline"><a href="/api/books/bk-stk?scope=pending&format=pdf"><FileDown className="mr-2 h-4 w-4" />PDF — cần kê khai</a></Button>
                  <Button asChild size="sm" variant="ghost"><a href="/api/books/bk-stk?scope=all&format=xlsx">Excel — tất cả</a></Button>
                </div>
              </div>
              <Table>
                <TableHeader><TableRow><TableHead>Tài khoản</TableHead><TableHead>Số TK / số hiệu ví</TableHead><TableHead>Chủ TK</TableHead><TableHead>Địa điểm KD</TableHead><TableHead>Trạng thái [09]</TableHead><TableHead>Thiếu</TableHead></TableRow></TableHeader>
                <TableBody>
                  {bkRows.length === 0 && <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">Chưa có tài khoản ngân hàng/ví. <Link className="underline" href="/money">Thêm ở Tiền & Quỹ</Link>.</TableCell></TableRow>}
                  {bkRows.map((r) => (
                    <TableRow key={r.account_id}>
                      <TableCell>{r.label}<div className="text-xs text-muted-foreground">{r.provider ?? "—"}</div></TableCell>
                      <TableCell className="font-mono text-xs">{r.account_no ?? r.account_no_masked ?? "—"}</TableCell>
                      <TableCell>{r.holder ?? "—"}</TableCell>
                      <TableCell>{r.location_name ?? "—"}{r.location_code ? <span className="ml-1 text-xs text-muted-foreground">({r.location_code})</span> : null}</TableCell>
                      <TableCell>{isBkPending(r) ? <Badge variant="destructive">{BK_STATUS_VI[r.status]}</Badge> : <Badge variant="secondary">{BK_STATUS_VI[r.status]}{r.tax_notified_at ? ` ${r.tax_notified_at.split("-").reverse().join("/")}` : ""}</Badge>}</TableCell>
                      <TableCell className="text-xs text-amber-700">{bkStkMissingVi(r.missing) || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <BkStkFiledForm today={today} items={pendingRows.filter((r) => r.missing.length === 0 || r.status === "closed").map((r) => ({ id: r.account_id, label: r.label, status: BK_STATUS_VI[r.status] }))} />
              <p className="text-xs text-muted-foreground">Sửa số tài khoản, ngân hàng, chủ tài khoản hoặc địa điểm ở <Link className="underline" href="/money">Tiền & Quỹ</Link>; tài khoản đã thông báo mà đổi thông tin sẽ tự chuyển sang “Thay đổi thông tin”.</p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
