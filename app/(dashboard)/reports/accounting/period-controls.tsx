"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { closePeriodAction, reopenPeriodAction } from "@/lib/actions/periods";

export function PeriodControls({ year, month, status, canReopen }: { year: number; month: number; status: "open" | "closed"; canReopen: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");
  const run = (fn: typeof closePeriodAction, withReason: boolean) => {
    const fd = new FormData();
    fd.set("year", String(year)); fd.set("month", String(month));
    if (withReason) fd.set("reason", reason);
    start(async () => {
      const r = await fn(fd);
      if (!r.ok) { toast.error(r.error); return; }
      toast.success(withReason ? "Đã mở lại kỳ" : "Đã khóa kỳ");
      setReason(""); router.refresh();
    });
  };
  if (status === "open") {
    return <Button size="sm" variant="outline" disabled={pending} onClick={() => { if (confirm(`Khóa kỳ ${month}/${year}? Sau khi khóa không thể ghi chứng từ vào kỳ này.`)) run(closePeriodAction, false); }}>Khóa kỳ</Button>;
  }
  if (!canReopen) return null;
  return (
    <div className="flex items-center gap-2">
      <Input className="h-8 w-48" placeholder="Lý do mở lại (≥5 ký tự)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <Button size="sm" variant="outline" disabled={pending || reason.trim().length < 5} onClick={() => run(reopenPeriodAction, true)}>Mở lại</Button>
    </div>
  );
}
