import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { formatVND } from "@/lib/utils";
import { vnDate, vnParts } from "@/lib/time";
import { parseAccountingMode, parseAging, parseRecon, parseTrialBalance, parseVat, rpcOrThrow } from "@/lib/reports";
import { parseThresholdStatus, thresholdBanner } from "@/lib/hkd/threshold";
import { PeriodControls, PostStockAdjustmentsButton } from "./period-controls";

export const dynamic = "force-dynamic";

export default async function AccountingReportPage(props: { searchParams: Promise<{ month?: string }> }) {
  const sp = await props.searchParams;
  const cur = vnParts();
  const m = /^(\d{4})-(\d{2})$/.exec(sp.month ?? "");
  const year = m ? Number(m[1]) : cur.year;
  const month = m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? Number(m[2]) : cur.month;
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = `${year}-${mm}-${String(lastDay).padStart(2, "0")}`;
  const sb = await createClient();

  const mode = await rpcOrThrow(sb, "accounting_mode", undefined, parseAccountingMode);
  const [tb, vat, thr, aging, recon, periods, owner] = await Promise.all([
    rpcOrThrow(sb, "trial_balance", { p_from: null, p_to: to }, parseTrialBalance),
    // Báo cáo Thuế GTGT chỉ còn ở chế độ enterprise (legacy); hộ kinh doanh không có TK 3331/133.
    mode === "enterprise" ? rpcOrThrow(sb, "vat_report", { p_year: year, p_month: month }, parseVat) : Promise.resolve(null),
    rpcOrThrow(sb, "threshold_status", { p_year: year }, parseThresholdStatus),
    rpcOrThrow(sb, "ar_aging", { p_as_of: vnDate() }, parseAging),
    rpcOrThrow(sb, "accounting_reconciliation", undefined, parseRecon),
    sb.from("fiscal_periods").select("year, month, status, closed_at").order("year", { ascending: false }).order("month", { ascending: false }).limit(12),
    sb.rpc("is_owner"),
  ]);
  if (periods.error) throw new Error("fiscal_periods: " + periods.error.message);
  const thisPeriod = (periods.data ?? []).find((p) => p.year === year && p.month === month);
  const totalD = tb.reduce((s, r) => s + r.debit, 0);
  const totalC = tb.reduce((s, r) => s + r.credit, 0);
  const prev = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
  const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
  const bad = recon.filter((r) => r.diff !== 0);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Báo cáo kế toán {mm}/{year}</h1>
          <p className="text-sm text-muted-foreground">Số liệu từ sổ cái · giờ Việt Nam</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm"><Link href="/reports">← Báo cáo</Link></Button>
          <Button asChild variant="outline" size="sm"><Link href={`/reports/accounting?month=${prev}`}>Tháng trước</Link></Button>
          <Button asChild variant="outline" size="sm"><Link href={`/reports/accounting?month=${next}`}>Tháng sau</Link></Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Kỳ kế toán</CardTitle>
          <CardDescription>
            Kỳ {mm}/{year}: {thisPeriod ? (thisPeriod.status === "closed" ? "đã khóa" : "đang mở") : "chưa có chứng từ (chưa tạo kỳ)"}.
            Chỉ chủ cửa hàng được khóa/mở lại.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {owner.data === true && thisPeriod ? (
            <PeriodControls year={year} month={month} status={thisPeriod.status as "open" | "closed"} canReopen />
          ) : <span className="text-sm text-muted-foreground">Không có thao tác (cần quyền chủ cửa hàng và kỳ đã có chứng từ).</span>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Đối chiếu sổ phụ ↔ sổ cái</CardTitle>
          <CardDescription>{bad.length === 0 ? "Tất cả chênh lệch bằng 0." : `${bad.length} mục chênh lệch — nếu là tồn kho (156), có phiếu kho không chứng từ (nhập/xuất tay, kiểm kê, bot) chưa vào sổ cái.`}</CardDescription>
        </CardHeader>
        <CardContent>
          {bad.some((r) => r.check_name.startsWith("Inventory")) && <div className="mb-3"><PostStockAdjustmentsButton /></div>}
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted-foreground"><th>Kiểm tra</th><th className="text-right">Sổ cái</th><th className="text-right">Sổ phụ</th><th className="text-right">Chênh</th></tr></thead>
            <tbody>
              {recon.map((r) => (
                <tr key={r.check_name} className="border-t"><td>{r.check_name}</td><td className="text-right">{formatVND(r.gl_value)}</td><td className="text-right">{formatVND(r.subledger_value)}</td>
                  <td className={`text-right font-medium ${r.diff !== 0 ? "text-red-600" : ""}`}>{formatVND(r.diff)}</td></tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {vat ? (
        <Card>
          <CardHeader>
            <CardTitle>Thuế GTGT tháng {mm}/{year} (chế độ doanh nghiệp — legacy)</CardTitle>
            <CardDescription>Chỉ hiển thị khi chủ cửa hàng bật chế độ doanh nghiệp. Hộ kinh doanh không ghi nhận VAT đầu ra/đầu vào.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm sm:grid-cols-3">
            <div><div className="text-muted-foreground">Đầu ra (3331)</div><div className="text-xl font-bold">{formatVND(vat.output_vat)}</div></div>
            <div><div className="text-muted-foreground">Đầu vào (133)</div><div className="text-xl font-bold">{formatVND(vat.input_vat)}</div></div>
            <div><div className="text-muted-foreground">{vat.payable >= 0 ? "Phải nộp" : "Được khấu trừ"}</div><div className="text-xl font-bold">{formatVND(Math.abs(vat.payable))}</div></div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Doanh thu tính thuế năm {year}</CardTitle>
            <CardDescription>
              Hộ kinh doanh: giá bán đã gồm thuế, không tách VAT, không khấu trừ VAT đầu vào (thuế trên hóa đơn mua nằm trong giá vốn).
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm sm:grid-cols-3">
            <div><div className="text-muted-foreground">Doanh thu năm (đã trừ hàng bán trả lại)</div><div className="text-xl font-bold">{formatVND(thr.revenue)}</div></div>
            <div><div className="text-muted-foreground">Ngưỡng doanh thu</div><div className="text-xl font-bold">{thr.threshold === null ? "—" : formatVND(thr.threshold)}</div></div>
            <div><div className="text-muted-foreground">Đã dùng</div><div className="text-xl font-bold">{thr.pct === null ? "—" : `${thr.pct}%`}</div></div>
            {thresholdBanner(thr) && <p className="text-sm font-medium text-amber-700 sm:col-span-3">{thresholdBanner(thr)!.title}</p>}
            <div className="sm:col-span-3"><Button asChild variant="outline" size="sm"><Link href={`/reports/revenue?year=${year}`}>Xem báo cáo doanh thu theo tháng và nhóm ngành</Link></Button></div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Tuổi nợ phải thu (đến {vnDate()})</CardTitle></CardHeader>
        <CardContent>
          {aging.length === 0 ? <p className="text-sm text-muted-foreground">Không có công nợ.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted-foreground"><th>Khách hàng</th><th className="text-right">Chưa đến hạn</th><th className="text-right">1–30</th><th className="text-right">31–60</th><th className="text-right">61–90</th><th className="text-right">&gt;90</th><th className="text-right">Tổng</th></tr></thead>
              <tbody>
                {aging.map((a) => (
                  <tr key={a.customer_id} className="border-t">
                    <td><Link href={`/customers/${a.customer_id}`} className="hover:underline">{a.customer_name}</Link></td>
                    <td className="text-right">{formatVND(a.not_due)}</td><td className="text-right">{formatVND(a.d1_30)}</td><td className="text-right">{formatVND(a.d31_60)}</td>
                    <td className="text-right">{formatVND(a.d61_90)}</td><td className="text-right">{formatVND(a.d90_plus)}</td><td className="text-right font-medium">{formatVND(a.open_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Bảng cân đối số phát sinh (lũy kế đến {to})</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted-foreground"><th>TK</th><th>Tên</th><th className="text-right">Nợ</th><th className="text-right">Có</th></tr></thead>
            <tbody>
              {tb.map((r) => (<tr key={r.account_code} className="border-t"><td className="font-mono">{r.account_code}</td><td>{r.name}</td><td className="text-right">{formatVND(r.debit)}</td><td className="text-right">{formatVND(r.credit)}</td></tr>))}
              <tr className="border-t font-semibold"><td colSpan={2}>Tổng</td><td className="text-right">{formatVND(totalD)}</td><td className="text-right">{formatVND(totalC)}</td></tr>
            </tbody>
          </table>
          {totalD !== totalC && <p className="mt-2 text-sm text-red-600">Cảnh báo: tổng Nợ ≠ tổng Có.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
