/**
 * Sổ doanh thu bán hàng hóa, dịch vụ — mẫu S1a-HKD (TT152/2025/TT-BTC Điều 4).
 * Bố cục giữ đúng mẫu: tiêu đề trái (HKD, địa chỉ, MST), góc phải (Mẫu số + căn cứ), tên sổ, địa điểm, kỳ kê khai, đơn vị tính,
 * bảng 3 cột (A Ngày tháng · B Diễn giải · 1 Số tiền), dòng Tổng cộng, ngày lập + khối ký người đại diện.
 * Bảng tổng hợp theo nhóm ngành để ở sheet riêng (TT152 Đ3.3 cho phép bổ sung), sheet chính không thêm cột.
 */
import type { XlsxCell, XlsxSheet } from "@/lib/xlsx/writer";
import { periodLabel, periodSlug, signDateText, vnDateText, type Period } from "@/lib/books/period";

export const S1A_TEMPLATE_VERSION = "TT152/2025 S1a-HKD";
export const S1A_FORM = {
  code: "Mẫu số S1a-HKD",
  basis: ["(Kèm theo Thông tư số 152/2025/TT-BTC", "ngày 31 tháng 12 năm 2025 của Bộ trưởng", "Bộ Tài chính)"],
  title: "SỔ DOANH THU BÁN HÀNG HÓA, DỊCH VỤ",
  signer: ["NGƯỜI ĐẠI DIỆN HỘ KINH DOANH/", "CÁ NHÂN KINH DOANH", "(Ký, ghi rõ họ tên, đóng dấu (nếu có))"],
} as const;

export type S1aRow = {
  line_date: string;
  doc_no: string | null;
  description: string;
  amount: number;
  tax_group: string | null;
  location_id: string | null;
  doc_type: string;
  doc_id: string | null;
};
export type BookHeader = {
  businessName: string;
  address: string;
  taxCode: string;
  locationLabel: string;
  locationCode?: string | null;
  signer: string;
  createdOn: string; // YYYY-MM-DD (ngày lập sổ)
};
export type S1aMode = "detail" | "daily";

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function parseS1aRows(raw: unknown): S1aRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return {
      line_date: String(o.line_date ?? ""),
      doc_no: typeof o.doc_no === "string" ? o.doc_no : null,
      description: String(o.description ?? ""),
      amount: num(o.amount),
      tax_group: typeof o.tax_group === "string" ? o.tax_group : null,
      location_id: typeof o.location_id === "string" ? o.location_id : null,
      doc_type: String(o.doc_type ?? ""),
      doc_id: typeof o.doc_id === "string" ? o.doc_id : null,
    };
  });
}

const r2 = (n: number) => Math.round(n * 100) / 100;
export const s1aTotal = (rows: S1aRow[]) => r2(rows.reduce((a, r) => a + r.amount, 0));

export function s1aByGroup(rows: S1aRow[], groupName: (code: string) => string): Array<{ code: string; name: string; amount: number }> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.tax_group ?? "", r2((m.get(r.tax_group ?? "") ?? 0) + r.amount));
  return [...m.entries()].map(([code, amount]) => ({ code, name: code ? groupName(code) : "Chưa phân nhóm", amount })).sort((a, b) => a.code.localeCompare(b.code));
}

/** Tên file theo mẫu: S1a-HKD_<MST>_<kỳ>[_<mã/tên địa điểm>].<ext> (chỉ ký tự an toàn). */
export function bookFileName(code: string, taxCode: string, p: Period, location: string | null, ext: "xlsx" | "pdf" | "zip"): string {
  const safe = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const parts = [code, safe(taxCode) || "chua-co-MST", periodSlug(p)];
  if (location) parts.push(safe(location));
  return `${parts.join("_")}.${ext}`;
}

/** Sheet chính đúng mẫu S1a-HKD. */
export function s1aSheet(h: BookHeader, p: Period, rows: S1aRow[]): XlsxSheet {
  const R: XlsxCell[][] = [];
  const merges: string[] = [];
  const push = (r: XlsxCell[]) => R.push(r);
  push([{ v: `HỘ, CÁ NHÂN KINH DOANH: ${h.businessName}`, s: "bold" }, null, { v: S1A_FORM.code, s: "boldCenter" }]);
  push([`Địa chỉ: ${h.address || "………………"}`, null, { v: S1A_FORM.basis[0], s: "italicCenter" }]);
  push([`Mã số thuế: ${h.taxCode || "………………"}`, null, { v: S1A_FORM.basis[1], s: "italicCenter" }]);
  push([null, null, { v: S1A_FORM.basis[2], s: "italicCenter" }]);
  merges.push("A1:B1", "A2:B2", "A3:B3");
  push([]);
  push([{ v: S1A_FORM.title, s: "title" }]); merges.push(`A${R.length}:C${R.length}`);
  push([{ v: `Địa điểm kinh doanh: ${h.locationLabel}`, s: "center" }]); merges.push(`A${R.length}:C${R.length}`);
  push([{ v: `Kỳ kê khai: ${periodLabel(p)}`, s: "center" }]); merges.push(`A${R.length}:C${R.length}`);
  push([null, null, { v: "Đơn vị tính: đồng", s: "italicRight" }]);
  const head = R.length + 1;
  push([{ v: "Ngày tháng", s: "th" }, { v: "Diễn giải", s: "th" }, { v: "Số tiền", s: "th" }]);
  push([{ v: "A", s: "th" }, { v: "B", s: "th" }, { v: "1", s: "th" }]);
  if (!rows.length) push([{ v: "", s: "tdCenter" }, { v: "Không phát sinh doanh thu trong kỳ", s: "td" }, { v: 0, s: "tdMoney" }]);
  for (const r of rows) push([{ v: vnDateText(r.line_date), s: "tdCenter" }, { v: r.description, s: "td" }, { v: r.amount, s: "tdMoney" }]);
  push([{ v: "", s: "tdBold" }, { v: "Tổng cộng", s: "tdBold" }, { v: s1aTotal(rows), s: "tdMoneyBold" }]);
  push([]);
  push([null, { v: signDateText(h.createdOn), s: "italicCenter" }]); merges.push(`B${R.length}:C${R.length}`);
  for (const [i, t] of S1A_FORM.signer.entries()) {
    push([null, { v: t, s: i < 2 ? "boldCenter" : "italicCenter" }]); merges.push(`B${R.length}:C${R.length}`);
  }
  push([]); push([]); push([]);
  push([null, { v: h.signer || "", s: "boldCenter" }]); merges.push(`B${R.length}:C${R.length}`);
  return { name: "S1a-HKD", rows: R, merges, cols: [13, 56, 34], repeatRows: `${head}:${head + 1}` };
}

/** Sheet phụ: tổng hợp theo nhóm ngành (dữ liệu cho thông báo doanh thu). */
export function s1aGroupSheet(h: BookHeader, p: Period, rows: S1aRow[], groupName: (code: string) => string): XlsxSheet {
  const groups = s1aByGroup(rows, groupName);
  const R: XlsxCell[][] = [
    [{ v: `Tổng hợp doanh thu theo nhóm ngành — ${h.businessName}`, s: "bold" }],
    [`Địa điểm: ${h.locationLabel} · Kỳ: ${periodLabel(p)} · Đơn vị tính: đồng`],
    [],
    [{ v: "Nhóm ngành", s: "th" }, { v: "Doanh thu", s: "th" }],
    ...groups.map((g) => [{ v: g.name, s: "td" as const }, { v: g.amount, s: "tdMoney" as const }]),
    [{ v: "Tổng cộng", s: "tdBold" }, { v: s1aTotal(rows), s: "tdMoneyBold" }],
    [],
    [{ v: "Bảng bổ sung (TT152/2025 Điều 3 khoản 3), không thay thế sổ S1a-HKD.", s: "italic" }],
  ];
  return { name: "Theo nhóm ngành", rows: R, cols: [70, 20] };
}
