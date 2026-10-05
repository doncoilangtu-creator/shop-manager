/** Đơn bán chưa có hóa đơn điện tử (view v_sales_missing_einvoice). Thuần, dùng được ở client. */
import { isIsoDate, periodRange, validatePeriod, type Period } from "@/lib/books/period";

export type MissingEinvoiceRow = {
  sale_id: string;
  invoice_no: string;
  invoice_date: string;
  customer_id: string | null;
  customer_name: string;
  total: number;
};

export type MissingFilterKind = "month" | "quarter" | "year" | "custom";
export type MissingFilter = { kind: MissingFilterKind; year: number; n: number; period: Period };

export const EINV_REMINDER_COOKIE = "einv_reminder";
export const EINV_SNOOZE_DAYS = 30;

const str = (v: unknown) => (v == null ? "" : String(v));

export function parseMissingRows(raw: unknown): MissingEinvoiceRow[] {
  if (!Array.isArray(raw)) return [];
  const out: MissingEinvoiceRow[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const sale_id = str(o.sale_id);
    if (!sale_id) continue;
    const total = Number(o.total);
    out.push({
      sale_id,
      invoice_no: str(o.invoice_no),
      invoice_date: str(o.invoice_date).slice(0, 10),
      customer_id: o.customer_id == null ? null : str(o.customer_id),
      customer_name: str(o.customer_name),
      total: Number.isFinite(total) ? total : 0,
    });
  }
  return out;
}

function ymdParts(today: string): { year: number; month: number } {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  return { year: Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : 2026, month: m >= 1 && m <= 12 ? m : 1 };
}

/** Quý hiện tại theo ngày VN `today` (YYYY-MM-DD). */
export function defaultMissingFilter(today: string): MissingFilter {
  const { year, month } = ymdParts(today);
  const n = Math.floor((month - 1) / 3) + 1;
  return { kind: "quarter", year, n, period: periodRange("quarter", year, n) };
}

export function defaultMissingPeriod(today: string): Period {
  return defaultMissingFilter(today).period;
}

type Params = Record<string, string | string[] | undefined> | URLSearchParams | null | undefined;
const getParam = (sp: Params, k: string): string | undefined => {
  if (!sp) return undefined;
  if (sp instanceof URLSearchParams) return sp.get(k) ?? undefined;
  const v = sp[k];
  return Array.isArray(v) ? v[0] : v;
};

export function parseMissingFilter(sp: Params, today: string): MissingFilter {
  const def = defaultMissingFilter(today);
  const kind = getParam(sp, "kind");
  if (kind === "custom") {
    const from = getParam(sp, "from");
    const to = getParam(sp, "to");
    if (!isIsoDate(from) || !isIsoDate(to)) return def;
    const p = validatePeriod({ from, to });
    if (typeof p === "string") return def;
    return { kind: "custom", year: Number(from.slice(0, 4)), n: 1, period: p };
  }
  if (kind !== "month" && kind !== "quarter" && kind !== "year") return def;
  const year = Number(getParam(sp, "year") ?? def.year);
  const nRaw = getParam(sp, "n");
  const { month } = ymdParts(today);
  const n = kind === "year" ? 1 : Number(nRaw ?? (kind === "month" ? month : def.n));
  if (!Number.isInteger(year) || !Number.isInteger(n)) return def;
  try {
    return { kind, year, n, period: periodRange(kind, year, n) };
  } catch {
    return def;
  }
}

export function summarizeMissing(rows: Pick<MissingEinvoiceRow, "total">[]): { count: number; total: number } {
  return { count: rows.length, total: rows.reduce((s, r) => s + (Number.isFinite(r.total) ? r.total : 0), 0) };
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Giá trị cookie khi nhắc lại sau 30 ngày: 'snooze:<ngày hết hạn>'. */
export function snoozeCookieValue(today: string): string {
  return `snooze:${addDays(today, EINV_SNOOZE_DAYS)}`;
}

/** 'off' → ẩn; 'snooze:<YYYY-MM-DD>' → ẩn đến hết ngày đó (trước ngày đó); còn lại → hiện. */
export function reminderVisible(cookieValue: string | null | undefined, today: string): boolean {
  if (!cookieValue) return true;
  if (cookieValue === "off") return false;
  if (cookieValue.startsWith("snooze:")) {
    const until = cookieValue.slice(7);
    if (!isIsoDate(until)) return true;
    return today >= until;
  }
  return true;
}

export function reminderEnabled(cookieValue: string | null | undefined): boolean {
  return cookieValue !== "off";
}
