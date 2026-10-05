import { describe, expect, it } from "vitest";
import React from "react";
import JSZip from "jszip";
import { monthsIn, parsePeriodParam, periodLabel, periodRange, periodSlug, signDateText, validatePeriod, vnDateText } from "@/lib/books/period";
import { bookFileName, parseS1aRows, s1aByGroup, s1aGroupSheet, s1aSheet, s1aTotal, type BookHeader, type S1aRow } from "@/lib/books/s1a";
import { buildXlsx, colName, safeSheetName, sheetXml } from "@/lib/xlsx/writer";

const H: BookHeader = { businessName: "HKD Máy tính ABC", address: "1 Lê Lợi, Q1", taxCode: "0123456789", locationLabel: "Trụ sở — 1 Lê Lợi", signer: "Bùi Sĩ Hoàng", createdOn: "2026-10-05" };
const rows: S1aRow[] = parseS1aRows([
  { line_date: "2026-05-10", doc_no: "INV-1", description: "Bán hàng HĐ C26TAA-0000777 (đơn INV-1) — khách lẻ", amount: "2000000", tax_group: "goods", location_id: null, doc_type: "sale", doc_id: "a" },
  { line_date: "2026-05-10", doc_no: "INV-1", description: "… — Dịch vụ", amount: 500000, tax_group: "service", location_id: null, doc_type: "sale", doc_id: "a" },
  { line_date: "2026-05-20", doc_no: "RT-1", description: "Hàng bán bị trả lại & <giảm giá>", amount: -100000, tax_group: "goods", location_id: null, doc_type: "return", doc_id: "b" },
]);

describe("period helpers", () => {
  it("tháng / quý / 6 tháng / năm", () => {
    expect(periodRange("month", 2026, 2)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodRange("month", 2028, 2).to).toBe("2028-02-29");
    expect(periodRange("quarter", 2026, 4)).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(periodRange("half", 2026, 1)).toEqual({ from: "2026-01-01", to: "2026-06-30" });
    expect(periodRange("year", 2026)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(() => periodRange("month", 2026, 13)).toThrow();
  });
  it("nhãn kỳ kê khai và đoạn tên file", () => {
    expect(periodLabel(periodRange("month", 2026, 5))).toBe("Tháng 05/2026");
    expect(periodLabel(periodRange("quarter", 2026, 2))).toBe("Quý II/2026");
    expect(periodLabel(periodRange("half", 2026, 2))).toBe("6 tháng cuối năm 2026");
    expect(periodLabel(periodRange("year", 2026))).toBe("Năm 2026");
    expect(periodLabel({ from: "2026-05-01", to: "2026-05-15" })).toBe("Từ 01/05/2026 đến 15/05/2026");
    expect(periodSlug(periodRange("quarter", 2026, 4))).toBe("2026-Q4");
    expect(periodSlug(periodRange("month", 2026, 5))).toBe("2026-05");
    expect(periodSlug({ from: "2026-05-01", to: "2026-05-15" })).toBe("20260501-20260515");
  });
  it("tham số kỳ trên URL, mặc định tháng hiện tại, chặn kỳ sai", () => {
    expect(parsePeriodParam(undefined, "2026-10-05").period).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(parsePeriodParam("q-2026-3", "2026-10-05").period.from).toBe("2026-07-01");
    expect(parsePeriodParam("m-2026-13", "2026-10-05").key).toBe("m-2026-10");
    expect(parsePeriodParam("c", "2026-10-05", { from: "2026-05-03", to: "2026-05-09" }).period).toEqual({ from: "2026-05-03", to: "2026-05-09" });
    expect(parsePeriodParam("c", "2026-10-05", { from: "2026-05-09", to: "2026-05-03" }).key).toBe("m-2026-10");
    expect(validatePeriod({ from: "2026-02-30", to: "2026-03-01" })).toBe("Ngày không hợp lệ");
    expect(validatePeriod({ from: "2020-01-01", to: "2026-03-01" })).toBe("Kỳ tối đa 5 năm");
  });
  it("ngày lập, ngày VN, tháng trong kỳ", () => {
    expect(signDateText("2026-10-05")).toBe("Ngày 05 tháng 10 năm 2026");
    expect(vnDateText("2026-05-10")).toBe("10/05/2026");
    expect(monthsIn({ from: "2026-11-15", to: "2027-02-01" }).map((m) => `${m.year}-${m.month}`)).toEqual(["2026-11", "2026-12", "2027-1", "2027-2"]);
  });
});

describe("S1a layout", () => {
  it("tổng, theo nhóm ngành, tên file an toàn", () => {
    expect(s1aTotal(rows)).toBe(2400000);
    expect(s1aByGroup(rows, (c) => c.toUpperCase())).toEqual([{ code: "goods", name: "GOODS", amount: 1900000 }, { code: "service", name: "SERVICE", amount: 500000 }]);
    expect(bookFileName("S1a-HKD", "0123456789", periodRange("month", 2026, 5), "Chi nhánh Đà Nẵng", "xlsx")).toBe("S1a-HKD_0123456789_2026-05_Chi-nhanh-Da-Nang.xlsx");
    expect(bookFileName("S1a-HKD", "", periodRange("year", 2026), null, "pdf")).toBe("S1a-HKD_chua-co-MST_2026.pdf");
  });
  it("sheet đúng mẫu TT152: tiêu đề, cột A/B/1, Tổng cộng, khối ký", () => {
    const sh = s1aSheet(H, periodRange("month", 2026, 5), rows);
    const flat = sh.rows.map((r) => r.map((c) => (c && typeof c === "object" ? c.v : c)));
    const texts = flat.flat().filter((v) => typeof v === "string") as string[];
    expect(texts).toContain("HỘ, CÁ NHÂN KINH DOANH: HKD Máy tính ABC");
    expect(texts).toContain("Mẫu số S1a-HKD");
    expect(texts).toContain("(Kèm theo Thông tư số 152/2025/TT-BTC");
    expect(texts).toContain("SỔ DOANH THU BÁN HÀNG HÓA, DỊCH VỤ");
    expect(texts).toContain("Kỳ kê khai: Tháng 05/2026");
    expect(texts).toContain("Mã số thuế: 0123456789");
    expect(texts).toContain("Đơn vị tính: đồng");
    expect(texts).toContain("Ngày 05 tháng 10 năm 2026");
    expect(texts).toContain("(Ký, ghi rõ họ tên, đóng dấu (nếu có))");
    const hi = flat.findIndex((r) => r[0] === "Ngày tháng");
    expect(flat[hi]).toEqual(["Ngày tháng", "Diễn giải", "Số tiền"]);
    expect(flat[hi + 1]).toEqual(["A", "B", "1"]);
    expect(flat[hi + 2]).toEqual(["10/05/2026", rows[0].description, 2000000]);
    const ti = flat.findIndex((r) => r[1] === "Tổng cộng");
    expect(flat[ti][2]).toBe(2400000);
    expect(ti).toBe(hi + 2 + rows.length);
    expect(sh.repeatRows).toBe(`${hi + 1}:${hi + 2}`);
  });
  it("kỳ không phát sinh vẫn có dòng ghi chú và Tổng cộng 0", () => {
    const sh = s1aSheet(H, periodRange("month", 2026, 1), []);
    const flat = sh.rows.map((r) => r.map((c) => (c && typeof c === "object" ? c.v : c)));
    expect(flat.some((r) => r[1] === "Không phát sinh doanh thu trong kỳ")).toBe(true);
    expect(flat.find((r) => r[1] === "Tổng cộng")?.[2]).toBe(0);
  });
});

describe("xlsx writer", () => {
  it("tên cột và tên sheet", () => {
    expect([colName(0), colName(25), colName(26), colName(701), colName(702)]).toEqual(["A", "Z", "AA", "ZZ", "AAA"]);
    expect(safeSheetName("a/b:c*?[x]")).toBe("a b c   x");
    expect(safeSheetName("x".repeat(40)).length).toBe(31);
  });
  it("escape XML, số là số, ô trống bỏ qua", () => {
    const xml = sheetXml({ name: "t", rows: [["<a&b>", 12.5, null, { v: "", s: "td" }]] });
    expect(xml).toContain("&lt;a&amp;b&gt;");
    expect(xml).toContain('<c r="B1"><v>12.5</v></c>');
    expect(xml).not.toContain('r="C1"');
    expect(xml).toContain('<c r="D1" s="6"/>');
  });
  it("file mở được, đủ phần OOXML, nội dung tiếng Việt, xác định (cùng dữ liệu → cùng bytes)", async () => {
    const sheets = [s1aSheet(H, periodRange("month", 2026, 5), rows), s1aGroupSheet(H, periodRange("month", 2026, 5), rows, (c) => c)];
    const a = await buildXlsx(sheets, { title: "S1a" });
    const b = await buildXlsx(sheets, { title: "S1a" });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const zip = await JSZip.loadAsync(a);
    for (const f of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]) expect(zip.file(f), f).not.toBeNull();
    const s1 = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    expect(s1).toContain("SỔ DOANH THU BÁN HÀNG HÓA, DỊCH VỤ");
    expect(s1).toContain("&lt;giảm giá&gt;");
    expect(s1).toContain('<mergeCell ref="A6:C6"/>');
    expect(s1).toContain('paperSize="9"');
    const wb = await zip.file("xl/workbook.xml")!.async("string");
    expect(wb).toContain('name="S1a-HKD"');
    expect(wb).toContain("_xlnm.Print_Titles");
  });
});

describe("S1a PDF", () => {
  it("render được PDF có font tiếng Việt nhúng", async () => {
    const { registerBookFonts } = await import("@/lib/books/pdf-fonts");
    const { S1aPdfDocument } = await import("@/lib/books/s1a-pdf");
    const { renderToBuffer } = await import("@react-pdf/renderer");
    registerBookFonts();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buf = await renderToBuffer(React.createElement(S1aPdfDocument, { header: H, period: periodRange("month", 2026, 5), rows }) as any);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.toString("latin1")).toContain("LiberationSerif");
  }, 30000);
});
