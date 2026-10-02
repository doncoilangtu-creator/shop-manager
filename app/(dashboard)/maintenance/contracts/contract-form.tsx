"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createContractAction, deleteContractAction, updateContractAction } from "../actions";

const sel = "h-9 w-full rounded-md border bg-background px-2 text-sm";

export type ContractFormInitial = {
  customer_id: string; start_date: string; end_date: string; scope: string; devices_description: string;
  monthly_fee: number; sla_hours: number; status: string;
};

export function ContractForm({ customers, contractId, initial }: { customers: Array<{ id: string; name: string }>; contractId?: string; initial?: ContractFormInitial }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const r = contractId ? await updateContractAction(contractId, fd) : await createContractAction(fd);
          if (r && !r.ok) { setError(r.error); toast.error(r.error); return; }
          if (contractId) { toast.success("Đã lưu"); router.refresh(); }
        });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="customer_id">Khách hàng *</Label>
        <select id="customer_id" name="customer_id" required defaultValue={initial?.customer_id ?? ""} className={sel}>
          <option value="">— Chọn —</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="start_date">Bắt đầu *</Label><Input id="start_date" name="start_date" type="date" required defaultValue={initial?.start_date} /></div>
        <div className="space-y-2"><Label htmlFor="end_date">Kết thúc *</Label><Input id="end_date" name="end_date" type="date" required defaultValue={initial?.end_date} /></div>
        <div className="space-y-2"><Label htmlFor="monthly_fee">Phí tháng (đ)</Label><Input id="monthly_fee" name="monthly_fee" type="number" min={0} defaultValue={initial?.monthly_fee ?? 0} /></div>
        <div className="space-y-2"><Label htmlFor="sla_hours">SLA (giờ)</Label><Input id="sla_hours" name="sla_hours" type="number" min={1} defaultValue={initial?.sla_hours ?? 24} /></div>
      </div>
      {contractId && (
        <div className="space-y-2">
          <Label htmlFor="status">Trạng thái</Label>
          <select id="status" name="status" defaultValue={initial?.status} className={sel}>
            <option value="active">Đang hiệu lực</option><option value="expired">Hết hạn</option><option value="cancelled">Đã hủy</option>
          </select>
        </div>
      )}
      <div className="space-y-2"><Label htmlFor="scope">Phạm vi</Label><textarea id="scope" name="scope" rows={3} defaultValue={initial?.scope} className="w-full rounded-md border bg-background p-2 text-sm" /></div>
      <div className="space-y-2"><Label htmlFor="devices_description">Thiết bị</Label><textarea id="devices_description" name="devices_description" rows={3} defaultValue={initial?.devices_description} className="w-full rounded-md border bg-background p-2 text-sm" /></div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Đang lưu…" : contractId ? "Lưu thay đổi" : "Tạo hợp đồng"}</Button>
        {contractId && (
          <Button
            type="button" variant="ghost" className="text-destructive" disabled={pending}
            onClick={() => {
              if (!confirm("Xóa hợp đồng?")) return;
              start(async () => {
                const r = await deleteContractAction(contractId);
                if (!r.ok) { toast.error(r.error); return; }
                router.push("/maintenance/contracts");
              });
            }}
          >Xóa</Button>
        )}
      </div>
    </form>
  );
}
