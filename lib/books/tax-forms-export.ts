import "server-only";
import React from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildXlsx } from "@/lib/xlsx/writer";
import { loadBookHeader } from "@/lib/books/server";
import { CONTENT_TYPE, renderPdf, type BuiltFile } from "@/lib/books/s1a-export";
import { BkStkPdfDocument, TknPdfDocument } from "@/lib/books/tax-forms-pdf";
import {
  BK_STK_TEMPLATE_VERSION, TKN_TEMPLATE_VERSION, bkStkFileName, bkStkSheet, parseBkStkRows, parseTknRows, tknFileName, tknMap, tknPeriod, tknSheet,
  type BkStkRow, type TknPeriodKind, type TknRow,
} from "@/lib/books/tax-forms";

export async function loadTkn(sb: SupabaseClient, year: number, kind: TknPeriodKind): Promise<TknRow[]> {
  const { data, error } = await sb.rpc("tkn_cnkd_data", { p_year: year, p_half: tknPeriod(year, kind).half });
  if (error) throw new Error("tkn_cnkd_data: " + error.message);
  return parseTknRows(data);
}

export async function loadBkStk(sb: SupabaseClient, scope: "pending" | "all"): Promise<BkStkRow[]> {
  const { data, error } = await sb.rpc("bk_stk_data", { p_scope: scope });
  if (error) throw new Error("bk_stk_data: " + error.message);
  return parseBkStkRows(data);
}

/** Người nộp thuế ký tờ khai = chủ hộ (không phải người ghi sổ). */
async function taxpayerHeader(sb: SupabaseClient) {
  const { header } = await loadBookHeader(sb, null);
  const { data } = await sb.rpc("get_business_profile");
  const owner = ((data as { profile?: Record<string, string | null> } | null)?.profile ?? {}).owner_name;
  return { ...header, signer: owner ?? header.signer };
}

export async function buildTknFile(sb: SupabaseClient, year: number, kind: TknPeriodKind, format: "xlsx" | "pdf"): Promise<BuiltFile> {
  const [header, rows] = await Promise.all([taxpayerHeader(sb), loadTkn(sb, year, kind)]);
  const bytes = format === "xlsx"
    ? await buildXlsx([tknSheet(header, year, kind, rows)], { title: "Thông báo doanh thu năm (01/TKN-CNKD)", creator: header.businessName })
    : await renderPdf(React.createElement(TknPdfDocument, { header, year, kind, rows }));
  return { bytes, fileName: tknFileName(header, year, kind, format), contentType: CONTENT_TYPE[format], rowCount: rows.length, total: tknMap(rows).get("11") ?? 0, templateVersion: TKN_TEMPLATE_VERSION };
}

export async function buildBkStkFile(sb: SupabaseClient, scope: "pending" | "all", format: "xlsx" | "pdf"): Promise<BuiltFile & { header: { createdOn: string } }> {
  const [header, rows] = await Promise.all([taxpayerHeader(sb), loadBkStk(sb, scope)]);
  const bytes = format === "xlsx"
    ? await buildXlsx([bkStkSheet(header, rows)], { title: "Bảng kê tài khoản (01/BK-STK)", creator: header.businessName })
    : await renderPdf(React.createElement(BkStkPdfDocument, { header, rows }));
  return { bytes, fileName: bkStkFileName(header, format), contentType: CONTENT_TYPE[format], rowCount: rows.length, total: null, templateVersion: BK_STK_TEMPLATE_VERSION, header };
}
