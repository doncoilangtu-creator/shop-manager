/**
 * Hồ sơ kiểm tra (audit pack) — phần lõi thuần, dùng được ở client lẫn server (không import node).
 * Gom dữ liệu kỳ kê khai (năm / 6 tháng) thành các sheet đối chiếu: bán hàng ↔ hóa đơn điện tử, mua hàng, số dư tiền.
 * Phần đóng gói zip + manifest + SHA256 nằm ở lib/books/audit-pack-zip.ts (server-side).
 */
import type { XlsxCell, XlsxSheet } from "@/lib/xlsx/writer";
import { bookFileName } from "@/lib/books/s1a";
import { TKN_KINDS, type TknPeriodKind } from "@/lib/books/tax-forms";

export type AuditPackProfile = {
  businessName: string;
  address: string;
  taxCode: string;
  ownerName?: string | null;
  industry?: string | null;
};

export type AuditPackPeriod = { kind: TknPeriodKind; year: number; from: string; to: string; label: string };

export type EinvoiceStatus = "issued" | "cancelled" | "missing" | "pending" | "replaced" | "adjusted";

export type AuditSaleRow = {
  date: string; // YYYY-MM-DD
  docNo: string;
  customer: string;
  total: number;
  einvoiceNo: string | null;
  einvoiceSerial: string | null;
  einvoiceStatus: EinvoiceStatus | string;
};

export type AuditPurchaseRow = {
  date: string;
  docNo: string;
  supplier: string;
  supplierInvoiceNo: string | null;
  total: number;
  paid: number;
};

export type AuditBalanceKind = "cash" | "bank" | "ewallet";
export type AuditBalanceRow = {
  accountName: string;
  kind: AuditBalanceKind;
  opening: number;
  inflow: number;
  outflow: number;
  closing: number;
};

export type AuditS1aCheck = { s1aTotal: number; glTotal: number; diff: number };

export type AuditPackInput = {
  header: AuditPackProfile;
  period: AuditPackPeriod;
  generatedAt: string; // ISO
  generatedBy: string;
  isOwner: boolean;
  sales: AuditSaleRow[];
  purchases: AuditPurchaseRow[];
  balances: AuditBalanceRow[];
  s1aCheck: AuditS1aCheck;
};

/** Kỳ hỗ trợ: dùng lại kỳ của tờ khai 01/TKN-CNKD (năm, 6 tháng đầu, 6 tháng cuối). */
export const AUDIT_PACK_PERIODS = TKN_KINDS;

export const EINVOICE_STATUS_VI: Record<string, string> = {
  issued: "Đã xuất",
  cancelled: "Đã hủy",
  missing: "Chưa xuất HĐ",
  pending: "Đang chờ",
  replaced: "Bị thay thế",
  adjusted: "Đã điều chỉnh",
};

export const BALANCE_KIND_VI: Record<AuditBalanceKind, string> = {
  cash: "Tiền mặt",
  bank: "Ngân hàng",
  ewallet: "Ví điện tử",
};

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const sum = <T>(rows: T[], f: (r: T) => number) => r2(rows.reduce((a, r) => a + (Number(f(r)) || 0), 0));
const vnDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso || "";
};

export const isEinvoiceMissing = (r: AuditSaleRow) => r.einvoiceStatus === "missing" || (!r.einvoiceNo && r.einvoiceStatus !== "cancelled");

export function auditSalesSummary(rows: AuditSaleRow[]) {
  const missing = rows.filter(isEinvoiceMissing);
  return { count: rows.length, total: sum(rows, (r) => r.total), missingCount: missing.length, missingTotal: sum(missing, (r) => r.total) };
}
export function auditPurchasesSummary(rows: AuditPurchaseRow[]) {
  const total = sum(rows, (r) => r.total);
  const paid = sum(rows, (r) => r.paid);
  return { count: rows.length, total, paid, unpaid: r2(total - paid), withoutInvoice: rows.filter((r) => !r.supplierInvoiceNo).length };
}
export function auditBalancesSummary(rows: AuditBalanceRow[]) {
  return {
    opening: sum(rows, (r) => r.opening),
    inflow: sum(rows, (r) => r.inflow),
    outflow: sum(rows, (r) => r.outflow),
    closing: sum(rows, (r) => r.closing),
  };
}

function headBlock(input: AuditPackInput, title: string, ncols: number, merges: string[]): XlsxCell[][] {
  const last = String.fromCharCode(64 + ncols);
  const R: XlsxCell[][] = [];
  const h = input.header;
  R.push([{ v: `HỘ, CÁ NHÂN KINH DOANH: ${h.businessName}`, s: "bold" }]);
  R.push([`Địa chỉ: ${h.address || "………………"}`]);
  R.push([`Mã số thuế: ${h.taxCode || "………………"}`]);
  R.push([]);
  R.push([{ v: title, s: "title" }]);
  merges.push(`A${R.length}:${last}${R.length}`);
  R.push([{ v: `Kỳ: ${input.period.label} (${vnDate(input.period.from)} – ${vnDate(input.period.to)})`, s: "center" }]);
  merges.push(`A${R.length}:${last}${R.length}`);
  const pad: XlsxCell[] = Array(ncols - 1).fill(null);
  R.push([...pad, { v: "Đơn vị tính: đồng", s: "italicRight" }]);
  return R;
}

export const SALES_EINVOICE_HEADERS = ["STT", "Ngày", "Số chứng từ", "Khách hàng", "Số tiền", "Ký hiệu HĐ", "Số HĐ", "Trạng thái HĐĐT"];

/** Bảng kê bán hàng ↔ hóa đơn điện tử, có dòng tổng và số chứng từ chưa xuất hóa đơn. */
export function salesEinvoiceSheet(input: AuditPackInput): XlsxSheet {
  const merges: string[] = [];
  const R = headBlock(input, "BẢNG KÊ BÁN HÀNG VÀ HÓA ĐƠN ĐIỆN TỬ", SALES_EINVOICE_HEADERS.length, merges);
  const head = R.length + 1;
  R.push(SALES_EINVOICE_HEADERS.map((v) => ({ v, s: "th" as const })));
  if (!input.sales.length) R.push([{ v: "", s: "tdCenter" }, { v: "", s: "tdCenter" }, { v: "", s: "td" }, { v: "Không phát sinh bán hàng trong kỳ", s: "td" }, { v: 0, s: "tdMoney" }, { v: "", s: "td" }, { v: "", s: "td" }, { v: "", s: "td" }]);
  input.sales.forEach((r, i) =>
    R.push([
      { v: i + 1, s: "tdCenter" },
      { v: vnDate(r.date), s: "tdCenter" },
      { v: r.docNo, s: "td" },
      { v: r.customer || "Khách lẻ", s: "td" },
      { v: r2(r.total), s: "tdMoney" },
      { v: r.einvoiceSerial ?? "", s: "tdCenter" },
      { v: r.einvoiceNo ?? "", s: "tdCenter" },
      { v: isEinvoiceMissing(r) ? EINVOICE_STATUS_VI.missing : EINVOICE_STATUS_VI[r.einvoiceStatus] ?? String(r.einvoiceStatus), s: "td" },
    ]),
  );
  const s = auditSalesSummary(input.sales);
  R.push([{ v: "", s: "tdBold" }, { v: "", s: "tdBold" }, { v: "", s: "tdBold" }, { v: "Tổng cộng", s: "tdBold" }, { v: s.total, s: "tdMoneyBold" }, { v: "", s: "tdBold" }, { v: "", s: "tdBold" }, { v: `${s.count} chứng từ`, s: "tdBold" }]);
  R.push([]);
  R.push([{ v: `Số chứng từ chưa xuất hóa đơn: ${s.missingCount}`, s: "bold" }, null, null, null, { v: s.missingTotal, s: "money" }]);
  merges.push(`A${R.length}:D${R.length}`);
  return { name: "BanHang-HDDT", rows: R, merges, cols: [6, 12, 16, 30, 16, 12, 12, 18], landscape: true, repeatRows: `${head}:${head}` };
}

export const PURCHASES_HEADERS = ["STT", "Ngày", "Số chứng từ", "Nhà cung cấp", "Số HĐ đầu vào", "Tổng tiền", "Đã trả", "Còn nợ"];

/** Bảng kê mua hàng trong kỳ. */
export function purchasesSheet(input: AuditPackInput): XlsxSheet {
  const merges: string[] = [];
  const R = headBlock(input, "BẢNG KÊ MUA HÀNG HÓA, DỊCH VỤ", PURCHASES_HEADERS.length, merges);
  const head = R.length + 1;
  R.push(PURCHASES_HEADERS.map((v) => ({ v, s: "th" as const })));
  if (!input.purchases.length) R.push([{ v: "", s: "tdCenter" }, { v: "", s: "tdCenter" }, { v: "", s: "td" }, { v: "Không phát sinh mua hàng trong kỳ", s: "td" }, { v: "", s: "td" }, { v: 0, s: "tdMoney" }, { v: 0, s: "tdMoney" }, { v: 0, s: "tdMoney" }]);
  input.purchases.forEach((r, i) =>
    R.push([
      { v: i + 1, s: "tdCenter" },
      { v: vnDate(r.date), s: "tdCenter" },
      { v: r.docNo, s: "td" },
      { v: r.supplier, s: "td" },
      { v: r.supplierInvoiceNo ?? "", s: "tdCenter" },
      { v: r2(r.total), s: "tdMoney" },
      { v: r2(r.paid), s: "tdMoney" },
      { v: r2(r.total - r.paid), s: "tdMoney" },
    ]),
  );
  const s = auditPurchasesSummary(input.purchases);
  R.push([{ v: "", s: "tdBold" }, { v: "", s: "tdBold" }, { v: "", s: "tdBold" }, { v: "Tổng cộng", s: "tdBold" }, { v: `${s.count} chứng từ`, s: "tdBold" }, { v: s.total, s: "tdMoneyBold" }, { v: s.paid, s: "tdMoneyBold" }, { v: s.unpaid, s: "tdMoneyBold" }]);
  R.push([]);
  R.push([{ v: `Số chứng từ không có hóa đơn đầu vào: ${s.withoutInvoice}`, s: "bold" }]);
  merges.push(`A${R.length}:D${R.length}`);
  return { name: "MuaHang", rows: R, merges, cols: [6, 12, 16, 30, 16, 16, 16, 16], landscape: true, repeatRows: `${head}:${head}` };
}

export const BALANCES_HEADERS = ["STT", "Tài khoản", "Loại", "Số dư đầu kỳ", "Thu trong kỳ", "Chi trong kỳ", "Số dư cuối kỳ"];

/** Bảng số dư tiền mặt / ngân hàng / ví điện tử. */
export function balancesSheet(input: AuditPackInput): XlsxSheet {
  const merges: string[] = [];
  const R = headBlock(input, "BẢNG TỔNG HỢP TIỀN MẶT, TIỀN GỬI", BALANCES_HEADERS.length, merges);
  const head = R.length + 1;
  R.push(BALANCES_HEADERS.map((v) => ({ v, s: "th" as const })));
  if (!input.balances.length) R.push([{ v: "", s: "tdCenter" }, { v: "Chưa có tài khoản tiền", s: "td" }, { v: "", s: "td" }, { v: 0, s: "tdMoney" }, { v: 0, s: "tdMoney" }, { v: 0, s: "tdMoney" }, { v: 0, s: "tdMoney" }]);
  input.balances.forEach((r, i) =>
    R.push([
      { v: i + 1, s: "tdCenter" },
      { v: r.accountName, s: "td" },
      { v: BALANCE_KIND_VI[r.kind] ?? r.kind, s: "td" },
      { v: r2(r.opening), s: "tdMoney" },
      { v: r2(r.inflow), s: "tdMoney" },
      { v: r2(r.outflow), s: "tdMoney" },
      { v: r2(r.closing), s: "tdMoney" },
    ]),
  );
  const s = auditBalancesSummary(input.balances);
  R.push([{ v: "", s: "tdBold" }, { v: "Tổng cộng", s: "tdBold" }, { v: "", s: "tdBold" }, { v: s.opening, s: "tdMoneyBold" }, { v: s.inflow, s: "tdMoneyBold" }, { v: s.outflow, s: "tdMoneyBold" }, { v: s.closing, s: "tdMoneyBold" }]);
  return { name: "Tien", rows: R, merges, cols: [6, 30, 14, 16, 16, 16, 16], landscape: true, repeatRows: `${head}:${head}` };
}

/** Tên file zip: HoSoKiemTra_<MST>_<kỳ>.zip */
export function auditPackFileName(taxCode: string, period: { from: string; to: string }): string {
  return bookFileName("HoSoKiemTra", taxCode, { from: period.from, to: period.to }, null, "zip");
}
