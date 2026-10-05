/**
 * Tải dữ liệu + dựng file zip hồ sơ kiểm tra (server-only).
 * Tái sử dụng A5 (S1a), A6 (TKN / BK-STK) và sheet lõi của audit-pack.ts.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildXlsx } from "@/lib/xlsx/writer";
import {
  AUDIT_PACK_PERIODS,
  auditPackFileName,
  balancesSheet,
  purchasesSheet,
  salesEinvoiceSheet,
  type AuditBalanceKind,
  type AuditPackInput,
  type AuditPurchaseRow,
  type AuditSaleRow,
  type EinvoiceStatus,
} from "@/lib/books/audit-pack";
import { AUDIT_PACK_MAX_BYTES } from "@/lib/books/audit-pack";
import { AUDIT_PACK_VERSION, assembleAuditZip, packPath, type PackFile } from "@/lib/books/audit-pack-zip";
import { buildS1aFile, CONTENT_TYPE } from "@/lib/books/s1a-export";
import { buildBkStkFile, buildTknFile } from "@/lib/books/tax-forms-export";
import { parseTknKind, parseTknYear, tknPeriod, type TknPeriodKind } from "@/lib/books/tax-forms";
import { vnDate } from "@/lib/time";

export { AUDIT_PACK_PERIODS, AUDIT_PACK_MAX_BYTES };
export const AUDIT_PACK_TEMPLATE = `audit_pack/${AUDIT_PACK_VERSION}`;



type SaleJoin = {
  id: string;
  invoice_no: string;
  invoice_date: string;
  total: number;
  customers: { name: string } | null;
  einvoices: Array<{ number: string; symbol: string | null; status: string; kind: string }> | null;
};
type BillJoin = {
  bill_no: string;
  bill_date: string;
  supplier_ref: string | null;
  total: number;
  suppliers: { name: string } | null;
};
type OpenBill = { bill_no: string; allocated: number; outstanding: number };
type MoneyBal = {
  account_id: string | null;
  kind: string;
  label: string;
  gl_account: string;
  balance: number;
  unassigned: boolean;
  active: boolean;
};
type MoneyMove = { debit: number; credit: number };

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const dayBefore = (iso: string) => {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

function pickEinvoice(list: SaleJoin["einvoices"]): { no: string | null; serial: string | null; status: EinvoiceStatus | string } {
  const rows = list ?? [];
  const issued = rows.find((e) => (e.kind === "original" || e.kind === "replace") && e.status === "issued");
  if (issued) return { no: issued.number, serial: issued.symbol, status: "issued" };
  const cancelled = rows.find((e) => e.status === "cancelled");
  if (cancelled) return { no: cancelled.number, serial: cancelled.symbol, status: "cancelled" };
  const replaced = rows.find((e) => e.status === "replaced");
  if (replaced) return { no: replaced.number, serial: replaced.symbol, status: "replaced" };
  return { no: null, serial: null, status: "missing" };
}

async function loadSales(sb: SupabaseClient, from: string, to: string): Promise<AuditSaleRow[]> {
  const { data, error } = await sb
    .from("sales_invoices")
    .select("id, invoice_no, invoice_date, total, customers(name), einvoices(number, symbol, status, kind)")
    .is("voided_at", null)
    .gte("invoice_date", from)
    .lte("invoice_date", to)
    .order("invoice_date")
    .order("invoice_no");
  if (error) throw new Error("sales_invoices: " + error.message);
  return ((data ?? []) as unknown as SaleJoin[]).map((r) => {
    const e = pickEinvoice(r.einvoices);
    return {
      date: r.invoice_date,
      docNo: r.invoice_no,
      customer: r.customers?.name ?? "",
      total: r2(r.total),
      einvoiceNo: e.no,
      einvoiceSerial: e.serial,
      einvoiceStatus: e.status,
    };
  });
}

async function loadPurchases(sb: SupabaseClient, from: string, to: string): Promise<AuditPurchaseRow[]> {
  const [billsRes, openRes] = await Promise.all([
    sb
      .from("purchase_bills")
      .select("bill_no, bill_date, supplier_ref, total, suppliers(name)")
      .is("voided_at", null)
      .gte("bill_date", from)
      .lte("bill_date", to)
      .order("bill_date")
      .order("bill_no"),
    sb.from("v_purchase_bill_open").select("bill_no, allocated, outstanding"),
  ]);
  if (billsRes.error) throw new Error("purchase_bills: " + billsRes.error.message);
  if (openRes.error) throw new Error("v_purchase_bill_open: " + openRes.error.message);
  const paidByNo = new Map(((openRes.data ?? []) as OpenBill[]).map((o) => [o.bill_no, r2(o.allocated)]));
  return ((billsRes.data ?? []) as unknown as BillJoin[]).map((r) => ({
    date: r.bill_date,
    docNo: r.bill_no,
    supplier: r.suppliers?.name ?? "",
    supplierInvoiceNo: r.supplier_ref,
    total: r2(r.total),
    paid: paidByNo.get(r.bill_no) ?? 0,
  }));
}

async function loadBalances(sb: SupabaseClient, from: string, to: string): Promise<AuditPackInput["balances"]> {
  const openAsOf = dayBefore(from);
  const [openRes, closeRes] = await Promise.all([
    sb.rpc("money_balances", { p_as_of: openAsOf }),
    sb.rpc("money_balances", { p_as_of: to }),
  ]);
  if (openRes.error) throw new Error("money_balances(open): " + openRes.error.message);
  if (closeRes.error) throw new Error("money_balances(close): " + closeRes.error.message);
  const key = (b: MoneyBal) => b.account_id ?? `unassigned:${b.gl_account}`;
  const openMap = new Map(((openRes.data ?? []) as MoneyBal[]).map((b) => [key(b), r2(b.balance)]));
  const accounts = (closeRes.data ?? []) as MoneyBal[];
  const moves = await Promise.all(
    accounts.map(async (a) => {
      const { data, error } = await sb.rpc(
        "money_book",
        a.account_id ? { p_account_id: a.account_id, p_from: from, p_to: to } : { p_account_id: null, p_from: from, p_to: to, p_gl: a.gl_account },
      );
      if (error) throw new Error("money_book: " + error.message);
      const rows = (data ?? []) as MoneyMove[];
      return {
        accountName: a.label,
        kind: (a.kind === "bank" || a.kind === "ewallet" ? a.kind : "cash") as AuditBalanceKind,
        opening: openMap.get(key(a)) ?? 0,
        inflow: r2(rows.reduce((s, r) => s + Number(r.debit || 0), 0)),
        outflow: r2(rows.reduce((s, r) => s + Number(r.credit || 0), 0)),
        closing: r2(a.balance),
      };
    }),
  );
  // Bỏ tài khoản (kể cả dòng “chưa gán”) không có số dư và không phát sinh trong kỳ
  return moves.filter((m) => m.opening || m.inflow || m.outflow || m.closing);
}

export async function loadAuditPackInput(
  sb: SupabaseClient,
  opts: { year: number; kind: TknPeriodKind; generatedBy?: string },
): Promise<AuditPackInput> {
  const { period, label } = tknPeriod(opts.year, opts.kind);
  const [profRes, ownerRes, sales, purchases, balances, checkRes] = await Promise.all([
    sb.rpc("get_business_profile"),
    sb.rpc("is_owner"),
    loadSales(sb, period.from, period.to),
    loadPurchases(sb, period.from, period.to),
    loadBalances(sb, period.from, period.to),
    sb.rpc("book_s1a_check", { p_from: period.from, p_to: period.to }),
  ]);
  if (profRes.error) throw new Error("get_business_profile: " + profRes.error.message);
  if (ownerRes.error) throw new Error("is_owner: " + ownerRes.error.message);
  if (checkRes.error) throw new Error("book_s1a_check: " + checkRes.error.message);
  const prof = ((profRes.data as { profile?: Record<string, string | null> } | null)?.profile ?? {}) as Record<string, string | null>;
  const check = ((checkRes.data as Array<{ s1a_total: number; gl_total: number; diff: number }> | null) ?? [])[0] ?? {
    s1a_total: 0,
    gl_total: 0,
    diff: 0,
  };
  return {
    header: {
      businessName: prof.business_name ?? "(chưa khai báo hồ sơ hộ kinh doanh)",
      address: prof.residence_address ?? "",
      taxCode: prof.tax_code ?? "",
      ownerName: prof.owner_name ?? null,
      industry: prof.industries ?? null,
    },
    period: { kind: opts.kind, year: opts.year, from: period.from, to: period.to, label },
    generatedAt: new Date().toISOString(),
    generatedBy: opts.generatedBy ?? "",
    isOwner: ownerRes.data === true,
    sales,
    purchases,
    balances,
    s1aCheck: { s1aTotal: r2(check.s1a_total), glTotal: r2(check.gl_total), diff: r2(check.diff) },
  };
}

async function xlsxFile(path: string, sheet: Parameters<typeof buildXlsx>[0][0], title: string, creator: string, rows: number): Promise<PackFile> {
  const bytes = await buildXlsx([sheet], { title, creator });
  return { path, bytes, rows };
}

/** Dựng toàn bộ file trong gói (S1a / TKN / BK-STK nếu chủ hộ / 3 bảng đối chiếu) rồi đóng zip. */
export async function buildAuditPackZip(
  sb: SupabaseClient,
  opts: { year: number; kind: TknPeriodKind; generatedBy?: string },
): Promise<{ bytes: Uint8Array; sha256: string; fileName: string; input: AuditPackInput; files: PackFile[]; templateVersion: string }> {
  const input = await loadAuditPackInput(sb, opts);
  const p = { from: input.period.from, to: input.period.to };
  const creator = input.header.businessName;

  const [s1aX, s1aP, tknX, tknP, salesF, purchF, cashF, bk] = await Promise.all([
    buildS1aFile(sb, p, null, "detail", "xlsx"),
    buildS1aFile(sb, p, null, "detail", "pdf"),
    buildTknFile(sb, opts.year, opts.kind, "xlsx"),
    buildTknFile(sb, opts.year, opts.kind, "pdf"),
    xlsxFile(packPath("sales", "BanHang-HDDT.xlsx"), salesEinvoiceSheet(input), "Bán hàng & hóa đơn điện tử", creator, input.sales.length),
    xlsxFile(packPath("purchases", "MuaHang.xlsx"), purchasesSheet(input), "Mua hàng", creator, input.purchases.length),
    xlsxFile(packPath("cash", "Tien.xlsx"), balancesSheet(input), "Tiền mặt / tiền gửi", creator, input.balances.length),
    input.isOwner
      ? Promise.all([buildBkStkFile(sb, "all", "xlsx"), buildBkStkFile(sb, "all", "pdf")]).then(([x, pdf]) => ({ x, pdf }))
      : Promise.resolve(null),
  ]);

  const files: PackFile[] = [
    { path: packPath("s1a", s1aX.fileName), bytes: s1aX.bytes, rows: s1aX.rowCount },
    { path: packPath("s1a", s1aP.fileName), bytes: s1aP.bytes, rows: s1aP.rowCount },
    { path: packPath("tax", tknX.fileName), bytes: tknX.bytes, rows: tknX.rowCount },
    { path: packPath("tax", tknP.fileName), bytes: tknP.bytes, rows: tknP.rowCount },
    salesF,
    purchF,
    cashF,
  ];
  if (bk) {
    files.push(
      { path: packPath("tax", bk.x.fileName), bytes: bk.x.bytes, rows: bk.x.rowCount },
      { path: packPath("tax", bk.pdf.fileName), bytes: bk.pdf.bytes, rows: bk.pdf.rowCount },
    );
  }

  const { bytes, sha256 } = await assembleAuditZip(input, files);
  return {
    bytes,
    sha256,
    fileName: auditPackFileName(input.header.taxCode, p),
    input,
    files,
    templateVersion: AUDIT_PACK_TEMPLATE,
  };
}

export function parseAuditPackArgs(year: unknown, kind: unknown, today = vnDate()) {
  return { year: parseTknYear(year, today), kind: parseTknKind(kind) };
}

export { CONTENT_TYPE };
