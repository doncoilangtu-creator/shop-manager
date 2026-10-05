/**
 * Đóng gói hồ sơ kiểm tra thành 1 file zip (server-side): các file theo thư mục + README.txt + manifest.json + SHA256SUMS.txt.
 * Tất định: ngày trong zip cố định, thứ tự file cố định; generatedAt chỉ xuất hiện bên trong manifest/README.
 */
import "server-only";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { auditBalancesSummary, auditPurchasesSummary, auditSalesSummary, type AuditPackInput } from "@/lib/books/audit-pack";

export const AUDIT_PACK_VERSION = 1;

/** Thư mục chuẩn trong zip. */
export const AUDIT_FOLDERS = {
  s1a: "01-so-S1a",
  tax: "02-to-khai",
  sales: "03-ban-hang-hoa-don",
  purchases: "04-mua-hang",
  cash: "05-tien",
} as const;
export type AuditSection = keyof typeof AUDIT_FOLDERS;

export const AUDIT_FOLDER_VI: Record<AuditSection, string> = {
  s1a: "Sổ doanh thu S1a-HKD",
  tax: "Tờ khai 01/TKN-CNKD, bảng kê 01/BK-STK",
  sales: "Bảng kê bán hàng và hóa đơn điện tử",
  purchases: "Bảng kê mua hàng",
  cash: "Tổng hợp tiền mặt, tiền gửi",
};

export type PackFile = {
  /** Đường dẫn trong zip, phải nằm trong một thư mục của AUDIT_FOLDERS (dùng packPath để tạo). */
  path: string;
  bytes: Uint8Array;
  rows?: number;
  note?: string;
};

export const packPath = (section: AuditSection, name: string) => `${AUDIT_FOLDERS[section]}/${name}`;

export const BK_STK_SKIPPED_NOTE = "BK-STK bị bỏ qua vì người xuất không phải chủ hộ";
export const RESERVED_FILES = ["README.txt", "manifest.json", "SHA256SUMS.txt"] as const;

const FIXED_DATE = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
const FOLDER_SET = new Set<string>(Object.values(AUDIT_FOLDERS));

export const sha256Hex = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

export type ManifestFile = { path: string; bytes: number; sha256: string; rows: number | null; note?: string };
export type AuditManifest = {
  app: "shop-manager";
  kind: "audit_pack";
  version: number;
  period: AuditPackInput["period"];
  generatedAt: string;
  generatedBy: string;
  generatedByOwner: boolean;
  business: AuditPackInput["header"];
  files: ManifestFile[];
  summary: {
    sales: ReturnType<typeof auditSalesSummary>;
    purchases: ReturnType<typeof auditPurchasesSummary>;
    balances: ReturnType<typeof auditBalancesSummary>;
  };
  checks: {
    s1a_vs_gl: { s1a_total: number; gl_total: number; diff: number; ok: boolean };
    sales_missing_einvoice: { count: number; total: number; ok: boolean };
    ok: boolean;
  };
  notes: string[];
};

function sortFiles(files: PackFile[]): PackFile[] {
  return [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function validate(files: PackFile[]) {
  const seen = new Set<string>();
  for (const f of files) {
    const [dir, ...rest] = f.path.split("/");
    if (!FOLDER_SET.has(dir) || !rest.length || rest.some((p) => !p || p === "." || p === "..")) {
      throw new Error(`audit pack: đường dẫn không hợp lệ "${f.path}" (phải nằm trong ${[...FOLDER_SET].join(", ")})`);
    }
    if (seen.has(f.path)) throw new Error(`audit pack: trùng file "${f.path}"`);
    seen.add(f.path);
  }
}

export function buildManifest(input: AuditPackInput, files: PackFile[]): AuditManifest {
  validate(files);
  const sales = auditSalesSummary(input.sales);
  const diff = Math.round((Number(input.s1aCheck.diff) || 0) * 100) / 100;
  const s1aOk = diff === 0;
  const notes: string[] = [];
  if (!input.isOwner) notes.push(BK_STK_SKIPPED_NOTE);
  if (!s1aOk) notes.push(`Sổ S1a lệch sổ cái ${diff} đồng — cần rà soát trước khi nộp`);
  if (sales.missingCount) notes.push(`${sales.missingCount} chứng từ bán hàng chưa xuất hóa đơn điện tử`);
  for (const f of sortFiles(files)) if (f.note) notes.push(`${f.path}: ${f.note}`);
  return {
    app: "shop-manager",
    kind: "audit_pack",
    version: AUDIT_PACK_VERSION,
    period: input.period,
    generatedAt: input.generatedAt,
    generatedBy: input.generatedBy,
    generatedByOwner: input.isOwner,
    business: input.header,
    files: sortFiles(files).map((f) => ({
      path: f.path,
      bytes: f.bytes.byteLength,
      sha256: sha256Hex(f.bytes),
      rows: f.rows ?? null,
      ...(f.note ? { note: f.note } : {}),
    })),
    summary: { sales, purchases: auditPurchasesSummary(input.purchases), balances: auditBalancesSummary(input.balances) },
    checks: {
      s1a_vs_gl: { s1a_total: input.s1aCheck.s1aTotal, gl_total: input.s1aCheck.glTotal, diff, ok: s1aOk },
      sales_missing_einvoice: { count: sales.missingCount, total: sales.missingTotal, ok: sales.missingCount === 0 },
      ok: s1aOk,
    },
    notes,
  };
}

const money = (n: number) => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(n);

export function buildReadme(m: AuditManifest): string {
  const L: string[] = [];
  L.push("HỒ SƠ KIỂM TRA — HỘ KINH DOANH");
  L.push("=".repeat(40));
  L.push(`Hộ kinh doanh: ${m.business.businessName}`);
  L.push(`Mã số thuế: ${m.business.taxCode || "(chưa có)"}`);
  L.push(`Địa chỉ: ${m.business.address || "(chưa có)"}`);
  if (m.business.ownerName) L.push(`Chủ hộ: ${m.business.ownerName}`);
  if (m.business.industry) L.push(`Ngành nghề: ${m.business.industry}`);
  L.push(`Kỳ: ${m.period.label} (${m.period.from} đến ${m.period.to})`);
  L.push(`Thời điểm lập: ${m.generatedAt}`);
  L.push(`Người lập: ${m.generatedBy}${m.generatedByOwner ? " (chủ hộ)" : ""}`);
  L.push("");
  L.push("DANH SÁCH FILE");
  L.push("-".repeat(40));
  for (const [sec, dir] of Object.entries(AUDIT_FOLDERS) as Array<[AuditSection, string]>) {
    const fs = m.files.filter((f) => f.path.startsWith(`${dir}/`));
    if (!fs.length) continue;
    L.push(`${dir}/ — ${AUDIT_FOLDER_VI[sec]}`);
    for (const f of fs) L.push(`  - ${f.path} (${f.bytes} byte${f.rows != null ? `, ${f.rows} dòng` : ""})`);
  }
  L.push("  - README.txt (file này)");
  L.push("  - manifest.json (thông tin máy đọc được: kỳ, file, mã băm, kết quả đối chiếu)");
  L.push("  - SHA256SUMS.txt (mã băm SHA-256 của từng file, kiểm tra bằng: sha256sum -c SHA256SUMS.txt)");
  L.push("");
  L.push("ĐỐI CHIẾU");
  L.push("-".repeat(40));
  const c = m.checks.s1a_vs_gl;
  L.push(`Sổ S1a so với sổ cái: S1a ${money(c.s1a_total)} đ, sổ cái ${money(c.gl_total)} đ, chênh lệch ${money(c.diff)} đ — ${c.ok ? "KHỚP" : "LỆCH"}`);
  const e = m.checks.sales_missing_einvoice;
  L.push(`Chứng từ bán hàng chưa xuất hóa đơn: ${e.count}${e.count ? ` (${money(e.total)} đ)` : ""}`);
  L.push(`Bán hàng: ${m.summary.sales.count} chứng từ, ${money(m.summary.sales.total)} đ`);
  L.push(`Mua hàng: ${m.summary.purchases.count} chứng từ, ${money(m.summary.purchases.total)} đ, còn nợ ${money(m.summary.purchases.unpaid)} đ`);
  L.push(`Tiền cuối kỳ: ${money(m.summary.balances.closing)} đ`);
  L.push(`Kết luận: ${m.checks.ok ? "ĐẠT" : "CẦN RÀ SOÁT"}`);
  if (m.notes.length) {
    L.push("");
    L.push("GHI CHÚ");
    L.push("-".repeat(40));
    for (const n of m.notes) L.push(`- ${n}`);
  }
  L.push("");
  L.push("Tạo bởi shop-manager.");
  return L.join("\n") + "\n";
}

/** Định dạng sha256sum: "<hex>  <path>" mỗi dòng, sắp theo path. */
export function buildSha256Sums(files: PackFile[]): string {
  return sortFiles(files).map((f) => `${sha256Hex(f.bytes)}  ${f.path}`).join("\n") + "\n";
}

export async function assembleAuditZip(input: AuditPackInput, files: PackFile[]): Promise<{ bytes: Uint8Array; sha256: string; manifest: AuditManifest }> {
  const manifest = buildManifest(input, files);
  const enc = new TextEncoder();
  const readme = enc.encode(buildReadme(manifest));
  const manifestBytes = enc.encode(JSON.stringify(manifest, null, 2) + "\n");
  // SHA256SUMS phủ cả README và manifest để kiểm tra toàn vẹn cả gói
  const all: PackFile[] = [...files, { path: "README.txt", bytes: readme }, { path: "manifest.json", bytes: manifestBytes }];
  const sums = enc.encode(buildSha256Sums(all));
  const zip = new JSZip();
  const opt = { date: FIXED_DATE, createFolders: false, binary: true };
  zip.file("README.txt", readme, opt);
  zip.file("manifest.json", manifestBytes, opt);
  zip.file("SHA256SUMS.txt", sums, opt);
  for (const f of sortFiles(files)) zip.file(f.path, f.bytes, opt);
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 }, platform: "DOS" });
  return { bytes, sha256: sha256Hex(bytes), manifest };
}
