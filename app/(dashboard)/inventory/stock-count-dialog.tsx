"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { countStock } from "@/lib/actions/inventory";

export function StockCountDialog({ productId, current }: { productId: string; current: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [counted, setCounted] = useState(String(current));
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const fd = new FormData();
    fd.set("product_id", productId);
    fd.set("counted", counted);
    fd.set("notes", notes);
    startTransition(async () => {
      const res = await countStock(fd);
      if (!res.ok) {
        setError(res.error);
        toast.error(res.error);
        return;
      }
      toast.success(res.data.changed ? `Đã kiểm kê: chênh lệch ${res.data.delta > 0 ? "+" : ""}${res.data.delta}` : "Số đếm khớp tồn kho");
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setCounted(String(current)); setError(null); } }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ClipboardCheck className="mr-2 h-4 w-4" />
          Kiểm kê
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Kiểm kê tồn kho</DialogTitle>
            <DialogDescription>
              Nhập số lượng đếm thực tế. Hệ thống tự ghi phiếu điều chỉnh bằng chênh lệch so với tồn hiện tại.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="counted">Số lượng đếm được (đang ghi nhận: {current})</Label>
            <Input id="counted" type="number" min={0} step={1} required value={counted} onChange={(e) => setCounted(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="count-notes">Lý do / ghi chú</Label>
            <Input id="count-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Kiểm kê cuối tháng, hỏng, mất…" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>{pending ? "Đang lưu…" : "Xác nhận kiểm kê"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
