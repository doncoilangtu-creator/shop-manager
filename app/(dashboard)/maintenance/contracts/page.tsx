import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";
import { contractStatusLabel } from "@/lib/maintenance";
import { vnDate } from "@/lib/time";
import { formatDate, formatVND } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ContractsPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("maintenance_contracts")
    .select("id, code, start_date, end_date, monthly_fee, sla_hours, status, customer:customers(name)")
    .order("end_date", { ascending: true })
    .limit(300);
  if (error) throw new Error("maintenance_contracts: " + error.message);
  type Row = { id: string; code: string; start_date: string; end_date: string; monthly_fee: number; sla_hours: number; status: "active" | "expired" | "cancelled"; customer: { name: string } | { name: string }[] | null };
  const rows = (data ?? []) as unknown as Row[];
  const today = vnDate();
  const in30 = vnDate(new Date(Date.now() + 30 * 86400_000));
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-semibold tracking-tight">Hợp đồng bảo trì</h1><p className="text-sm text-muted-foreground">{rows.length} hợp đồng</p></div>
        <Button asChild><Link href="/maintenance/contracts/new"><Plus className="mr-2 h-4 w-4" />Tạo hợp đồng</Link></Button>
      </div>
      <Card>
        <Table>
          <TableHeader><TableRow><TableHead>Mã</TableHead><TableHead>Khách</TableHead><TableHead>Hiệu lực</TableHead><TableHead className="text-right">Phí/tháng</TableHead><TableHead>SLA</TableHead><TableHead>Trạng thái</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 ? <TableRow><TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">Chưa có hợp đồng.</TableCell></TableRow> :
              rows.map((c) => {
                const cn = (Array.isArray(c.customer) ? c.customer[0]?.name : c.customer?.name) ?? "—";
                const expiring = c.status === "active" && c.end_date >= today && c.end_date <= in30;
                const lapsed = c.status === "active" && c.end_date < today;
                return (
                  <TableRow key={c.id}>
                    <TableCell><Link className="font-mono text-xs font-medium hover:underline" href={`/maintenance/contracts/${c.id}`}>{c.code}</Link></TableCell>
                    <TableCell>{cn}</TableCell>
                    <TableCell className="text-sm">{formatDate(c.start_date)} → {formatDate(c.end_date)} {expiring && <Badge variant="warning" className="ml-1">sắp hết hạn</Badge>}{lapsed && <Badge variant="destructive" className="ml-1">quá hạn</Badge>}</TableCell>
                    <TableCell className="text-right">{formatVND(c.monthly_fee)}</TableCell>
                    <TableCell>{c.sla_hours}h</TableCell>
                    <TableCell><Badge variant={c.status === "active" ? "success" : "secondary"}>{contractStatusLabel(c.status)}</Badge></TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
