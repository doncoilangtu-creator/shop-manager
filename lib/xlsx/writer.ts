/**
 * Bộ ghi XLSX tối giản (OOXML + JSZip), không phụ thuộc thư viện Excel lớn.
 * Đủ cho sổ/biểu mẫu: chuỗi (inline), số, một bộ kiểu cố định (đậm, nghiêng, căn giữa, viền, định dạng #,##0), gộp ô, độ rộng cột, khổ A4.
 * Kết quả xác định (deterministic): cùng dữ liệu -> cùng nội dung file (ngày sửa trong zip cố định) để SHA-256 ổn định.
 */
import JSZip from "jszip";

export const XLSX_STYLES = {
  default: 0,
  bold: 1,
  title: 2,
  center: 3,
  italicCenter: 4,
  th: 5,
  td: 6,
  tdMoney: 7,
  tdBold: 8,
  tdMoneyBold: 9,
  tdCenter: 10,
  italicRight: 11,
  boldCenter: 12,
  italic: 13,
  money: 14,
} as const;
export type XlsxStyle = keyof typeof XLSX_STYLES;
export type XlsxCell = string | number | null | undefined | { v: string | number | null; s?: XlsxStyle };
export type XlsxSheet = {
  name: string;
  rows: XlsxCell[][];
  merges?: string[];
  cols?: number[];
  landscape?: boolean;
  /** dòng tiêu đề bảng lặp lại khi in, ví dụ "10:11" */
  repeatRows?: string;
};

const esc = (s: string) =>
  s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function colName(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function cellXml(c: XlsxCell, ref: string): string {
  if (c === null || c === undefined) return "";
  const o = typeof c === "object" ? c : { v: c };
  const s = o.s ? XLSX_STYLES[o.s] : 0;
  const sa = s ? ` s="${s}"` : "";
  if (o.v === null || o.v === undefined || o.v === "") return s ? `<c r="${ref}"${sa}/>` : "";
  if (typeof o.v === "number" && Number.isFinite(o.v)) return `<c r="${ref}"${sa}><v>${o.v}</v></c>`;
  return `<c r="${ref}"${sa} t="inlineStr"><is><t xml:space="preserve">${esc(String(o.v))}</t></is></c>`;
}

export function sheetXml(sh: XlsxSheet): string {
  const cols = sh.cols?.length
    ? `<cols>${sh.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const rows = sh.rows
    .map((r, ri) => {
      const cells = r.map((c, ci) => cellXml(c, `${colName(ci)}${ri + 1}`)).join("");
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join("");
  const merges = sh.merges?.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : "";
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>${cols}<sheetData>${rows}</sheetData>${merges}` +
    `<printOptions horizontalCentered="1"/><pageMargins left="0.6" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>` +
    `<pageSetup paperSize="9" orientation="${sh.landscape ? "landscape" : "portrait"}" fitToWidth="1" fitToHeight="0"/>` +
    `<headerFooter><oddFooter>&amp;CTrang &amp;P/&amp;N</oddFooter></headerFooter></worksheet>`
  );
}

const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0;\\-#,##0;0"/></numFmts>` +
  `<fonts count="5">` +
  `<font><sz val="12"/><name val="Times New Roman"/><family val="1"/></font>` +
  `<font><b/><sz val="12"/><name val="Times New Roman"/><family val="1"/></font>` +
  `<font><b/><sz val="14"/><name val="Times New Roman"/><family val="1"/></font>` +
  `<font><i/><sz val="12"/><name val="Times New Roman"/><family val="1"/></font>` +
  `<font><i/><sz val="11"/><name val="Times New Roman"/><family val="1"/></font>` +
  `</fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>` +
  `<border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="15">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` + // 0 default
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` + // 1 bold
  `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>` + // 2 title
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" wrapText="1"/></xf>` + // 3 center
  `<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" wrapText="1"/></xf>` + // 4 italicCenter
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>` + // 5 th
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` + // 6 td
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>` + // 7 tdMoney
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` + // 8 tdBold
  `<xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>` + // 9 tdMoneyBold
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>` + // 10 tdCenter
  `<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right"/></xf>` + // 11 italicRight
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" wrapText="1"/></xf>` + // 12 boldCenter
  `<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1"/></xf>` + // 13 italic (ghi chú)
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` + // 14 money
  `</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

const FIXED_DATE = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));

export function safeSheetName(n: string): string {
  const s = n.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31);
  return s || "Sheet";
}

/** Tạo file .xlsx (Uint8Array). `title` ghi vào thuộc tính tài liệu. */
export async function buildXlsx(sheets: XlsxSheet[], meta: { title?: string; creator?: string } = {}): Promise<Uint8Array> {
  if (!sheets.length) throw new Error("buildXlsx: cần ít nhất 1 sheet");
  const zip = new JSZip();
  const opt = { date: FIXED_DATE, createFolders: false };
  const names = sheets.map((s) => safeSheetName(s.name));
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
      `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    opt,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    opt,
  );
  zip.file(
    "docProps/core.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">` +
      `<dc:title>${esc(meta.title ?? "")}</dc:title><dc:creator>${esc(meta.creator ?? "Shop Manager")}</dc:creator></cp:coreProperties>`,
    opt,
  );
  const definedNames = sheets
    .map((s, i) => (s.repeatRows ? `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${names[i].replace(/'/g, "''")}'!$${s.repeatRows.split(":")[0]}:$${s.repeatRows.split(":")[1]}</definedName>` : ""))
    .join("");
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>` +
      (definedNames ? `<definedNames>${definedNames}</definedNames>` : "") +
      `</workbook>`,
    opt,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    opt,
  );
  zip.file("xl/styles.xml", STYLES_XML, opt);
  sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s), opt));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
