import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import {
  AUDIT_PACK_PERIODS,
  BALANCES_HEADERS,
  PURCHASES_HEADERS,
  SALES_EINVOICE_HEADERS,
  auditPackFileName,
  balancesSheet,
  purchasesSheet,
  salesEinvoiceSheet,
  type AuditPackInput,
} from "@/lib/books/audit-pack";
import {
  BK_STK_SKIPPED_NOTE,
  assembleAuditZip,
  buildManifest,
  buildReadme,
  buildSha256Sums,
  packPath,
  type PackFile,
} from "@/lib/books/audit-pack-zip";
import type { XlsxCell, XlsxSheet } from "@/lib/xlsx/writer";

const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
const cv = (c: XlsxCell) => (c && typeof c === "object" ? c.v : c);
const texts = (sh: XlsxSheet) => sh.rows.map((r) => r.map(cv));
const findRow = (sh: XlsxSheet, label: string) => texts(sh).find((r) => r.includes(label));

function input(over: Partial<AuditPackInput> = {}): AuditPackInput {
  return {
    header: { businessName: "Tạp hóa Minh An", address: "12 Lê Lợi, Q1", taxCode: "8012345678", ownerName: "Nguyễn Văn A", industry: "Bán lẻ" },
    period: { kind: "h1", year: 2026, from: "2026-01-01", to: "2026-06-30", label: "6 tháng đầu năm 2026" },
    generatedAt: "2026-10-05T04:34:00.000Z",
    generatedBy: "owner@example.com",
    isOwner: true,
    sales: [
      { date: "2026-01-05", docNo: "BH001", customer: "Khách lẻ", total: 100000, einvoiceNo: "0000001", einvoiceSerial: "1C26TAA", einvoiceStatus: "issued" },
      { date: "2026-02-10", docNo: "BH002", customer: "Cty X", total: 250000.5, einvoiceNo: null, einvoiceSerial: null, einvoiceStatus: "missing" },
      { date: "2026-03-01", docNo: "BH003", customer: "", total: 50000, einvoiceNo: null, einvoiceSerial: null, einvoiceStatus: "missing" },
      { date: "2026-03-02", docNo: "BH004", customer: "Cty Y", total: 70000, einvoiceNo: "0000002", einvoiceSerial: "1C26TAA", einvoiceStatus: "cancelled" },
    ],
    purchases: [
      { date: "2026-01-03", docNo: "MH001", supplier: "NCC 1", supplierInvoiceNo: "123", total: 300000, paid: 300000 },
      { date: "2026-04-03", docNo: "MH002", supplier: "NCC 2", supplierInvoiceNo: null, total: 120000, paid: 20000 },
    ],
    balances: [
      { accountName: "Quỹ tiền mặt", kind: "cash", opening: 1000000, inflow: 400000, outflow: 320000, closing: 1080000 },
      { accountName: "VCB", kind: "bank", opening: 5000000, inflow: 0, outflow: 100000, closing: 4900000 },
    ],
    s1aCheck: { s1aTotal: 470000.5, glTotal: 470000.5, diff: 0 },
    ...over,
  };
}

const enc = new TextEncoder();
function files(): PackFile[] {
  return [
    { path: packPath("s1a", "S1a-HKD.xlsx"), bytes: enc.encode("s1a-bytes"), rows: 4 },
    { path: packPath("tax", "01-TKN-CNKD.xlsx"), bytes: enc.encode("tkn-bytes"), rows: 12 },
    { path: packPath("sales", "BanHang-HDDT.xlsx"), bytes: enc.encode("sales-bytes"), rows: 4 },
    { path: packPath("purchases", "MuaHang.xlsx"), bytes: enc.encode("purchases-bytes"), rows: 2 },
    { path: packPath("cash", "Tien.xlsx"), bytes: enc.encode("cash-bytes"), rows: 2 },
  ];
}

describe("audit pack sheets", () => {
  it("periods reuse TKN kinds and file name uses HoSoKiemTra zip", () => {
    expect(AUDIT_PACK_PERIODS.map((k) => k.value)).toEqual(["year", "h1", "h2"]);
    const n = auditPackFileName("8012345678", { from: "2026-01-01", to: "2026-06-30" });
    expect(n.startsWith("HoSoKiemTra_8012345678_")).toBe(true);
    expect(n.endsWith(".zip")).toBe(true);
  });

  it("sales/einvoice sheet: headers, totals, missing count", () => {
    const sh = salesEinvoiceSheet(input());
    expect(texts(sh).some((r) => JSON.stringify(r) === JSON.stringify(SALES_EINVOICE_HEADERS))).toBe(true);
    const total = findRow(sh, "Tổng cộng")!;
    expect(total[4]).toBe(470000.5);
    expect(total[7]).toBe("4 chứng từ");
    const missing = texts(sh).find((r) => String(r[0]).startsWith("Số chứng từ chưa xuất hóa đơn"))!;
    expect(missing[0]).toBe("Số chứng từ chưa xuất hóa đơn: 2");
    expect(missing[4]).toBe(300000.5);
    expect(texts(sh).filter((r) => r[7] === "Chưa xuất HĐ")).toHaveLength(2);
    expect(findRow(sh, "Đã hủy")).toBeTruthy();
    expect(findRow(sh, "Khách lẻ")).toBeTruthy();
  });

  it("purchases sheet: headers, totals and unpaid", () => {
    const sh = purchasesSheet(input());
    expect(texts(sh).some((r) => JSON.stringify(r) === JSON.stringify(PURCHASES_HEADERS))).toBe(true);
    const total = findRow(sh, "Tổng cộng")!;
    expect(total.slice(4)).toEqual(["2 chứng từ", 420000, 320000, 100000]);
    expect(findRow(sh, "Số chứng từ không có hóa đơn đầu vào: 1")).toBeTruthy();
  });

  it("balances sheet: headers and totals", () => {
    const sh = balancesSheet(input());
    expect(texts(sh).some((r) => JSON.stringify(r) === JSON.stringify(BALANCES_HEADERS))).toBe(true);
    expect(findRow(sh, "Tổng cộng")!.slice(3)).toEqual([6000000, 400000, 420000, 5980000]);
    expect(findRow(sh, "Ngân hàng")).toBeTruthy();
  });

  it("empty input still renders a placeholder row and zero totals", () => {
    const i = input({ sales: [], purchases: [], balances: [] });
    expect(findRow(salesEinvoiceSheet(i), "Không phát sinh bán hàng trong kỳ")).toBeTruthy();
    expect(findRow(salesEinvoiceSheet(i), "Tổng cộng")![4]).toBe(0);
    expect(findRow(purchasesSheet(i), "Không phát sinh mua hàng trong kỳ")).toBeTruthy();
    expect(findRow(balancesSheet(i), "Chưa có tài khoản tiền")).toBeTruthy();
  });
});

describe("audit pack manifest / README / zip", () => {
  it("manifest hashes match sha256 of bytes; checks ok when diff=0", () => {
    const fs = files();
    const m = buildManifest(input(), fs);
    expect(m.app).toBe("shop-manager");
    expect(m.kind).toBe("audit_pack");
    expect(m.files).toHaveLength(fs.length);
    for (const f of fs) {
      const mf = m.files.find((x) => x.path === f.path)!;
      expect(mf.sha256).toBe(sha(f.bytes));
      expect(mf.bytes).toBe(f.bytes.byteLength);
      expect(mf.rows).toBe(f.rows);
    }
    expect(m.checks.s1a_vs_gl.ok).toBe(true);
    expect(m.checks.ok).toBe(true);
    expect(m.checks.sales_missing_einvoice.count).toBe(2);
    expect(m.notes).not.toContain(BK_STK_SKIPPED_NOTE);
  });

  it("diff != 0 makes checks fail", () => {
    const m = buildManifest(input({ s1aCheck: { s1aTotal: 100, glTotal: 90, diff: 10 } }), files());
    expect(m.checks.s1a_vs_gl.ok).toBe(false);
    expect(m.checks.ok).toBe(false);
    expect(buildReadme(m)).toContain("LỆCH");
  });

  it("non-owner adds BK-STK skip note", () => {
    const m = buildManifest(input({ isOwner: false }), files());
    expect(m.notes).toContain(BK_STK_SKIPPED_NOTE);
    expect(buildReadme(m)).toContain(BK_STK_SKIPPED_NOTE);
  });

  it("README mentions every file", () => {
    const fs = files();
    const r = buildReadme(buildManifest(input(), fs));
    for (const f of fs) expect(r).toContain(f.path);
    for (const n of ["README.txt", "manifest.json", "SHA256SUMS.txt"]) expect(r).toContain(n);
    expect(r).toContain("KHỚP");
    expect(r).toContain("Tạp hóa Minh An");
  });

  it("SHA256SUMS has one line per file in sha256sum format", () => {
    const fs = files();
    const lines = buildSha256Sums(fs).trim().split("\n");
    expect(lines).toHaveLength(fs.length);
    for (const f of fs) expect(lines).toContain(`${sha(f.bytes)}  ${f.path}`);
  });

  it("rejects paths outside the standard folders and duplicates", () => {
    expect(() => buildManifest(input(), [{ path: "evil.txt", bytes: enc.encode("x") }])).toThrow();
    expect(() => buildManifest(input(), [{ path: "01-so-S1a/../x", bytes: enc.encode("x") }])).toThrow();
    const f = files()[0];
    expect(() => buildManifest(input(), [f, f])).toThrow();
  });

  it("zip contains expected paths, sums verify, deterministic", async () => {
    const fs = files();
    const a = await assembleAuditZip(input(), fs);
    const b = await assembleAuditZip(input(), files());
    expect(a.sha256).toBe(sha(a.bytes));
    expect(b.sha256).toBe(a.sha256);
    const z = await JSZip.loadAsync(a.bytes);
    const names = Object.keys(z.files).filter((n) => !z.files[n].dir).sort();
    expect(names).toEqual([...fs.map((f) => f.path), "README.txt", "SHA256SUMS.txt", "manifest.json"].sort());
    for (const d of ["01-so-S1a/", "02-to-khai/", "03-ban-hang-hoa-don/", "04-mua-hang/", "05-tien/"]) expect(names.some((n) => n.startsWith(d))).toBe(true);
    const manifest = JSON.parse(await z.file("manifest.json")!.async("string"));
    expect(manifest.generatedAt).toBe("2026-10-05T04:34:00.000Z");
    const sums = (await z.file("SHA256SUMS.txt")!.async("string")).trim().split("\n");
    for (const line of sums) {
      const [h, p] = line.split("  ");
      expect(sha(await z.file(p)!.async("uint8array"))).toBe(h);
    }
    expect(sums.some((l) => l.endsWith("  manifest.json"))).toBe(true);
    // generatedAt khác → zip khác (chỉ nằm trong manifest/README), cùng input → giống hệt
    const c = await assembleAuditZip(input({ generatedAt: "2026-10-06T00:00:00.000Z" }), files());
    expect(c.sha256).not.toBe(a.sha256);
  });
});
