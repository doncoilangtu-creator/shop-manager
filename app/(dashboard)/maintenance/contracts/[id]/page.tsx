import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "@/lib/actions/_shared";
import { ContractForm } from "../contract-form";

export const dynamic = "force-dynamic";

export default async function ContractDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const supabase = await createClient();
  const [cRes, custRes, tRes] = await Promise.all([
    supabase.from("maintenance_contracts").select("*").eq("id", id).maybeSingle(),
    supabase.from("customers").select("id, name").order("name").limit(1000),
    supabase.from("maintenance_tickets").select("id, code, title, status").eq("contract_id", id).order("created_at", { ascending: false }).limit(20),
  ]);
  if (cRes.error) throw new Error("maintenance_contracts: " + cRes.error.message);
  const c = cRes.data;
  if (!c) notFound();
  const customers = unwrap(custRes, "customers") as Array<{ id: string; name: string }>;
  const tickets = unwrap(tRes, "maintenance_tickets") as Array<{ id: string; code: string; title: string; status: string }>;
  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon"><Link href="/maintenance/contracts"><ChevronLeft className="h-5 w-5" /></Link></Button>
        <h1 className="font-mono text-2xl font-semibold tracking-tight">{c.code}</h1>
      </div>
      <Card className="p-4">
        <ContractForm
          customers={customers}
          contractId={c.id}
          initial={{
            customer_id: c.customer_id, start_date: c.start_date, end_date: c.end_date, scope: c.scope ?? "",
            devices_description: c.devices_description ?? "", monthly_fee: Number(c.monthly_fee), sla_hours: c.sla_hours, status: c.status,
          }}
        />
      </Card>
      <Card className="p-4">
        <h2 className="mb-2 text-sm font-medium">Ticket thuộc hợp đồng</h2>
        {tickets.length === 0 ? <p className="text-sm text-muted-foreground">Chưa có ticket.</p> : (
          <ul className="space-y-1 text-sm">
            {tickets.map((t) => <li key={t.id}><Link className="font-mono text-xs hover:underline" href={`/maintenance/tickets/${t.id}`}>{t.code}</Link> · {t.title} · {t.status}</li>)}
          </ul>
        )}
      </Card>
    </div>
  );
}
