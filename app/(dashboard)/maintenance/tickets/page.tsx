import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";
import { priorityLabel, priorityVariant, statusLabel, statusVariant } from "@/lib/maintenance";
import { sanitizeSearchTerm } from "@/lib/search";
import { formatDateTime } from "@/lib/utils";
import type { TicketPriority, TicketStatus } from "@/types/db";

export const dynamic = "force-dynamic";
const STATUSES: TicketStatus[] = ["received", "assigned", "in_progress", "waiting_parts", "completed", "awaiting_signature", "signed", "closed"];

export default async function TicketsPage(props: { searchParams: Promise<{ status?: string; q?: string; open?: string }> }) {
  const sp = await props.searchParams;
  const supabase = await createClient();
  let q = supabase
    .from("maintenance_tickets")
    .select("id, code, title, status, priority, sla_due_at, created_at, customer:customers(name)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (sp.status && (STATUSES as string[]).includes(sp.status)) q = q.eq("status", sp.status);
  else if (sp.open === "1") q = q.not("status", "in", "(signed,closed)");
  const term = sanitizeSearchTerm(sp.q);
  if (term) q = q.or(`code.ilike.%${term}%,title.ilike.%${term}%`);
  const { data, error } = await q;
  if (error) throw new Error("maintenance_tickets: " + error.message);
  const now = Date.now();
  type Row = { id: string; code: string; title: string; status: TicketStatus; priority: TicketPriority; sla_due_at: string | null; created_at: string; customer: { name: string } | { name: string }[] | null };
  const rows = (data ?? []) as unknown as Row[];
  const cust = (r: Row) => (Array.isArray(r.customer) ? r.customer[0]?.name : r.customer?.name) ?? "—";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ticket bảo trì</h1>
          <p className="text-sm text-muted-foreground">{rows.length} ticket</p>
        </div>
        <Button asChild><Link href="/maintenance/tickets/new"><Plus className="mr-2 h-4 w-4" />Tiếp nhận ticket</Link></Button>
      </div>
      <Card className="flex flex-wrap items-center gap-2 p-3">
        <Button asChild size="sm" variant={!sp.status && sp.open !== "1" ? "default" : "outline"}><Link href="/maintenance/tickets">Tất cả</Link></Button>
        <Button asChild size="sm" variant={sp.open === "1" ? "default" : "outline"}><Link href="/maintenance/tickets?open=1">Đang mở</Link></Button>
        {STATUSES.map((s) => (
          <Button key={s} asChild size="sm" variant={sp.status === s ? "default" : "outline"}>
            <Link href={`/maintenance/tickets?status=${s}`}>{statusLabel(s)}</Link>
          </Button>
        ))}
        <form action="/maintenance/tickets" className="ml-auto flex gap-2">
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Mã / tiêu đề…" className="h-9 rounded-md border bg-background px-3 text-sm" />
          <Button type="submit" size="sm" variant="secondary">Tìm</Button>
        </form>
      </Card>
      <Card>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Mã</TableHead><TableHead>Tiêu đề</TableHead><TableHead>Khách</TableHead><TableHead>Ưu tiên</TableHead><TableHead>Trạng thái</TableHead><TableHead>SLA</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">Không có ticket.</TableCell></TableRow>
            ) : rows.map((t) => {
              const overdue = t.sla_due_at && new Date(t.sla_due_at).getTime() < now && !["signed", "closed", "completed", "awaiting_signature"].includes(t.status);
              return (
                <TableRow key={t.id}>
                  <TableCell><Link href={`/maintenance/tickets/${t.id}`} className="font-mono text-xs font-medium hover:underline">{t.code}</Link></TableCell>
                  <TableCell className="max-w-[260px] truncate">{t.title}</TableCell>
                  <TableCell>{cust(t)}</TableCell>
                  <TableCell><Badge variant={priorityVariant(t.priority)}>{priorityLabel(t.priority)}</Badge></TableCell>
                  <TableCell><Badge variant={statusVariant(t.status)}>{statusLabel(t.status)}</Badge></TableCell>
                  <TableCell className={overdue ? "font-medium text-destructive" : "text-xs text-muted-foreground"}>
                    {t.sla_due_at ? formatDateTime(t.sla_due_at) : "—"}{overdue ? " · trễ" : ""}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
