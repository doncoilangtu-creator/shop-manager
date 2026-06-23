"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deleteCustomer } from "@/lib/actions/customers";

interface Props {
  id: string;
  name: string;
}

export function DeleteCustomerButton({ id, name }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const onConfirm = () => {
    startTransition(async () => {
      const res = await deleteCustomer(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Đã xóa "${name}"`);
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Xóa khách hàng?</DialogTitle>
          <DialogDescription>
            Hành động này không thể hoàn tác. Khách{" "}
            <span className="font-medium text-foreground">&ldquo;{name}&rdquo;</span> sẽ bị xóa.
            Nếu khách đang có báo giá hoặc ticket, thao tác sẽ bị chặn.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Hủy
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>
            {pending ? "Đang xóa…" : "Xóa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
