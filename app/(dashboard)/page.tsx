import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Package, AlertTriangle, Briefcase, Wrench, Receipt, TrendingUp, Zap } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { parseDashboard, rpcOrThrow } from "@/lib/reports";
import { formatVND, formatDate } from "@/lib/utils";
import { cookies } from "next/headers";
import { vnDate } from "@/lib/time";
import { EINV_REMINDER_COOKIE, defaultMissingPeriod, reminderVisible, summarizeMissing } from "@/lib/einvoice/missing";
import { MissingEinvoiceReminderCard } from "@/components/einvoice/missing-reminder-card";

export const dynamic = "force-dynamic";

type RecentTicket = { id: string; code: string; title: string; status: string; created_at: string; customers: { name: string } | { name: string }[] | null };
type RecentQuote = { id: string; code: string; status: string; total: number; created_at: string; customers: { name: string } | { name: string }[] | null };
const custName = (c: RecentTicket["customers"]) => (Array.isArray(c) ? c[0]?.name : c?.name);

async function getDashboardStats() {
  const sb = await createClient();
  const [stats, recentTickets, recentQuotes] = await Promise.all([
    rpcOrThrow(sb, "report_dashboard", undefined, parseDashboard),
    sb.from("maintenance_tickets").select("id, code, title, status, created_at, customers(name)").order("created_at", { ascending: false }).limit(5),
    sb.from("quotations").select("id, code, status, total, created_at, customers(name)").order("created_at", { ascending: false }).limit(5),
  ]);
  if (recentTickets.error) throw new Error("maintenance_tickets: " + recentTickets.error.message);
  if (recentQuotes.error) throw new Error("quotations: " + recentQuotes.error.message);
  return {
    totalProducts: stats.products,
    lowStockCount: stats.low_stock,
    totalCustomers: stats.customers,
    businessCustomers: stats.business_customers,
    openTickets: stats.open_tickets,
    pendingQuotes: stats.pending_quotations,
    monthRevenue: stats.month_revenue,
    monthGross: stats.month_revenue - stats.month_cogs,
    arBalance: stats.ar_balance,
    apBalance: stats.ap_balance,
    stockValue: stats.stock_value,
    overdueInvoices: stats.overdue_invoices,
    recentTickets: (recentTickets.data ?? []) as unknown as RecentTicket[],
    recentQuotes: (recentQuotes.data ?? []) as unknown as RecentQuote[],
  };
}

/** Nhắc đơn bán quý hiện tại chưa có HĐĐT; null nếu bị tắt/tạm ẩn, không có đơn hoặc truy vấn lỗi (chỉ ẩn thẻ). */
async function getEinvoiceReminder() {
  try {
    const today = vnDate();
    if (!reminderVisible((await cookies()).get(EINV_REMINDER_COOKIE)?.value, today)) return null;
    const period = defaultMissingPeriod(today);
    const sb = await createClient();
    const { data, error } = await sb.from("v_sales_missing_einvoice").select("total").gte("invoice_date", period.from).lte("invoice_date", period.to).limit(10000);
    if (error || !data) return null;
    const sum = summarizeMissing(data.map((r: { total: unknown }) => ({ total: Number(r.total) })));
    return sum.count > 0 ? { ...sum, period } : null;
  } catch {
    return null;
  }
}

export default async function DashboardHome() {
  const [s, einv] = await Promise.all([getDashboardStats(), getEinvoiceReminder()]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Tổng quan hoạt động cửa hàng
          </p>
        </div>
        <Link
          href="/ban-nhanh"
          className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Zap className="h-4 w-4" />
          Bán nhanh
        </Link>
      </div>

      {einv && <MissingEinvoiceReminderCard count={einv.count} total={einv.total} period={einv.period} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/inventory">
          <Card className="transition-colors hover:bg-muted/50">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Tổng sản phẩm</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{s.totalProducts}</div>
              <p className="text-xs text-muted-foreground">SKU trong kho</p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/inventory?filter=low">
          <Card className="transition-colors hover:bg-muted/50">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Sắp hết hàng</CardTitle>
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600">{s.lowStockCount}</div>
              <p className="text-xs text-muted-foreground">Dưới mức tối thiểu</p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/customers">
          <Card className="transition-colors hover:bg-muted/50">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Khách hàng</CardTitle>
              <Briefcase className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{s.totalCustomers}</div>
              <p className="text-xs text-muted-foreground">
                {s.businessCustomers} doanh nghiệp
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/maintenance/tickets">
          <Card className="transition-colors hover:bg-muted/50">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Ticket đang mở</CardTitle>
              <Wrench className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{s.openTickets}</div>
              <p className="text-xs text-muted-foreground">Chưa đóng</p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/quotations?status=sent">
          <Card className="transition-colors hover:bg-muted/50">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Báo giá chờ duyệt</CardTitle>
              <Receipt className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{s.pendingQuotes}</div>
              <p className="text-xs text-muted-foreground">Đã gửi khách</p>
            </CardContent>
          </Card>
        </Link>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Doanh thu tháng</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{formatVND(s.monthRevenue)}</div>
            <p className="text-xs text-muted-foreground">Doanh thu ghi sổ (TK 511) tháng này</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/reports/accounting">
          <Card className="transition-colors hover:bg-muted/50">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Công nợ phải thu (131)</CardTitle></CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatVND(s.arBalance)}</div>
              <p className="text-xs text-muted-foreground">{s.overdueInvoices} hóa đơn quá hạn</p>
            </CardContent>
          </Card>
        </Link>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Công nợ phải trả (331)</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{formatVND(s.apBalance)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Giá trị tồn kho (156)</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{formatVND(s.stockValue)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Lãi gộp tháng</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{formatVND(s.monthGross)}</div></CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Ticket bảo trì gần đây</CardTitle>
            <CardDescription>5 yêu cầu mới nhất</CardDescription>
          </CardHeader>
          <CardContent>
            {s.recentTickets.length === 0 ? (
              <p className="text-sm text-muted-foreground">Chưa có ticket nào.</p>
            ) : (
              <ul className="space-y-2">
                {s.recentTickets.map((t) => {
                  const cn = custName(t.customers);
                  return (
                    <li key={t.id} className="flex items-center justify-between text-sm">
                      <Link href={`/maintenance/tickets/${t.id}`} className="hover:underline">
                        <span className="font-medium">{t.code}</span> — {t.title}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {cn ?? "—"} · {formatDate(t.created_at)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Báo giá gần đây</CardTitle>
            <CardDescription>5 BG mới nhất</CardDescription>
          </CardHeader>
          <CardContent>
            {s.recentQuotes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Chưa có báo giá nào.</p>
            ) : (
              <ul className="space-y-2">
                {s.recentQuotes.map((q) => {
                  const cn = custName(q.customers);
                  return (
                    <li key={q.id} className="flex items-center justify-between text-sm">
                      <Link href={`/quotations/${q.id}`} className="hover:underline">
                        <span className="font-medium">{q.code}</span> — {cn ?? "—"}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {formatVND(q.total)} · {q.status}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}