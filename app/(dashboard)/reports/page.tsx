import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatVND, formatDate } from "@/lib/utils";
import { vnMonthKey, vnMonthsAgoStartIso } from "@/lib/time";

export const dynamic = "force-dynamic";

async function getReports() {
  const sb = createAdminClient();

  const twelveMonthsAgo = vnMonthsAgoStartIso(11);

  const [{ data: monthRevenue }, { data: topProducts }, { data: topCustomers }, { data: debts }] =
    await Promise.all([
      sb
        .from("quotations")
        .select("total, created_at")
        .eq("status", "approved")
        .gte("created_at", twelveMonthsAgo),
      sb
        .from("quotation_items")
        .select("qty, line_total, products(name, sku), quotations!inner(status)")
        .eq("quotations.status", "approved")
        .order("line_total", { ascending: false })
        .limit(10),
      sb
        .from("quotations")
        .select("total, customers(id, name)")
        .eq("status", "approved")
        .order("total", { ascending: false })
        .limit(10),
      sb
        .from("customer_debts")
        .select("amount, paid, customers(name)")
        .eq("paid", false),
    ]);

  // Group revenue by month
  const monthly: Record<string, number> = {};
  for (const r of monthRevenue ?? []) {
    const key = vnMonthKey(r.created_at);
    monthly[key] = (monthly[key] ?? 0) + (r.total ?? 0);
  }
  const sortedMonths = Object.entries(monthly).sort(([a], [b]) => a.localeCompare(b));
  const maxRevenue = Math.max(...sortedMonths.map(([, v]) => v), 1);

  return {
    monthly: sortedMonths,
    maxRevenue,
    topProducts: (topProducts ?? []) as any[],
    topCustomers: (topCustomers ?? []) as any[],
    totalDebt: (debts ?? []).reduce((s: number, d: any) => s + (d.amount ?? 0), 0),
    openDebts: (debts ?? []) as any[],
  };
}

export default async function ReportsPage() {
  const r = await getReports();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Báo cáo</h1>
        <p className="text-sm text-muted-foreground">Tổng hợp doanh thu & hoạt động</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Doanh thu 12 tháng gần nhất</CardTitle>
          <CardDescription>Chỉ tính các BG đã duyệt (approved)</CardDescription>
        </CardHeader>
        <CardContent>
          {r.monthly.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có doanh thu.</p>
          ) : (
            <div className="space-y-2">
              {r.monthly.map(([month, total]) => (
                <div key={month} className="flex items-center gap-3 text-sm">
                  <span className="w-20 font-mono text-xs text-muted-foreground">{month}</span>
                  <div className="flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-6 rounded-full bg-blue-600"
                      style={{ width: `${(total / r.maxRevenue) * 100}%` }}
                    />
                  </div>
                  <span className="w-32 text-right font-medium">{formatVND(total)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top 10 sản phẩm bán chạy</CardTitle>
          </CardHeader>
          <CardContent>
            {r.topProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Chưa có dữ liệu.</p>
            ) : (
              <ol className="space-y-2 text-sm">
                {r.topProducts.map((it: any, i: number) => {
                  const p = Array.isArray(it.products) ? it.products[0] : it.products;
                  return (
                    <li key={i} className="flex justify-between">
                      <span>
                        {i + 1}. {p?.name ?? "—"}
                      </span>
                      <span className="text-muted-foreground">
                        {it.qty} cái · {formatVND(it.line_total)}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top 10 khách hàng</CardTitle>
          </CardHeader>
          <CardContent>
            {r.topCustomers.length === 0 ? (
              <p className="text-sm text-muted-foreground">Chưa có dữ liệu.</p>
            ) : (
              <ol className="space-y-2 text-sm">
                {r.topCustomers.map((q: any, i: number) => {
                  const c = Array.isArray(q.customers) ? q.customers[0] : q.customers;
                  return (
                    <li key={i} className="flex justify-between">
                      <span>
                        {i + 1}. {c?.name ?? "—"}
                      </span>
                      <span className="text-muted-foreground">{formatVND(q.total)}</span>
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Công nợ phải thu</CardTitle>
          <CardDescription>
            Tổng nợ chưa thanh toán:{" "}
            <span className="font-semibold text-red-600">{formatVND(r.totalDebt)}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {r.openDebts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Không có công nợ.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b">
                <tr className="text-left text-muted-foreground">
                  <th className="pb-2">Khách</th>
                  <th className="pb-2 text-right">Số tiền</th>
                </tr>
              </thead>
              <tbody>
                {r.openDebts.slice(0, 20).map((d: any, i: number) => {
                  const c = Array.isArray(d.customers) ? d.customers[0] : d.customers;
                  return (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2">{c?.name ?? "—"}</td>
                      <td className="py-2 text-right font-medium">{formatVND(d.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}