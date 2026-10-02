import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "@/lib/actions/_shared";
import { ContractForm } from "../contract-form";

export const dynamic = "force-dynamic";

export default async function NewContractPage() {
  const supabase = await createClient();
  const customers = unwrap(await supabase.from("customers").select("id, name").order("name").limit(1000), "customers") as Array<{ id: string; name: string }>;
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Hợp đồng bảo trì mới</h1>
      <Card className="p-4"><ContractForm customers={customers} /></Card>
    </div>
  );
}
