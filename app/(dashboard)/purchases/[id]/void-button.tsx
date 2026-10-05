"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { voidPurchaseAction } from "@/lib/actions/purchases";

export function VoidPurchaseButton({ billId }: { billId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        const reason = window.prompt("Lý do hủy phiếu mua (hoàn kho, đảo bút toán; chỉ dùng khi nhập sai):");
        if (!reason || reason.trim().length < 3) return;
        start(async () => {
          const res = await voidPurchaseAction(billId, reason.trim());
          if (!res.ok) { toast.error(res.error); return; }
          toast.success("Đã hủy phiếu mua");
          router.refresh();
        });
      }}
    >
      Hủy phiếu
    </Button>
  );
}
