import Link from "next/link";
import { AlertTriangle, OctagonAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { parseThresholdStatus, thresholdBanner } from "@/lib/hkd/threshold";
import { cn } from "@/lib/utils";

/**
 * Banner on every dashboard page when this year's revenue reached the warning level (80 %) or the exempt-revenue
 * threshold. Best effort: a failed lookup must not take every page down, so it logs and renders nothing.
 */
export async function ThresholdBanner() {
  try {
    const sb = await createClient();
    const { data, error } = await sb.rpc("threshold_status");
    if (error) throw new Error(error.message);
    const b = thresholdBanner(parseThresholdStatus(data));
    if (!b) return null;
    const Icon = b.tone === "danger" ? OctagonAlert : AlertTriangle;
    return (
      <div role="alert" className={cn("mb-4 flex items-start gap-3 rounded-md border p-3 text-sm",
        b.tone === "danger" ? "border-red-300 bg-red-50 text-red-900" : "border-amber-300 bg-amber-50 text-amber-900")}>
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-1">
          <div className="font-semibold">{b.title}</div>
          <div>{b.body}</div>
          <Link href="/reports/revenue" className="font-medium underline">Xem báo cáo doanh thu năm →</Link>
        </div>
      </div>
    );
  } catch (e) {
    console.error("ThresholdBanner:", e instanceof Error ? e.message : e);
    return null;
  }
}
