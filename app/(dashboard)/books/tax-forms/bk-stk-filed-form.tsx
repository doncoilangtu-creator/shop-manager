"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { markBkStkFiledAction } from "@/lib/actions/tax-forms";

type Item = { id: string; label: string; status: string };

/** Chủ hộ đánh dấu các tài khoản đã nộp trong bảng kê 01/BK-STK (sau khi nộp trên cổng thuế). */
export function BkStkFiledForm({ items, today }: { items: Item[]; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sel, setSel] = useState<string[]>(items.map((i) => i.id));
  const [date, setDate] = useState(today);
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  if (!items.length) return null;
  return (
    <form
      className="space-y-3 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!sel.length) { toast.error("Chọn ít nhất một tài khoản"); return; }
        if (!confirm(`Xác nhận đã nộp bảng kê 01/BK-STK cho ${sel.length} tài khoản, ngày ${date}?`)) return;
        start(async () => {
          const r = await markBkStkFiledAction({ ids: sel, date });
          if (!r.ok) { toast.error(r.error); return; }
          toast.success(`Đã đánh dấu ${r.data.count} tài khoản đã kê khai`);
          router.refresh();
        });
      }}
    >
      <div className="text-sm font-medium">Đã nộp bảng kê trên cổng thuế? Đánh dấu để hết nhắc việc</div>
      <div className="space-y-1">
        {items.map((i) => (
          <label key={i.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={sel.includes(i.id)} onChange={() => toggle(i.id)} />
            {i.label} <span className="text-xs text-muted-foreground">({i.status})</span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label htmlFor="bk-date" className="text-xs font-medium">Ngày nộp</label>
          <Input id="bk-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className="h-9 w-44" />
        </div>
        <Button type="submit" size="sm" disabled={pending}>{pending ? "Đang lưu…" : "Đánh dấu đã nộp"}</Button>
      </div>
    </form>
  );
}
