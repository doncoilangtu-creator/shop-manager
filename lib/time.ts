/**
 * Business time = Asia/Ho_Chi_Minh (UTC+7, no DST).
 * Vercel/Node servers run in UTC, so "this month" computed with local getters is wrong for
 * 7 hours a day around month boundaries. Everything that decides "which day/month is it"
 * goes through this module. Pure functions, no I/O.
 */
export const VN_TZ = "Asia/Ho_Chi_Minh";
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

export type VnParts = { year: number; month: number; day: number; hour: number; minute: number };

/** Calendar parts of an instant, as seen in Vietnam. */
export function vnParts(d: Date | string | number = new Date()): VnParts {
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) throw new RangeError("invalid date");
  const s = new Date(t + VN_OFFSET_MS);
  return {
    year: s.getUTCFullYear(),
    month: s.getUTCMonth() + 1,
    day: s.getUTCDate(),
    hour: s.getUTCHours(),
    minute: s.getUTCMinutes(),
  };
}

const p2 = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD in Vietnam (use for `date` columns / document dates). */
export function vnDate(d: Date | string | number = new Date()): string {
  const p = vnParts(d);
  return `${p.year}-${p2(p.month)}-${p2(p.day)}`;
}

/** YYYYMMDD in Vietnam (document codes). */
export function vnYmd(d: Date | string | number = new Date()): string {
  return vnDate(d).replaceAll("-", "");
}

/** YYYY-MM bucket key in Vietnam (report grouping). */
export function vnMonthKey(d: Date | string | number): string {
  const p = vnParts(d);
  return `${p.year}-${p2(p.month)}`;
}

/** UTC instant (ISO) of 00:00 on the 1st of year-month in Vietnam. `month` is 1..12, may overflow/underflow. */
export function vnMonthStartIso(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1) - VN_OFFSET_MS).toISOString();
}

/** Start of the current month in Vietnam, as a UTC ISO string for `.gte("created_at", …)`. */
export function vnCurrentMonthStartIso(now: Date = new Date()): string {
  const p = vnParts(now);
  return vnMonthStartIso(p.year, p.month);
}

/** Start of the month `n` months before the current one (n=11 -> 12-month window). */
export function vnMonthsAgoStartIso(n: number, now: Date = new Date()): string {
  const p = vnParts(now);
  return vnMonthStartIso(p.year, p.month - n);
}

/** [from, to) UTC instants covering a Vietnam calendar month. */
export function vnMonthRange(year: number, month: number): { from: string; to: string } {
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new RangeError("month must be 1..12");
  return { from: vnMonthStartIso(year, month), to: vnMonthStartIso(year, month + 1) };
}

/** Last N month keys ending with the current one, oldest first. */
export function vnLastMonthKeys(n: number, now: Date = new Date()): string[] {
  const p = vnParts(now);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(p.year, p.month - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}`);
  }
  return out;
}
