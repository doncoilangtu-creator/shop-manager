import Link from "next/link";
import { FileWarning } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatVND } from "@/lib/utils";
import { periodLabel, type Period } from "@/lib/books/period";
import { EinvoiceReminderButtons } from "@/components/einvoice/reminder-buttons";

/** Thẻ nhắc trên Dashboard: số đơn bán trong kỳ chưa có HĐĐT. Dữ liệu được truy vấn ở server và truyền vào. */
export function MissingEinvoiceReminderCard({ count, total, period }: { count: number; total: number; period: Period }) {
  if (count <= 0) return null;
  return (
    <Card className="border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileWarning className="h-4 w-4 text-amber-600" />
          Đơn bán chưa có hóa đơn điện tử
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          {periodLabel(period)}: <b>{count}</b> đơn, tổng <b>{formatVND(total)}</b> chưa ghi nhận hóa đơn điện tử.{" "}
          <Link href="/sales/missing-einvoice" className="font-medium text-primary underline-offset-4 hover:underline">
            Xem danh sách
          </Link>
        </p>
        <p className="text-xs text-muted-foreground">Nhắc nhở này không chặn việc bán hàng.</p>
        <EinvoiceReminderButtons modes={["snooze", "off"]} />
      </CardContent>
    </Card>
  );
}
