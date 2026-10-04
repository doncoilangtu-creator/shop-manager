"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addMaintenanceLogAction, updateTicketStatusAction } from "../../actions";

export function StatusButtons({ ticketId, next }: { ticketId: string; next: Array<{ status: string; label: string }> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (next.length === 0) return <p className="text-sm text-muted-foreground">Ticket đã đóng.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {next.map((n) => (
        <Button
          key={n.status}
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await updateTicketStatusAction(ticketId, n.status);
              if (!r.ok) { toast.error(r.error); return; }
              toast.success(`Đã chuyển sang: ${n.label}`);
              router.refresh();
            })
          }
        >
          → {n.label}
        </Button>
      ))}
    </div>
  );
}

export function LogForm({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        fd.set("ticket_id", ticketId);
        setError(null);
        start(async () => {
          const r = await addMaintenanceLogAction(fd);
          if (!r.ok) { setError(r.error); toast.error(r.error); return; }
          toast.success("Đã ghi log");
          form.reset();
          router.refresh();
        });
      }}
    >
      <select name="log_type" defaultValue="note" className="h-9 w-full rounded-md border bg-background px-2 text-sm">
        <option value="note">Ghi chú</option><option value="incident">Sự cố</option><option value="periodic">Định kỳ</option>
      </select>
      <Input name="description" placeholder="Mô tả *" required />
      <Input name="work_done" placeholder="Đã xử lý" />
      <Input name="parts_used" placeholder="Linh kiện dùng (phân cách bằng dấu phẩy)" />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" size="sm" disabled={pending}>{pending ? "Đang lưu…" : "Thêm log"}</Button>
    </form>
  );
}
