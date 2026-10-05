/** Kỳ sổ/tờ khai: tháng, quý, năm, 6 tháng, hoặc khoảng ngày tự chọn. Ngày dạng YYYY-MM-DD (giờ VN, không dùng Date múi giờ máy). */
export type PeriodKind = "month" | "quarter" | "half" | "year" | "custom";
export type Period = { from: string; to: string };

const pad = (n: number) => String(n).padStart(2, "0");
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
export const isIsoDate = (s: unknown): s is string => {
  if (typeof s !== "string") return false;
  const m = ISO.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= lastDay(y, mo);
};
export const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const ROMAN = ["I", "II", "III", "IV"];

export function periodRange(kind: Exclude<PeriodKind, "custom">, year: number, n = 1): Period {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error("Năm không hợp lệ");
  switch (kind) {
    case "month": {
      if (n < 1 || n > 12) throw new Error("Tháng không hợp lệ");
      return { from: ymd(year, n, 1), to: ymd(year, n, lastDay(year, n)) };
    }
    case "quarter": {
      if (n < 1 || n > 4) throw new Error("Quý không hợp lệ");
      const m1 = (n - 1) * 3 + 1;
      return { from: ymd(year, m1, 1), to: ymd(year, m1 + 2, lastDay(year, m1 + 2)) };
    }
    case "half": {
      if (n < 1 || n > 2) throw new Error("Kỳ 6 tháng không hợp lệ");
      return n === 1 ? { from: ymd(year, 1, 1), to: ymd(year, 6, 30) } : { from: ymd(year, 7, 1), to: ymd(year, 12, 31) };
    }
    case "year":
      return { from: ymd(year, 1, 1), to: ymd(year, 12, 31) };
  }
}

export const vnDateText = (iso: string) => {
  const m = ISO.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

/** Nhãn kỳ kê khai: "Tháng 05/2026", "Quý II/2026", "6 tháng đầu năm 2026", "Năm 2026", hoặc "Từ 01/05/2026 đến 15/05/2026". */
export function periodLabel(p: Period): string {
  const a = ISO.exec(p.from), b = ISO.exec(p.to);
  if (!a || !b) return `${p.from} – ${p.to}`;
  const [y1, m1, d1] = [Number(a[1]), Number(a[2]), Number(a[3])];
  const [y2, m2, d2] = [Number(b[1]), Number(b[2]), Number(b[3])];
  const full = d1 === 1 && d2 === lastDay(y2, m2);
  if (full && y1 === y2) {
    if (m1 === m2) return `Tháng ${pad(m1)}/${y1}`;
    if (m1 === 1 && m2 === 12) return `Năm ${y1}`;
    if (m1 === 1 && m2 === 6) return `6 tháng đầu năm ${y1}`;
    if (m1 === 7 && m2 === 12) return `6 tháng cuối năm ${y1}`;
    if ((m1 - 1) % 3 === 0 && m2 === m1 + 2) return `Quý ${ROMAN[(m1 - 1) / 3]}/${y1}`;
  }
  return `Từ ${vnDateText(p.from)} đến ${vnDateText(p.to)}`;
}

/** Đoạn kỳ dùng trong tên file: 2026-05, 2026-Q2, 2026-H1, 2026, hoặc 20260501-20260515. */
export function periodSlug(p: Period): string {
  const l = periodLabel(p);
  let m: RegExpExecArray | null;
  if ((m = /^Tháng (\d{2})\/(\d{4})$/.exec(l))) return `${m[2]}-${m[1]}`;
  if ((m = /^Quý (I{1,3}|IV)\/(\d{4})$/.exec(l))) return `${m[2]}-Q${ROMAN.indexOf(m[1]) + 1}`;
  if ((m = /^6 tháng đầu năm (\d{4})$/.exec(l))) return `${m[1]}-H1`;
  if ((m = /^6 tháng cuối năm (\d{4})$/.exec(l))) return `${m[1]}-H2`;
  if ((m = /^Năm (\d{4})$/.exec(l))) return m[1];
  return `${p.from.replace(/-/g, "")}-${p.to.replace(/-/g, "")}`;
}

export function validatePeriod(p: { from?: unknown; to?: unknown }, maxDays = 1830): Period | string {
  if (!isIsoDate(p.from) || !isIsoDate(p.to)) return "Ngày không hợp lệ";
  if (p.to < p.from) return "Đến ngày phải sau từ ngày";
  const days = (Date.parse(p.to) - Date.parse(p.from)) / 86400000;
  if (days > maxDays) return "Kỳ tối đa 5 năm";
  return { from: p.from, to: p.to };
}

/** "Ngày 05 tháng 10 năm 2026" (dòng ngày lập sổ). */
export function signDateText(iso: string): string {
  const m = ISO.exec(iso);
  return m ? `Ngày ${m[3]} tháng ${m[2]} năm ${m[1]}` : "Ngày … tháng … năm …";
}

/** Các tháng (năm, tháng) nằm trong kỳ — để hiện trạng thái khóa sổ. */
export function monthsIn(p: Period): Array<{ year: number; month: number }> {
  const out: Array<{ year: number; month: number }> = [];
  let [y, m] = [Number(p.from.slice(0, 4)), Number(p.from.slice(5, 7))];
  const [y2, m2] = [Number(p.to.slice(0, 4)), Number(p.to.slice(5, 7))];
  while ((y < y2 || (y === y2 && m <= m2)) && out.length < 120) {
    out.push({ year: y, month: m });
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

/** Mã kỳ trong URL: m-2026-05 · q-2026-2 · h-2026-1 · y-2026 · c (tự chọn, dùng from/to). Mặc định: tháng hiện tại. */
export function parsePeriodParam(key: string | undefined | null, today: string, custom?: { from?: string | null; to?: string | null }): { key: string; period: Period } {
  const y0 = Number(today.slice(0, 4)), m0 = Number(today.slice(5, 7));
  const def = { key: `m-${y0}-${pad(m0)}`, period: periodRange("month", y0, m0) };
  if (!key) return def;
  let m: RegExpExecArray | null;
  try {
    if ((m = /^m-(\d{4})-(\d{2})$/.exec(key))) return { key, period: periodRange("month", Number(m[1]), Number(m[2])) };
    if ((m = /^q-(\d{4})-([1-4])$/.exec(key))) return { key, period: periodRange("quarter", Number(m[1]), Number(m[2])) };
    if ((m = /^h-(\d{4})-([12])$/.exec(key))) return { key, period: periodRange("half", Number(m[1]), Number(m[2])) };
    if ((m = /^y-(\d{4})$/.exec(key))) return { key, period: periodRange("year", Number(m[1])) };
    if (key === "c" && custom) {
      const v = validatePeriod({ from: custom.from, to: custom.to });
      if (typeof v !== "string") return { key, period: v };
    }
  } catch {
    return def;
  }
  return def;
}

/** Danh sách kỳ cho ô chọn: năm nay + năm trước (tháng, quý, 6 tháng, năm). */
export function periodOptions(today: string): Array<{ group: string; options: Array<{ key: string; label: string }> }> {
  const y0 = Number(today.slice(0, 4));
  const out: Array<{ group: string; options: Array<{ key: string; label: string }> }> = [];
  for (const y of [y0, y0 - 1]) {
    const months = Array.from({ length: 12 }, (_, i) => ({ key: `m-${y}-${pad(i + 1)}`, label: `Tháng ${pad(i + 1)}/${y}` }));
    const quarters = [1, 2, 3, 4].map((q) => ({ key: `q-${y}-${q}`, label: `Quý ${ROMAN[q - 1]}/${y}` }));
    out.push({ group: `Năm ${y}`, options: [{ key: `y-${y}`, label: `Cả năm ${y}` }, { key: `h-${y}-1`, label: `6 tháng đầu năm ${y}` }, { key: `h-${y}-2`, label: `6 tháng cuối năm ${y}` }, ...quarters, ...months] });
  }
  return out;
}
