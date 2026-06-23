import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Package, AlertTriangle, Briefcase, Wrench, Receipt, TrendingUp } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatVND, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

async function getDashboardStats() {
  const sb = createAdminClient();
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [products, lowStock, customers, bizCustomers, openTickets, pendingQuotes, monthRevenue, recentTickets, recentQuotes] =
    await Promise.all([
      sb.from("products").select("id", { count: "exact", head: true }),
      sb
        .from("products")
        .select("id", { count: "exact", head: true })
        .filter("stock_qty", "lte", "min_stock"),
      sb.from("customers").select("id", { count: "exact", head: true }),
      sb
        .from("customers")
        .select("id", { count: "exact", head: true })
        .eq("type", "business"),
      sb
        .from("maintenance_tickets")
        .select("id", { count: "exact", head: true })
        .not("status", "in", "(closed,signed)"),
      sb
        .from("quotations")
        .select("id", { count: "exact", head: true })
        .eq("status", "sent"),
      sb
        .from("quotations")
        .select("total")
        .eq("status", "approved")
        .gte("created_at", startOfMonth),
      sb
        .from("maintenance_tickets")
        .select("id, code, title, status, created_at, customers(name)")
        .order("created_at", { ascending: false })
        .limit(5),
      sb
        .from("quotations")
        .select("id, code, status, total, created_at, customers(name)")
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

  const revenue = (monthRevenue.data ?? []).reduce((s: number, r: any) => s + (r.total ?? 0), 0);

  return {
    totalProducts: products.count ?? 0,
    lowStockCount: lowStock.count ?? 0,
    totalCustomers: customers.count ?? 0,
    businessCustomers: bizCustomers.count ?? 0,
    openTickets: openTickets.count ?? 0,
    pendingQuotes: pendingQuotes.count ?? 0,
    monthRevenue: revenue,
    recentTickets: (recentTickets.data ?? []) as any[],
    recentQuotes: (recentQuotes.data ?? []) as any[],
  };
}

export default async function DashboardHome() {
  const s = await getDashboardStats();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Tổng quan hoạt động cửa hàng
        </p>
      </div>

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
            <p className="text-xs text-muted-foreground">BG approved trong tháng</p>
          </CardContent>
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
                {s.recentTickets.map((t: any) => {
                  const cn = Array.isArray(t.customers) ? t.customers[0]?.name : t.customers?.name;
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
                {s.recentQuotes.map((q: any) => {
                  const cn = Array.isArray(q.customers) ? q.customers[0]?.name : q.customers?.name;
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