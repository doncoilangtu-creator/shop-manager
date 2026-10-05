import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ThresholdProgress } from "@/components/threshold-progress";
import { createClient } from "@/lib/supabase/server";
import { rpcOrThrow } from "@/lib/reports";
import { parseRevenueByMonth, parseThresholdStatus, thresholdBanner } from "@/lib/hkd/threshold";
import { vnParts } from "@/lib/time";
import { formatVND } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Doanh thu năm & ngưỡng | Shop Manager" };

export default async function RevenueThresholdPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const sp = await searchParams;
  const thisYear = vnParts().year;
  const y = Number(sp.year);
  const year = Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : thisYear;
  const sb = await createClient();
  const [status, months] = await Promise.all([
    rpcOrThrow(sb, "threshold_status", { p_year: year }, parseThresholdStatus),
    rpcOrThrow(sb, "revenue_by_month", { p_year: year }, parseRevenueByMonth),
  ]);
  const banner = thresholdBanner(status);
  const max = Math.max(...months.map((m) => m.revenue), 1);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Doanh thu năm {year} & ngưỡng miễn thuế</h1>
          <p className="text-sm text-muted-foreground">
            Doanh thu tính thuế = tổng tiền ghi trên hóa đơn bán hàng (đã gồm thuế), không tính hóa đơn đã hủy. Tính trên mọi địa điểm và kênh bán.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm"><Link href={`/reports/revenue?year=${year - 1}`}>← {year - 1}</Link></Button>
          {year < thisYear && <Button asChild variant="outline" size="sm"><Link href={`/reports/revenue?year=${year + 1}`}>{year + 1} →</Link></Button>}
          <Button asChild variant="outline" size="sm"><Link href="/reports">Báo cáo</Link></Button>
        </div>
      </div>

      {banner && (
        <div role="alert" className={banner.tone === "danger" ? "rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900" : "rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"}>
          <div className="font-semibold">{banner.title}</div>
          <div>{banner.body}</div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Tiến độ so với ngưỡng</CardTitle>
          <CardDescription>
            {status.threshold === null
              ? "Chưa có ngưỡng được cấu hình cho năm này (bảng legal_thresholds)."
              : `Ngưỡng ${formatVND(status.threshold)} — ${status.source ?? ""}. Còn lại ${formatVND(status.remaining ?? 0)}. Cảnh báo ở ${status.warn_pct}% và 100%.`}
          </CardDescription>
        </CardHeader>
        <CardContent><ThresholdProgress status={status} /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Doanh thu theo tháng</CardTitle><CardDescription>Số tháng và lũy kế từ đầu năm</CardDescription></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {months.map((m) => (
              <div key={m.month} className="flex items-center gap-3 text-sm">
                <span className="w-20 font-mono text-xs text-muted-foreground">{m.month.slice(0, 7)}</span>
                <div className="flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-5 rounded-full bg-blue-600" style={{ width: `${(m.revenue / max) * 100}%` }} />
                </div>
                <span className="w-36 text-right font-medium">{formatVND(m.revenue)}</span>
                <span className="w-40 text-right text-xs text-muted-foreground">Lũy kế {formatVND(m.cumulative)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
