import { cn, formatVND } from "@/lib/utils";
import type { ThresholdStatus } from "@/lib/hkd/threshold";

const LEVEL_LABEL: Record<ThresholdStatus["level"], string> = {
  none: "Chưa cấu hình ngưỡng",
  ok: "An toàn",
  warning: "Sắp chạm ngưỡng",
  exceeded: "Đã đạt/vượt ngưỡng",
};

/** Progress bar of the year's revenue against the exempt-revenue threshold (pure presentation). */
export function ThresholdProgress({ status }: { status: ThresholdStatus }) {
  const pct = status.pct ?? 0;
  const width = Math.min(100, Math.max(0, pct));
  const tone = status.level === "exceeded" ? "bg-red-600" : status.level === "warning" ? "bg-amber-500" : "bg-emerald-600";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{formatVND(status.revenue)}{status.threshold !== null && <span className="text-muted-foreground"> / {formatVND(status.threshold)}</span>}</span>
        <span className={cn("text-xs font-medium", status.level === "exceeded" ? "text-red-600" : status.level === "warning" ? "text-amber-600" : "text-muted-foreground")}>
          {status.pct !== null ? `${status.pct.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}% · ` : ""}{LEVEL_LABEL[status.level]}
        </span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(width)}>
        <div className={cn("h-3 rounded-full", tone)} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}
