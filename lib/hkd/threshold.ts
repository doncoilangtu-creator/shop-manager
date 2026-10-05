/**
 * Doanh thu năm so với ngưỡng miễn thuế của hộ kinh doanh (1 tỷ đồng/năm theo ND141/2026).
 * Ngưỡng và tỷ lệ cảnh báo nằm trong bảng `legal_thresholds` (không hard-code); RPC `threshold_status`
 * trả về kết quả đã phân loại. `classifyRevenue` là bản TypeScript của cùng quy tắc, dùng cho test và UI
 * khi cần tính lại (ví dụ thanh tiến độ).
 */
export type ThresholdLevel = "none" | "ok" | "warning" | "exceeded";

export type ThresholdStatus = {
  year: number;
  revenue: number;
  threshold: number | null;
  pct: number | null;
  remaining: number | null;
  level: ThresholdLevel;
  warn_pct: number;
  source: string | null;
};

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : num(v));

const LEVELS: ThresholdLevel[] = ["none", "ok", "warning", "exceeded"];

export function parseThresholdStatus(raw: unknown): ThresholdStatus {
  const o = (raw ?? {}) as Record<string, unknown>;
  const level = LEVELS.includes(o.level as ThresholdLevel) ? (o.level as ThresholdLevel) : "none";
  return {
    year: num(o.year),
    revenue: num(o.revenue),
    threshold: numOrNull(o.threshold),
    pct: numOrNull(o.pct),
    remaining: numOrNull(o.remaining),
    level,
    warn_pct: o.warn_pct === undefined ? 80 : num(o.warn_pct),
    source: typeof o.source === "string" ? o.source : null,
  };
}

/** Mirror of the SQL rule: exceeded when revenue >= threshold, warning from `warnPct` %, else ok. */
export function classifyRevenue(revenue: number, threshold: number | null, warnPct = 80): ThresholdLevel {
  if (threshold === null || !(threshold > 0)) return "none";
  if (revenue >= threshold) return "exceeded";
  const pct = Math.trunc((revenue * 100 * 100) / threshold) / 100;
  return pct >= warnPct ? "warning" : "ok";
}

export type MonthRevenue = { month: string; revenue: number; cumulative: number };
export const parseRevenueByMonth = (raw: unknown): MonthRevenue[] =>
  (Array.isArray(raw) ? raw : []).map((r) => {
    const o = r as Record<string, unknown>;
    return { month: String(o.month), revenue: num(o.revenue), cumulative: num(o.cumulative) };
  });

export type TaxGroupRevenue = { tax_group: string; name_vi: string; revenue: number; vat_pct: number | null; pit_pct: number | null };
export const parseRevenueByTaxGroup = (raw: unknown): TaxGroupRevenue[] =>
  (Array.isArray(raw) ? raw : []).map((r) => {
    const o = r as Record<string, unknown>;
    return { tax_group: String(o.tax_group), name_vi: String(o.name_vi ?? o.tax_group), revenue: num(o.revenue), vat_pct: numOrNull(o.vat_pct), pit_pct: numOrNull(o.pit_pct) };
  });

/** Vietnamese banner copy for a status, or null when nothing needs to be shown. */
export function thresholdBanner(s: ThresholdStatus): { tone: "warning" | "danger"; title: string; body: string } | null {
  if (s.level !== "warning" && s.level !== "exceeded") return null;
  const pct = s.pct === null ? "" : `${s.pct.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}%`;
  const thr = s.threshold === null ? "" : new Intl.NumberFormat("vi-VN").format(s.threshold) + " đ";
  if (s.level === "exceeded") {
    return {
      tone: "danger",
      title: `Doanh thu năm ${s.year} đã đạt/vượt ngưỡng ${thr}`,
      body: `Doanh thu lũy kế ${new Intl.NumberFormat("vi-VN").format(s.revenue)} đ (${pct}). Hộ kinh doanh có doanh thu trên ngưỡng phải đăng ký hóa đơn điện tử có mã/từ máy tính tiền trong 30 ngày và chuyển sang kê khai theo quý. Liên hệ kế toán thuế/Thuế cơ sở ngay.`,
    };
  }
  return {
    tone: "warning",
    title: `Doanh thu năm ${s.year} đã đạt ${pct} ngưỡng ${thr}`,
    body: `Còn ${new Intl.NumberFormat("vi-VN").format(s.remaining ?? 0)} đ nữa là chạm ngưỡng. Hãy chuẩn bị đăng ký hóa đơn điện tử và phương án kê khai khi vượt ngưỡng.`,
  };
}
