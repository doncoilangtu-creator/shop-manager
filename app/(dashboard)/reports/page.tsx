import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { formatVND } from "@/lib/utils";
import { vnDate, vnLastMonthKeys } from "@/lib/time";
import { parsePnl, parseTopCustomers, parseTopProducts, rpcOrThrow } from "@/lib/reports";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const sb = await createClient();
  const keys = vnLastMonthKeys(12);
  const range = { p_from: `${keys[0]}-01`, p_to: vnDate() };
  const [pnl, topProducts, topCustomers] = await Promise.all([
    rpcOrThrow(sb, "report_monthly_pnl", range, parsePnl),
    rpcOrThrow(sb, "report_top_products", { ...range, p_limit: 10 }, parseTopProducts),
    rpcOrThrow(sb, "report_top_customers", { ...range, p_limit: 10 }, parseTopCustomers),
  ]);
  const maxRevenue = Math.max(...pnl.map((m) => m.revenue), 1);
  const total = pnl.reduce((s, m) => ({ revenue: s.revenue + m.revenue, gp: s.gp + m.gross_profit }), { revenue: 0, gp: 0 });

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Báo cáo</h1>
          <p className="text-sm text-muted-foreground">Từ {range.p_from} đến {range.p_to} (giờ Việt Nam) · số liệu từ sổ cái</p>
        </div>
        <Button asChild variant="outline"><Link href="/reports/accounting">Báo cáo kế toán →</Link></Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Doanh thu & lãi gộp 12 tháng</CardTitle>
          <CardDescription>Doanh thu TK 511 trừ giá vốn TK 632; hóa đơn đã hủy được bù trừ bằng bút toán đảo. Tổng: {formatVND(total.revenue)} · lãi gộp {formatVND(total.gp)}</CardDescription>
        </CardHeader>
        <CardContent>
          {pnl.every((m) => m.revenue === 0 && m.cogs === 0) ? (
            <p className="text-sm text-muted-foreground">Chưa có doanh thu.</p>
          ) : (
            <div className="space-y-2">
              {pnl.map((m) => (
                <div key={m.month} className="flex items-center gap-3 text-sm">
                  <span className="w-20 font-mono text-xs text-muted-foreground">{m.month.slice(0, 7)}</span>
                  <div className="flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-6 rounded-full bg-blue-600" style={{ width: `${(m.revenue / maxRevenue) * 100}%` }} />
                  </div>
                  <span className="w-32 text-right font-medium">{formatVND(m.revenue)}</span>
                  <span className="w-32 text-right text-xs text-muted-foreground">LG {formatVND(m.gross_profit)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Top sản phẩm</CardTitle><CardDescription>Theo doanh thu hóa đơn (không tính hóa đơn đã hủy)</CardDescription></CardHeader>
          <CardContent>
            {topProducts.length === 0 ? <p className="text-sm text-muted-foreground">Chưa có dữ liệu.</p> : (
              <ul className="space-y-2 text-sm">
                {topProducts.map((p) => (
                  <li key={p.product_id} className="flex items-center justify-between">
                    <Link href={`/inventory/${p.product_id}`} className="hover:underline"><span className="font-medium">{p.name ?? "—"}</span> <span className="text-xs text-muted-foreground">{p.sku}</span></Link>
                    <span className="text-right">{formatVND(p.revenue)} <span className="text-xs text-muted-foreground">· SL {p.qty} · LG {formatVND(p.margin)}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Top khách hàng</CardTitle><CardDescription>Theo doanh thu hóa đơn, kèm còn nợ</CardDescription></CardHeader>
          <CardContent>
            {topCustomers.length === 0 ? <p className="text-sm text-muted-foreground">Chưa có dữ liệu.</p> : (
              <ul className="space-y-2 text-sm">
                {topCustomers.map((c) => (
                  <li key={c.customer_id} className="flex items-center justify-between">
                    <Link href={`/customers/${c.customer_id}`} className="font-medium hover:underline">{c.name}</Link>
                    <span className="text-right">{formatVND(c.revenue)} <span className="text-xs text-muted-foreground">· {c.invoices} HĐ · nợ {formatVND(c.outstanding)}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
