import Link from "next/link";
import { cookies } from "next/headers";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EinvoiceReminderButtons } from "@/components/einvoice/reminder-buttons";
import { createClient } from "@/lib/supabase/server";
import { vnDate } from "@/lib/time";
import { formatDate, formatVND } from "@/lib/utils";
import { periodLabel } from "@/lib/books/period";
import {
  EINV_REMINDER_COOKIE,
  parseMissingFilter,
  parseMissingRows,
  reminderEnabled,
  reminderVisible,
  summarizeMissing,
} from "@/lib/einvoice/missing";

export const dynamic = "force-dynamic";

type Sp = Record<string, string | string[] | undefined>;
const selectCls = "h-9 rounded-md border bg-background px-3 text-sm";
const ROW_LIMIT = 2000;

const KINDS = [
  { value: "month", label: "Tháng" },
  { value: "quarter", label: "Quý" },
  { value: "year", label: "Năm" },
  { value: "custom", label: "Tự chọn ngày" },
] as const;

export default async function MissingEinvoicePage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const today = vnDate();
  const filter = parseMissingFilter(sp, today);
  const { period } = filter;
  const thisYear = Number(today.slice(0, 4));
  const years = Array.from({ length: 6 }, (_, i) => thisYear - i);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_sales_missing_einvoice")
    .select("sale_id, invoice_no, invoice_date, customer_id, customer_name, total")
    .gte("invoice_date", period.from)
    .lte("invoice_date", period.to)
    .order("invoice_date", { ascending: true })
    .order("invoice_no", { ascending: true })
    .limit(ROW_LIMIT);
  const rows = parseMissingRows(data);
  const sum = summarizeMissing(rows);

  const cookieValue = (await cookies()).get(EINV_REMINDER_COOKIE)?.value;
  const enabled = reminderEnabled(cookieValue);
  const visible = reminderVisible(cookieValue, today);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Đơn bán chưa có hóa đơn điện tử</h1>
        <p className="text-sm text-muted-foreground">
          Các đơn bán chưa hủy, chưa ghi nhận hóa đơn điện tử (gốc hoặc thay thế) đã phát hành.
        </p>
      </div>

      <div className="flex gap-2 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Việc có bắt buộc xuất hóa đơn điện tử hay không tùy theo hướng dẫn của Thuế cơ sở (Nghị định 254/2026, Thông
          tư 91/2026). Nhắc nhở này không chặn việc bán hàng.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Kỳ xem</CardTitle>
          <CardDescription>{periodLabel(period)}</CardDescription>
        </CardHeader>
        <CardContent>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="me-kind">Loại kỳ</Label>
              <select id="me-kind" name="kind" defaultValue={filter.kind} className={selectCls}>
                {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="me-year">Năm</Label>
              <select id="me-year" name="year" defaultValue={String(filter.year)} className={selectCls}>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="me-n">Tháng / Quý số</Label>
              <Input id="me-n" name="n" type="number" min={1} max={12} defaultValue={filter.n} className="h-9 w-24" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="me-from">Từ ngày (tự chọn)</Label>
              <Input id="me-from" name="from" type="date" defaultValue={period.from} className="h-9" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="me-to">Đến ngày (tự chọn)</Label>
              <Input id="me-to" name="to" type="date" defaultValue={period.to} className="h-9" />
            </div>
            <Button type="submit" size="sm">Xem</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {sum.count} đơn · tổng {formatVND(sum.total)}
          </CardTitle>
          {rows.length >= ROW_LIMIT && (
            <CardDescription>Chỉ hiển thị {ROW_LIMIT} đơn đầu tiên; hãy chọn kỳ ngắn hơn.</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="text-sm text-destructive">Không tải được danh sách: {error.message}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Không có đơn bán nào thiếu hóa đơn điện tử trong kỳ này.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ngày</TableHead>
                  <TableHead>Số đơn</TableHead>
                  <TableHead>Khách hàng</TableHead>
                  <TableHead className="text-right">Tổng tiền</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.sale_id}>
                    <TableCell className="whitespace-nowrap">{formatDate(r.invoice_date)}</TableCell>
                    <TableCell>
                      <Link href={`/sales/${r.sale_id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                        {r.invoice_no || "(chưa có số)"}
                      </Link>
                    </TableCell>
                    <TableCell>{r.customer_name}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatVND(r.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Nhắc trên Dashboard</CardTitle>
          <CardDescription>
            {!enabled
              ? "Đang tắt: Dashboard không hiển thị nhắc đơn chưa có hóa đơn điện tử."
              : visible
                ? "Đang bật: Dashboard nhắc khi quý hiện tại còn đơn chưa có hóa đơn điện tử."
                : "Đang tạm ẩn (đã chọn nhắc lại sau 30 ngày)."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EinvoiceReminderButtons modes={!enabled ? ["on"] : visible ? ["snooze", "off"] : ["on", "off"]} />
        </CardContent>
      </Card>
    </div>
  );
}
