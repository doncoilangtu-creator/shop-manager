import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { buildMaintenanceReport, type TicketRow } from "@/lib/maintenance-report";
import { statusLabel } from "@/lib/maintenance";
import { vnMonthRange, vnParts } from "@/lib/time";
import type { TicketStatus } from "@/types/db";

export const dynamic = "force-dynamic";

export default async function MaintenanceReportPage(props: { searchParams: Promise<{ month?: string }> }) {
  const sp = await props.searchParams;
  const cur = vnParts();
  const m = /^(\d{4})-(\d{2})$/.exec(sp.month ?? "");
  const year = m ? Number(m[1]) : cur.year;
  const month = m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? Number(m[2]) : cur.month;
  const { from, to } = vnMonthRange(year, month);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("maintenance_tickets")
    .select("status, priority, created_at, completed_at, sla_due_at")
    .gte("created_at", from).lt("created_at", to).limit(5000);
  if (error) throw new Error("maintenance_tickets: " + error.message);
  const r = buildMaintenanceReport((data ?? []) as TicketRow[]);
  const prev = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
  const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Báo cáo bảo trì {String(month).padStart(2, "0")}/{year}</h1>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm"><Link href={`/maintenance/reports?month=${prev}`}>← Tháng trước</Link></Button>
          <Button asChild variant="outline" size="sm"><Link href={`/maintenance/reports?month=${next}`}>Tháng sau →</Link></Button>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Ticket tiếp nhận</CardTitle></CardHeader><CardContent className="text-3xl font-bold">{r.total}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Đạt SLA</CardTitle></CardHeader><CardContent className="text-3xl font-bold">{r.slaPct === null ? "—" : `${r.slaPct}%`}<p className="text-xs font-normal text-muted-foreground">{r.slaMet} đạt · {r.slaBreached} trễ</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">TB xử lý</CardTitle></CardHeader><CardContent className="text-3xl font-bold">{r.avgResolutionHours === null ? "—" : `${r.avgResolutionHours}h`}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Ưu tiên cao</CardTitle></CardHeader><CardContent className="text-3xl font-bold">{r.byPriority.high ?? 0}</CardContent></Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Theo trạng thái</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-4 text-sm">
          {Object.entries(r.byStatus).length === 0 ? <span className="text-muted-foreground">Không có dữ liệu.</span> :
            Object.entries(r.byStatus).map(([s, n]) => <div key={s}><span className="text-muted-foreground">{statusLabel(s as TicketStatus)}: </span><b>{n}</b></div>)}
        </CardContent>
      </Card>
    </div>
  );
}
