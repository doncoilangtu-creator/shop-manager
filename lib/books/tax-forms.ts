/**
 * Dữ liệu tờ khai HKD doanh thu ≤ 1 tỷ: 01/TKN-CNKD (thông báo doanh thu năm — TT50/2026) và 01/BK-STK (bảng kê tài khoản — TT18/2026).
 * HKD dưới ngưỡng chỉ thông báo doanh thu (không khai số thuế). Số tài khoản đầy đủ chỉ chủ hộ xem được.
 */
import type { XlsxCell, XlsxSheet } from "@/lib/xlsx/writer";
import { signDateText, type Period } from "@/lib/books/period";
import type { BookHeader } from "@/lib/books/s1a";
import { bookFileName } from "@/lib/books/s1a";

export const TKN_TEMPLATE_VERSION = "TT50/2026 01/TKN-CNKD";
export const BK_STK_TEMPLATE_VERSION = "TT18/2026 01/BK-STK";

export type TknPeriodKind = "year" | "h1" | "h2";
export type TknRow = { code: string; revenue: number };
export type BkStkStatus = "first" | "changed" | "closed" | "unchanged" | "closed_reported";
export type BkStkRow = {
  account_id: string;
  kind: string;
  label: string;
  provider: string | null;
  account_no: string | null;
  account_no_masked: string | null;
  holder: string | null;
  location_id: string | null;
  location_name: string | null;
  location_code: string | null;
  status: BkStkStatus;
  active: boolean;
  tax_notified_at: string | null;
  missing: string[];
};

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function parseTknRows(raw: unknown): TknRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return { code: String(o.code ?? ""), revenue: num(o.revenue) };
  });
}

export function parseBkStkRows(raw: unknown): BkStkRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const status = String(o.status ?? "") as BkStkStatus;
    return {
      account_id: String(o.account_id ?? ""),
      kind: String(o.kind ?? ""),
      label: String(o.label ?? ""),
      provider: typeof o.provider === "string" ? o.provider : null,
      account_no: typeof o.account_no === "string" ? o.account_no : null,
      account_no_masked: typeof o.account_no_masked === "string" ? o.account_no_masked : null,
      holder: typeof o.holder === "string" ? o.holder : null,
      location_id: typeof o.location_id === "string" ? o.location_id : null,
      location_name: typeof o.location_name === "string" ? o.location_name : null,
      location_code: typeof o.location_code === "string" ? o.location_code : null,
      status,
      active: !!o.active,
      tax_notified_at: typeof o.tax_notified_at === "string" ? o.tax_notified_at : null,
      missing: Array.isArray(o.missing) ? o.missing.map(String) : [],
    };
  });
}

/** Kỳ tờ khai → tham số RPC + nhãn + Period cho tên file / nhật ký xuất. */
export function tknPeriod(year: number, kind: TknPeriodKind): { half: number | null; label: string; period: Period } {
  if (kind === "h1") return { half: 1, label: `6 tháng đầu năm ${year}`, period: { from: `${year}-01-01`, to: `${year}-06-30` } };
  if (kind === "h2") return { half: 2, label: `6 tháng cuối năm ${year}`, period: { from: `${year}-07-01`, to: `${year}-12-31` } };
  return { half: null, label: `Năm ${year}`, period: { from: `${year}-01-01`, to: `${year}-12-31` } };
}

/** Hạn nộp gợi ý (nhắc việc, chủ hộ cần đối chiếu với cơ quan thuế): năm → 31/01 năm sau; 6 tháng đầu → 31/07; 6 tháng cuối → 31/01 năm sau. */
export function tknDeadline(year: number, kind: TknPeriodKind): string {
  return kind === "h1" ? `${year}-07-31` : `${year + 1}-01-31`;
}

export function tknMap(rows: TknRow[]): Map<string, number> {
  return new Map(rows.map((r) => [r.code, r.revenue]));
}

export const TKN_INDICATORS: Array<{ code: string; label: string; indent?: boolean }> = [
  { code: "08", label: "[08] Hoạt động SXKD hàng hóa, cung cấp dịch vụ có địa điểm KD cố định" },
  { code: "08a", label: "[08a] Phân phối, cung cấp hàng hóa", indent: true },
  { code: "08b", label: "[08b] Dịch vụ, xây dựng không bao thầu NVL", indent: true },
  { code: "08c", label: "[08c] Cho thuê tài sản trừ BĐS", indent: true },
  { code: "08d", label: "[08d] Sản xuất, vận tải, dịch vụ gắn hàng hóa / xây dựng có bao thầu NVL", indent: true },
  { code: "08e", label: "[08e] Nội dung thông tin số (giải trí, game, phim, nhạc, quảng cáo số…)", indent: true },
  { code: "08g", label: "[08g] Hoạt động kinh doanh khác", indent: true },
  { code: "09", label: "[09] Kinh doanh trên nền tảng TMĐT, nền tảng số khác" },
  { code: "09a", label: "[09a] Phân phối, cung cấp hàng hóa", indent: true },
  { code: "09b", label: "[09b] Dịch vụ, xây dựng không bao thầu NVL", indent: true },
  { code: "09c", label: "[09c] Cho thuê tài sản trừ BĐS", indent: true },
  { code: "09d", label: "[09d] Sản xuất, vận tải, dịch vụ gắn hàng hóa / xây dựng có bao thầu NVL", indent: true },
  { code: "09e", label: "[09e] Nội dung thông tin số", indent: true },
  { code: "09g", label: "[09g] Hoạt động kinh doanh khác", indent: true },
  { code: "10", label: "[10] Đại lý xổ số, bảo hiểm, bán hàng đa cấp" },
  { code: "11", label: "[11] Tổng cộng" },
];

export const BK_STATUS_VI: Record<BkStkStatus, string> = {
  first: "Khai lần đầu",
  changed: "Thay đổi thông tin",
  closed: "Đóng",
  unchanged: "Đã khai (không đổi)",
  closed_reported: "Đã khai đóng",
};

export function bkStkMissingVi(m: string[]): string {
  const map: Record<string, string> = { account_no: "số tài khoản", provider: "ngân hàng/ví", holder: "chủ tài khoản", location: "địa điểm KD" };
  return m.map((x) => map[x] ?? x).join(", ");
}

/** Sheet chính mẫu 01/TKN-CNKD — chỉ cột doanh thu (HKD ≤ 1 tỷ không khai số thuế). */
export function tknSheet(h: BookHeader, year: number, kind: TknPeriodKind, rows: TknRow[]): XlsxSheet {
  const m = tknMap(rows);
  const { label } = tknPeriod(year, kind);
  const R: XlsxCell[][] = [];
  const merges: string[] = [];
  R.push([{ v: "CỘNG HOÀ XÃ HỘI CHỦ NGHĨA VIỆT NAM", s: "boldCenter" }, null, null, { v: "Mẫu số: 01/TKN-CNKD", s: "boldCenter" }]);
  R.push([{ v: "Độc lập - Tự do - Hạnh phúc", s: "italicCenter" }, null, null, { v: "(Kèm theo Thông tư số 50/2026/TT-BTC", s: "italicCenter" }]);
  R.push([null, null, null, { v: "ngày 13/5/2026 của Bộ trưởng Bộ Tài chính)", s: "italicCenter" }]);
  merges.push("A1:C1", "A2:C2");
  R.push([]);
  R.push([{ v: "THÔNG BÁO DOANH THU/TỜ KHAI THUẾ NĂM", s: "title" }]); merges.push(`A${R.length}:D${R.length}`);
  R.push([{ v: "(Áp dụng đối với hộ kinh doanh, cá nhân kinh doanh có doanh thu năm từ 01 tỷ đồng trở xuống)", s: "center" }]); merges.push(`A${R.length}:D${R.length}`);
  R.push([{ v: "☑ Hộ kinh doanh, cá nhân kinh doanh có doanh thu năm từ 01 tỷ đồng trở xuống", s: "bold" }]); merges.push(`A${R.length}:D${R.length}`);
  R.push([]);
  R.push([`[01] Kỳ tính thuế: ${label}`, null, `[04] Người nộp thuế: ${h.businessName}`]);
  R.push([`[02] Lần đầu ☑   [03] Bổ sung lần thứ: ……`, null, `[05] Mã số thuế: ${h.taxCode || "………………"}`]);
  R.push([`[06] Tổ chức/cá nhân kê khai, nộp thuế thay theo ủy quyền (nếu có): ………………`]); merges.push(`A${R.length}:D${R.length}`);
  R.push([`[07] Tên đại lý thuế (nếu có): ………………`]); merges.push(`A${R.length}:D${R.length}`);
  R.push([]);
  R.push([{ v: "A. XÁC ĐỊNH NGHĨA VỤ THUẾ GTGT, TNCN", s: "bold" }, null, null, { v: "Đơn vị tiền: Đồng Việt Nam", s: "italicRight" }]);
  R.push([{ v: "Ghi chú: HKD có doanh thu năm ≤ 1 tỷ đồng chỉ thông báo doanh thu; không khai số thuế GTGT/TNCN phải nộp.", s: "italic" }]); merges.push(`A${R.length}:D${R.length}`);
  R.push([{ v: "STT / Chỉ tiêu", s: "th" }, { v: "Mã chỉ tiêu", s: "th" }, { v: "Tổng doanh thu (1)", s: "th" }, { v: "Ghi chú", s: "th" }]);
  for (const ind of TKN_INDICATORS) {
    const rev = m.get(ind.code) ?? 0;
    R.push([
      { v: (ind.indent ? "    " : "") + ind.label.replace(/^\[\w+\]\s*/, ""), s: ind.code === "11" ? "tdBold" : "td" },
      { v: ind.code, s: "tdCenter" },
      { v: rev, s: ind.code === "11" ? "tdMoneyBold" : "tdMoney" },
      { v: "", s: "td" },
    ]);
  }
  R.push([]);
  R.push([null, null, { v: signDateText(h.createdOn), s: "italicCenter" }]); merges.push(`C${R.length}:D${R.length}`);
  R.push([null, null, { v: "NGƯỜI NỘP THUẾ hoặc", s: "boldCenter" }]); merges.push(`C${R.length}:D${R.length}`);
  R.push([null, null, { v: "ĐẠI DIỆN HỢP PHÁP CỦA NGƯỜI NỘP THUẾ", s: "boldCenter" }]); merges.push(`C${R.length}:D${R.length}`);
  R.push([null, null, { v: "(Ký, ghi rõ họ tên/ Ký điện tử)", s: "italicCenter" }]); merges.push(`C${R.length}:D${R.length}`);
  R.push([]); R.push([]); R.push([]);
  R.push([null, null, { v: h.signer || "", s: "boldCenter" }]); merges.push(`C${R.length}:D${R.length}`);
  R.push([]);
  R.push([{ v: "Tôi cam đoan những nội dung kê khai trên là đúng và chịu trách nhiệm trước pháp luật về những nội dung đã khai./.", s: "italic" }]); merges.push(`A${R.length}:D${R.length}`);
  return { name: "01-TKN-CNKD", rows: R, merges, cols: [55, 12, 22, 22] };
}

/** Sheet chính mẫu 01/BK-STK. */
export function bkStkSheet(h: BookHeader, rows: BkStkRow[]): XlsxSheet {
  const R: XlsxCell[][] = [];
  const merges: string[] = [];
  R.push([{ v: "CỘNG HOÀ XÃ HỘI CHỦ NGHĨA VIỆT NAM", s: "boldCenter" }, null, null, null, { v: "Mẫu số: 01/BK-STK", s: "boldCenter" }]);
  R.push([{ v: "Độc lập - Tự do - Hạnh phúc", s: "italicCenter" }, null, null, null, { v: "(Kèm theo Thông tư số 18/2026/TT-BTC)", s: "italicCenter" }]);
  merges.push("A1:D1", "A2:D2");
  R.push([]);
  R.push([{ v: "BẢNG KÊ TÀI KHOẢN", s: "title" }]); merges.push(`A${R.length}:I${R.length}`);
  R.push([`[01] Người nộp thuế: ${h.businessName}`]); merges.push(`A${R.length}:I${R.length}`);
  R.push([`[02] Mã số thuế: ${h.taxCode || "………………"}`]); merges.push(`A${R.length}:I${R.length}`);
  R.push([]);
  R.push([
    { v: "[03] STT", s: "th" }, { v: "[04] Tên địa điểm KD", s: "th" }, { v: "[05] Mã địa điểm KD", s: "th" },
    { v: "[06] Số tài khoản NH / Số hiệu ví", s: "th" }, { v: "[07] Tên chủ tài khoản", s: "th" },
    { v: "[08] Mở tại tổ chức cung ứng dịch vụ thanh toán / trung gian thanh toán", s: "th" },
    { v: "[09] Trạng thái", s: "th" }, { v: "Tên nội bộ", s: "th" }, { v: "Thiếu", s: "th" },
  ]);
  if (!rows.length) {
    R.push([{ v: "", s: "tdCenter" }, { v: "Không có tài khoản cần kê khai", s: "td" }, { v: "", s: "td" }, { v: "", s: "td" }, { v: "", s: "td" }, { v: "", s: "td" }, { v: "", s: "td" }, { v: "", s: "td" }, { v: "", s: "td" }]);
  }
  rows.forEach((r, i) => {
    R.push([
      { v: i + 1, s: "tdCenter" },
      { v: r.location_name ?? "", s: "td" },
      { v: r.location_code ?? "", s: "tdCenter" },
      { v: r.account_no ?? "(thiếu số)", s: "td" },
      { v: r.holder ?? "", s: "td" },
      { v: r.provider ?? "", s: "td" },
      { v: BK_STATUS_VI[r.status] ?? r.status, s: "tdCenter" },
      { v: r.label, s: "td" },
      { v: bkStkMissingVi(r.missing), s: "td" },
    ]);
  });
  R.push([]);
  R.push([{ v: "Tôi cam đoan những nội dung kê khai trên là đúng và chịu trách nhiệm trước pháp luật về những nội dung đã khai./.", s: "italic" }]); merges.push(`A${R.length}:I${R.length}`);
  R.push([]);
  R.push([null, null, null, null, null, { v: signDateText(h.createdOn), s: "italicCenter" }]); merges.push(`F${R.length}:I${R.length}`);
  R.push([null, null, null, null, null, { v: "NGƯỜI NỘP THUẾ hoặc", s: "boldCenter" }]); merges.push(`F${R.length}:I${R.length}`);
  R.push([null, null, null, null, null, { v: "ĐẠI DIỆN HỢP PHÁP CỦA NGƯỜI NỘP THUẾ", s: "boldCenter" }]); merges.push(`F${R.length}:I${R.length}`);
  R.push([null, null, null, null, null, { v: "(Ký, ghi rõ họ tên/ Ký điện tử)", s: "italicCenter" }]); merges.push(`F${R.length}:I${R.length}`);
  R.push([]); R.push([]); R.push([]);
  R.push([null, null, null, null, null, { v: h.signer || "", s: "boldCenter" }]); merges.push(`F${R.length}:I${R.length}`);
  return { name: "01-BK-STK", rows: R, merges, cols: [8, 22, 14, 22, 20, 28, 16, 16, 18], landscape: true };
}

export function tknFileName(h: BookHeader, year: number, kind: TknPeriodKind, ext: "xlsx" | "pdf") {
  return bookFileName("01-TKN-CNKD", h.taxCode, tknPeriod(year, kind).period, null, ext);
}
export function bkStkFileName(h: BookHeader, ext: "xlsx" | "pdf") {
  const today = h.createdOn;
  return bookFileName("01-BK-STK", h.taxCode, { from: today, to: today }, null, ext);
}
