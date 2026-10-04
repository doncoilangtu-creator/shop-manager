import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/server";
import { createTicketAction } from "../../actions";
import { unwrap } from "@/lib/actions/_shared";

export const dynamic = "force-dynamic";
const sel = "h-9 w-full rounded-md border bg-background px-2 text-sm";

export default async function NewTicketPage() {
  const supabase = await createClient();
  const [custRes, conRes] = await Promise.all([
    supabase.from("customers").select("id, name").order("name").limit(1000),
    supabase.from("maintenance_contracts").select("id, code, customer_id").eq("status", "active").order("code").limit(1000),
  ]);
  const customers = unwrap(custRes, "customers") as Array<{ id: string; name: string }>;
  const contracts = unwrap(conRes, "maintenance_contracts") as Array<{ id: string; code: string; customer_id: string }>;
  const nameOf = new Map(customers.map((c) => [c.id, c.name]));

  async function submit(formData: FormData) {
    "use server";
    const r = await createTicketAction(formData);
    if (r && !r.ok) throw new Error(r.error);
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Tiếp nhận ticket mới</h1>
      <Card className="p-4">
        <form action={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="customer_id">Khách hàng *</Label>
            <select id="customer_id" name="customer_id" required className={sel}>
              <option value="">— Chọn —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="contract_id">Hợp đồng (nếu có — quyết định SLA)</Label>
            <select id="contract_id" name="contract_id" className={sel}>
              <option value="">— Không thuộc hợp đồng (SLA 24h) —</option>
              {contracts.map((c) => <option key={c.id} value={c.id}>{c.code} · {nameOf.get(c.customer_id) ?? ""}</option>)}
            </select>
          </div>
          <div className="space-y-2"><Label htmlFor="title">Tiêu đề *</Label><Input id="title" name="title" required maxLength={200} /></div>
          <div className="space-y-2"><Label htmlFor="device_info">Thiết bị</Label><Input id="device_info" name="device_info" placeholder="Dell Optiplex 7090, S/N…" /></div>
          <div className="space-y-2"><Label htmlFor="description">Mô tả sự cố</Label><textarea id="description" name="description" rows={4} className="w-full rounded-md border bg-background p-2 text-sm" /></div>
          <div className="space-y-2">
            <Label htmlFor="priority">Ưu tiên</Label>
            <select id="priority" name="priority" defaultValue="medium" className={sel}>
              <option value="low">Thấp</option><option value="medium">Trung bình</option><option value="high">Cao</option>
            </select>
          </div>
          <Button type="submit">Tạo ticket</Button>
        </form>
      </Card>
    </div>
  );
}
