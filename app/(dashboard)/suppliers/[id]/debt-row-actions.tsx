"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteSupplierDebt, toggleSupplierDebtPaid } from "@/lib/actions/suppliers";

export function DebtRowActions({ debtId, paid }: { debtId: string; paid: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) { toast.error(r.error ?? "Lỗi"); return; }
      toast.success(okMsg);
      router.refresh();
    });
  return (
    <div className="flex justify-end gap-1">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => toggleSupplierDebtPaid(debtId, !paid), paid ? "Đã bỏ đánh dấu trả" : "Đã đánh dấu đã trả")}>
        {paid ? "Bỏ đã trả" : "Đã trả"}
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => { if (confirm("Xóa khoản nợ này?")) run(() => deleteSupplierDebt(debtId), "Đã xóa"); }}>
        Xóa
      </Button>
    </div>
  );
}
