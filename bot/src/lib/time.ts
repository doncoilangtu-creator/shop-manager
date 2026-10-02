/** Asia/Ho_Chi_Minh helpers (the server may run in UTC). */
export const VN_TZ = "Asia/Ho_Chi_Minh";

export function vnDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: VN_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function vnDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return "—";
  return x.toLocaleString("vi-VN", { timeZone: VN_TZ });
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** "2026-06" or "2026-6" -> {from:"2026-06-01", to:"2026-06-30"}; month must be 1..12. */
export function monthRange(arg: string): { year: number; month: number; from: string; to: string; key: string } | null {
  const m = /^(\d{4})-(\d{1,2})$/.exec(arg.trim());
  if (!m) return null;
  const year = Number(m[1]), month = Number(m[2]);
  if (month < 1 || month > 12 || year < 2000 || year > 2100) return null;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");
  return { year, month, from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, "0")}`, key: `${year}-${mm}` };
}

/** Start/end of the VN day window starting at an instant, as ISO strings for timestamptz comparisons. */
export function nowIso(): string { return new Date().toISOString(); }
