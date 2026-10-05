import { describe, expect, it } from "vitest";
import React from "react";
import JSZip from "jszip";
import { buildXlsx } from "@/lib/xlsx/writer";
import type { BookHeader } from "@/lib/books/s1a";
import {
  bkStkFileName, bkStkMissingVi, bkStkSheet, bkStkSummary, daysUntil, defaultTknYear, isBkPending, parseBkStkRows, parseTknKind, parseTknRows,
  parseTknYear, tknDeadline, tknDeadlineInfo, tknFileName, tknMap, tknPeriod, tknSheet, tknThresholdNote, TKN_INDICATORS,
} from "@/lib/books/tax-forms";
import { BOOKS_NAV } from "@/lib/books/nav";
import { moneyAccountInputSchema } from "@/lib/money/schema";

const H: BookHeader = { businessName: "HKD Máy tính ABC", address: "1 Lê Lợi, Q1", taxCode: "0123456789", locationLabel: "Trụ sở", signer: "Bùi Sĩ Hoàng", createdOn: "2026-10-05" };
const tknRaw = [
  { code: "08", revenue: "700000000" }, { code: "08a", revenue: "600000000" }, { code: "08b", revenue: 100000000 },
  { code: "09", revenue: 50000000 }, { code: "09a", revenue: 50000000 }, { code: "10", revenue: 0 }, { code: "11", revenue: "750000000" },
];
const bkRaw = [
  { account_id: "a", kind: "bank", label: "MB chính", provider: "MB Bank", account_no: "0123456789", account_no_masked: "****6789", holder: "Bùi Sĩ Hoàng", location_id: "l", location_name: "Trụ sở", location_code: "001", status: "first", active: true, tax_notified_at: null, missing: [] },
  { account_id: "b", kind: "ewallet", label: "MoMo", provider: null, account_no: null, account_no_masked: null, holder: "Bùi Sĩ Hoàng", location_id: null, location_name: null, location_code: null, status: "changed", active: true, tax_notified_at: "2026-01-10", missing: ["account_no", "provider", "location"] },
  { account_id: "c", kind: "bank", label: "VCB cũ", provider: "Vietcombank", account_no: "9990001234", account_no_masked: "****1234", holder: "Bùi Sĩ Hoàng", location_id: "l", location_name: "Trụ sở", location_code: "001", status: "closed", active: false, tax_notified_at: "2026-01-10", missing: [] },
  { account_id: "d", kind: "bank", label: "ACB", provider: "ACB", account_no: "555566667777", account_no_masked: "****7777", holder: "Bùi Sĩ Hoàng", location_id: "l", location_name: "Trụ sở", location_code: "001", status: "unchanged", active: true, tax_notified_at: "2026-02-01", missing: [] },
];

describe("01/TKN-CNKD", () => {
  it("parse + map chỉ tiêu, số dạng chuỗi", () => {
    const m = tknMap(parseTknRows(tknRaw));
    expect(m.get("11")).toBe(750000000);
    expect(m.get("08a")).toBe(600000000);
    expect(parseTknRows(null)).toEqual([]);
    expect(TKN_INDICATORS.map((i) => i.code)).toContain("09g");
  });
  it("kỳ, hạn nộp, năm mặc định", () => {
    expect(tknPeriod(2026, "year").period).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(tknPeriod(2026, "h1")).toMatchObject({ half: 1, label: "6 tháng đầu năm 2026" });
    expect(tknDeadline(2026, "year")).toBe("2027-01-31");
    expect(tknDeadline(2026, "h1")).toBe("2026-07-31");
    expect(tknDeadline(2026, "h2")).toBe("2027-01-31");
    expect(defaultTknYear("2027-01-15")).toBe(2026);
    expect(defaultTknYear("2026-10-05")).toBe(2026);
    expect(parseTknYear("2030", "2026-10-05")).toBe(2026);
    expect(parseTknYear("2025", "2026-10-05")).toBe(2025);
    expect(parseTknYear("abc", "2027-01-02")).toBe(2026);
    expect(parseTknKind("h2")).toBe("h2");
    expect(parseTknKind("x")).toBe("year");
  });
  it("nhắc hạn: kỳ chưa hết / sắp hạn / quá hạn", () => {
    expect(daysUntil("2027-01-31", "2027-01-01")).toBe(30);
    expect(tknDeadlineInfo(2026, "year", "2026-10-05").tone).toBe("muted");
    expect(tknDeadlineInfo(2026, "year", "2026-10-05").text).toContain("tạm tính");
    expect(tknDeadlineInfo(2026, "year", "2027-01-10")).toMatchObject({ tone: "warning", days: 21 });
    expect(tknDeadlineInfo(2025, "year", "2026-10-05")).toMatchObject({ tone: "danger" });
    expect(tknDeadlineInfo(2026, "h1", "2026-07-05").tone).toBe("warning");
  });
  it("lưu ý ngưỡng 80% / 100% (dùng mức của threshold_status A1)", () => {
    expect(tknThresholdNote("ok", 50)).toBeNull();
    expect(tknThresholdNote("warning", 85)?.tone).toBe("warning");
    expect(tknThresholdNote("warning", 85)?.text).toContain("85%");
    const ex = tknThresholdNote("exceeded", 104.5);
    expect(ex?.tone).toBe("danger");
    expect(ex?.text).toContain("không dùng để nộp");
    expect(tknThresholdNote("none", null)?.tone).toBe("info");
  });
  it("sheet xlsx đúng mẫu và chỉ có cột doanh thu", async () => {
    const sh = tknSheet(H, 2026, "year", parseTknRows(tknRaw));
    const flat = sh.rows.flat().map((c) => (c && typeof c === "object" ? String(c.v) : String(c ?? ""))).join("|");
    expect(flat).toContain("Mẫu số: 01/TKN-CNKD");
    expect(flat).toContain("[01] Kỳ tính thuế: Năm 2026");
    expect(flat).toContain("[05] Mã số thuế: 0123456789");
    expect(flat).toContain("750000000");
    expect(flat).not.toMatch(/Thuế GTGT phải nộp|Số thuế/);
    const bytes = await buildXlsx([sh], { title: "t", creator: "c" });
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files)).toContain("xl/worksheets/sheet1.xml");
    expect(tknFileName(H, 2026, "year", "xlsx")).toMatch(/^01-TKN-CNKD_0123456789_2026\.xlsx$/);
  });
});

describe("01/BK-STK", () => {
  const rows = parseBkStkRows(bkRaw);
  it("parse, trạng thái cần khai, tóm tắt", () => {
    expect(rows.filter(isBkPending).map((r) => r.account_id)).toEqual(["a", "b", "c"]);
    expect(bkStkSummary(rows)).toEqual({ pending: 3, first: 1, changed: 1, closed: 1, missing: 1 });
    expect(bkStkMissingVi(["account_no", "location"])).toBe("số tài khoản, địa điểm KD");
  });
  it("bảng kê có số tài khoản đầy đủ, đánh dấu thiếu số", async () => {
    const sh = bkStkSheet(H, rows.filter(isBkPending));
    const flat = sh.rows.flat().map((c) => (c && typeof c === "object" ? String(c.v) : String(c ?? ""))).join("|");
    expect(flat).toContain("0123456789");
    expect(flat).toContain("(thiếu số)");
    expect(flat).toContain("Khai lần đầu");
    expect(flat).toContain("Đóng");
    expect(flat).not.toContain("555566667777");
    expect(sh.landscape).toBe(true);
    const empty = bkStkSheet(H, []);
    expect(empty.rows.flat().some((c) => c && typeof c === "object" && c.v === "Không có tài khoản cần kê khai")).toBe(true);
    expect(bkStkFileName(H, "pdf")).toMatch(/^01-BK-STK_0123456789_.*\.pdf$/);
  });
  it("form tài khoản nhận địa điểm KD (uuid hoặc trống)", () => {
    expect(moneyAccountInputSchema.safeParse({ kind: "bank", label: "MB", location_id: "" }).success).toBe(true);
    expect(moneyAccountInputSchema.safeParse({ kind: "bank", label: "MB", location_id: "11111111-1111-4111-8111-111111111111" }).success).toBe(true);
    expect(moneyAccountInputSchema.safeParse({ kind: "bank", label: "MB", location_id: "x" }).success).toBe(false);
  });
});

describe("điều hướng Sổ sách", () => {
  it("có trang tờ khai", () => {
    expect(BOOKS_NAV.map((n) => n.href)).toContain("/books/tax-forms");
  });
});

describe("PDF tờ khai", () => {
  it("render 01/TKN-CNKD và 01/BK-STK", async () => {
    const { registerBookFonts } = await import("@/lib/books/pdf-fonts");
    const { TknPdfDocument, BkStkPdfDocument } = await import("@/lib/books/tax-forms-pdf");
    const { renderToBuffer } = await import("@react-pdf/renderer");
    registerBookFonts();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = await renderToBuffer(React.createElement(TknPdfDocument, { header: H, year: 2026, kind: "year", rows: parseTknRows(tknRaw) }) as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = await renderToBuffer(React.createElement(BkStkPdfDocument, { header: H, rows: parseBkStkRows(bkRaw) }) as any);
    expect(a.subarray(0, 5).toString()).toBe("%PDF-");
    expect(b.subarray(0, 5).toString()).toBe("%PDF-");
  }, 30000);
});
