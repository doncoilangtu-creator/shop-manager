"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setEinvoiceReminderAction, type ReminderMode } from "@/lib/actions/einvoice-reminder";

const MSG: Record<ReminderMode, string> = {
  snooze: "Sẽ nhắc lại sau 30 ngày",
  off: "Đã tắt nhắc hóa đơn điện tử trên Dashboard",
  on: "Đã bật nhắc hóa đơn điện tử trên Dashboard",
};

/** Nút điều khiển nhắc nhở. `modes` chọn nút nào hiển thị. */
export function EinvoiceReminderButtons({ modes }: { modes: ReminderMode[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (mode: ReminderMode) =>
    start(async () => {
      const res = await setEinvoiceReminderAction(mode);
      if (!res.ok) { toast.error(res.error); return; }
      toast.success(MSG[mode]);
      router.refresh();
    });
  return (
    <div className="flex flex-wrap gap-2">
      {modes.includes("snooze") && (
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run("snooze")}>
          Nhắc lại sau 30 ngày
        </Button>
      )}
      {modes.includes("off") && (
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => run("off")}>
          Tắt nhắc
        </Button>
      )}
      {modes.includes("on") && (
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run("on")}>
          Bật nhắc trên Dashboard
        </Button>
      )}
    </div>
  );
}
