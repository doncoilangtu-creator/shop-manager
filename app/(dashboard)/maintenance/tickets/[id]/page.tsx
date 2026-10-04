import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { getTicketSignatureState, hasBothSignatures, nextStatuses, priorityLabel, priorityVariant, statusLabel, statusVariant } from "@/lib/maintenance";
import { unwrap } from "@/lib/actions/_shared";
import { formatDateTime } from "@/lib/utils";
import type { TicketStatus } from "@/types/db";
import { LogForm, StatusButtons } from "./ticket-controls";
import { SignaturePanel } from "./signature-panel";

export const dynamic = "force-dynamic";

export default async function TicketDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const supabase = await createClient();
  const tRes = await supabase
    .from("maintenance_tickets")
    .select("*, customer:customers(id, name, phone), contract:maintenance_contracts(id, code)")
    .eq("id", id)
    .maybeSingle();
  if (tRes.error) throw new Error("maintenance_tickets: " + tRes.error.message);
  const t = tRes.data as unknown as (Record<string, unknown> & {
    id: string; code: string; title: string; description: string | null; device_info: string | null; status: TicketStatus;
    priority: "low" | "medium" | "high"; sla_due_at: string | null; started_at: string | null; completed_at: string | null; created_at: string;
    customer: { id: string; name: string; phone: string | null } | null; contract: { id: string; code: string } | null;
  }) | null;
  if (!t) notFound();

  const [logsRes, sig] = await Promise.all([
    supabase.from("maintenance_logs").select("id, log_type, description, work_done, parts_used, performed_at").eq("ticket_id", id).order("performed_at", { ascending: false }).limit(100),
    getTicketSignatureState(id),
  ]);
  const logs = unwrap(logsRes, "maintenance_logs") as Array<{ id: string; log_type: string; description: string | null; work_done: string | null; parts_used: string[]; performed_at: string }>;
  const next = nextStatuses(t.status).map((s) => ({ status: s as string, label: statusLabel(s) }));
  const sigs = sig.signatures as Array<{ id: string; signer_name: string; signer_role: "customer" | "technician"; signed_at: string; signature_png: string }>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon"><Link href="/maintenance/tickets"><ChevronLeft className="h-5 w-5" /></Link></Button>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-2xl font-semibold tracking-tight">{t.code}</h1>
            <Badge variant={statusVariant(t.status)}>{statusLabel(t.status)}</Badge>
            <Badge variant={priorityVariant(t.priority)}>{priorityLabel(t.priority)}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{t.title}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Thông tin</CardTitle></CardHeader>
            <CardContent className="grid gap-2 text-sm md:grid-cols-2">
              <div><span className="text-muted-foreground">Khách: </span>{t.customer ? <Link className="hover:underline" href={`/customers/${t.customer.id}`}>{t.customer.name}</Link> : "—"} {t.customer?.phone ? `· ${t.customer.phone}` : ""}</div>
              <div><span className="text-muted-foreground">Hợp đồng: </span>{t.contract ? <Link className="hover:underline" href={`/maintenance/contracts/${t.contract.id}`}>{t.contract.code}</Link> : "—"}</div>
              <div><span className="text-muted-foreground">Thiết bị: </span>{t.device_info || "—"}</div>
              <div><span className="text-muted-foreground">SLA đến: </span>{t.sla_due_at ? formatDateTime(t.sla_due_at) : "—"}</div>
              <div><span className="text-muted-foreground">Bắt đầu: </span>{t.started_at ? formatDateTime(t.started_at) : "—"}</div>
              <div><span className="text-muted-foreground">Hoàn thành: </span>{t.completed_at ? formatDateTime(t.completed_at) : "—"}</div>
              {t.description && <div className="md:col-span-2 whitespace-pre-wrap">{t.description}</div>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Chuyển trạng thái</CardTitle></CardHeader>
            <CardContent><StatusButtons ticketId={t.id} next={next} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Nhật ký công việc</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <LogForm ticketId={t.id} />
              <ul className="space-y-2">
                {logs.length === 0 && <li className="text-sm text-muted-foreground">Chưa có log.</li>}
                {logs.map((l) => (
                  <li key={l.id} className="rounded-md border p-3 text-sm">
                    <div className="flex items-center justify-between"><Badge variant="outline">{l.log_type}</Badge><span className="text-xs text-muted-foreground">{formatDateTime(l.performed_at)}</span></div>
                    <p className="mt-1">{l.description}</p>
                    {l.work_done && <p className="text-muted-foreground">Đã xử lý: {l.work_done}</p>}
                    {l.parts_used?.length > 0 && <p className="text-xs text-muted-foreground">Linh kiện: {l.parts_used.join(", ")}</p>}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
        <SignaturePanel
          ticketId={t.id}
          status={t.status}
          signatures={sigs.map((s) => ({ ...s, ip_address: null }))}
          latestToken={sig.latestToken}
          bothSigned={hasBothSignatures(sigs)}
        />
      </div>
    </div>
  );
}
