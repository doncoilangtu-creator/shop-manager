import { CheckCircle2, Info, OctagonAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BooksNav } from "@/components/books/books-nav";
import { AuditPackButton } from "@/components/books/audit-pack-button";
import { createClient } from "@/lib/supabase/server";
import { vnDate, vnParts } from "@/lib/time";
import { cn, formatVND } from "@/lib/utils";
import { TKN_KINDS, parseTknKind, parseTknYear, tknPeriod } from "@/lib/books/tax-forms";
import { AUDIT_PACK_MAX_BYTES, fmtMB } from "@/lib/books/audit-pack";

const p2 = (n: number) => String(n).padStart(2, "0");
const vnDateTime = (iso: string) => { const p = vnParts(iso); return `${p2(p.day)}/${p2(p.month)}/${p.year} ${p2(p.hour)}:${p2(p.minute)}`; };

export const dynamic = "force-dynamic";
export const metadata = { title: "Gói hồ sơ kiểm tra | Shop Manager" };

type Sp = { year?: string; kind?: string };
type ExportRow = { id: string; period_from: string; period_to: string; file_name: string; sha256: string; row_count: number; exported_at: string; options: Record<string, unknown> | null };
const selectCls = "h-9 rounded-md border bg-background px-3 text-sm";

const CONTENTS = [
  { dir: "01-so-S1a/", text: "Sổ doanh thu S1a-HKD của kỳ (Excel + PDF)." },
  { dir: "02-to-khai/", text: "Thông báo doanh thu 01/TKN-CNKD (Excel + PDF); bảng kê tài khoản 01/BK-STK khi chủ hộ xuất." },
  { dir: "03-ban-hang-hoa-don/", text: "Bảng kê chứng từ bán hàng đối chiếu hóa đơn điện tử, đánh dấu chứng từ chưa xuất hóa đơn." },
  { dir: "04-mua-hang/", text: "Bảng kê mua hàng: nhà cung cấp, số hóa đơn đầu vào, đã trả / còn nợ." },
  { dir: "05-tien/", text: "Số dư đầu kỳ, thu, chi, số dư cuối kỳ của tiền mặt / ngân hàng / ví điện tử." },
  { dir: "README.txt · manifest.json · SHA256SUMS.txt", text: "Mô tả gói, kết quả đối chiếu và mã băm SHA-256 từng file để chứng minh không bị sửa." },
];

export default async function AuditPackPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const today = vnDate();
  const year = parseTknYear(sp.year, today);
  const kind = parseTknKind(sp.kind);
  const curYear = Number(today.slice(0, 4));
  const { label, period } = tknPeriod(year, kind);
  const sb = await createClient();
  const [ownerRes, checkRes, missingRes, exportsRes] = await Promise.all([
    sb.rpc("is_owner"),
    sb.rpc("book_s1a_check", { p_from: period.from, p_to: period.to }),
    sb.from("v_sales_missing_einvoice").select("sale_id", { count: "exact", head: true }).gte("invoice_date", period.from).lte("invoice_date", period.to),
    sb.from("book_exports").select("id, period_from, period_to, file_name, sha256, row_count, exported_at, options").eq("kind", "audit_pack").order("exported_at", { ascending: false }).limit(10),
  ]);
  const isOwner = ownerRes.data === true;
  const check = ((checkRes.data as Array<{ s1a_total: number; gl_total: number; diff: number }> | null) ?? [])[0] ?? null;
  const diff = check ? Number(check.diff) : null;
  const missing = missingRes.count ?? null;
  const exportsList = (exportsRes.data ?? []) as ExportRow[];
  const years = Array.from({ length: Math.max(1, curYear - 2024 + 1) }, (_, i) => curYear - i);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Gói hồ sơ kiểm tra</h1>
        <p className="text-sm text-muted-foreground">
          Một file .zip gom sổ sách, tờ khai và bảng đối chiếu của một kỳ để gửi cơ quan thuế hoặc người kiểm tra. Mỗi lần tạo gói được ghi nhật ký kèm mã SHA-256.
        </p>
      </div>
      <BooksNav active="/books/audit-pack" />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Chọn kỳ</CardTitle>
          <CardDescription>Kỳ: {label} ({period.from} → {period.to})</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label htmlFor="ap-year" className="text-sm font-medium">Năm</label>
              <select id="ap-year" name="year" defaultValue={String(year)} className={selectCls}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
            </div>
            <div className="space-y-1">
              <label htmlFor="ap-kind" className="text-sm font-medium">Kỳ</label>
              <select id="ap-kind" name="kind" defaultValue={kind} className={selectCls}>{TKN_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select>
            </div>
            <Button type="submit" variant="outline">Xem</Button>
            <AuditPackButton year={year} kind={kind} />
          </form>

          <div className="grid gap-3 sm:grid-cols-2">
            <div role="status" className={cn("flex gap-2 rounded-md border p-3 text-sm", diff === null ? "text-muted-foreground" : diff === 0 ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-red-300 bg-red-50 text-red-900")}>
              {diff === 0 ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <OctagonAlert className="mt-0.5 h-4 w-4 shrink-0" />}
              <div>
                <div className="font-semibold">Sổ S1a so với sổ cái: {diff === null ? "chưa kiểm tra được" : diff === 0 ? "khớp" : `lệch ${formatVND(diff)}`}</div>
                {check && <div>S1a {formatVND(Number(check.s1a_total))} · sổ cái {formatVND(Number(check.gl_total))}</div>}
              </div>
            </div>
            <div role="status" className={cn("flex gap-2 rounded-md border p-3 text-sm", missing ? "border-amber-300 bg-amber-50 text-amber-900" : "text-muted-foreground")}>
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-semibold">Chứng từ bán hàng chưa xuất hóa đơn điện tử: {missing ?? "?"}</div>
                <div>Vẫn được đưa vào gói, đánh dấu “Chưa xuất HĐ” trong bảng kê bán hàng.</div>
              </div>
            </div>
          </div>
          {!isOwner && (
            <p className="text-sm text-muted-foreground">Bạn không phải chủ hộ: gói sẽ không gồm bảng kê 01/BK-STK (README ghi rõ lý do).</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Trong gói có gì</CardTitle></CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm">
            {CONTENTS.map((c) => <li key={c.dir}><span className="font-mono text-xs">{c.dir}</span> — {c.text}</li>)}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">Gói tối đa khoảng {fmtMB(AUDIT_PACK_MAX_BYTES)}; nếu dữ liệu cả năm quá lớn, hãy xuất theo từng 6 tháng.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Các lần xuất gần đây</CardTitle></CardHeader>
        <CardContent>
          {exportsList.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa xuất gói hồ sơ nào.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Thời điểm</TableHead><TableHead>Kỳ</TableHead><TableHead>File</TableHead><TableHead className="text-right">Số file</TableHead><TableHead>SHA-256</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {exportsList.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap">{vnDateTime(e.exported_at)}</TableCell>
                    <TableCell className="whitespace-nowrap">{e.period_from} → {e.period_to}</TableCell>
                    <TableCell className="break-all">{e.file_name}{e.options?.bk_stk_included === false && <Badge variant="outline" className="ml-2">không BK-STK</Badge>}</TableCell>
                    <TableCell className="text-right">{e.row_count}</TableCell>
                    <TableCell className="font-mono text-xs" title={e.sha256}>{e.sha256.slice(0, 16)}…</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
