import "server-only";
import React from "react";
import type { DocumentProps } from "@react-pdf/renderer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildXlsx } from "@/lib/xlsx/writer";
import { registerBookFonts } from "@/lib/books/pdf-fonts";
import { loadBookHeader } from "@/lib/books/server";
import { S1aPdfDocument } from "@/lib/books/s1a-pdf";
import { bookFileName, parseS1aRows, s1aGroupSheet, s1aSheet, s1aTotal, S1A_TEMPLATE_VERSION, type S1aMode, type S1aRow } from "@/lib/books/s1a";
import type { Period } from "@/lib/books/period";

export type BuiltFile = { bytes: Uint8Array; fileName: string; contentType: string; rowCount: number; total: number | null; templateVersion: string };
export const CONTENT_TYPE = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  zip: "application/zip",
} as const;

export async function loadS1a(sb: SupabaseClient, p: Period, locationId: string | null, mode: S1aMode): Promise<S1aRow[]> {
  const { data, error } = await sb.rpc("book_s1a", { p_from: p.from, p_to: p.to, p_location_id: locationId, p_mode: mode });
  if (error) throw new Error("book_s1a: " + error.message);
  return parseS1aRows(data);
}

export async function renderPdf(el: React.ReactElement): Promise<Uint8Array> {
  registerBookFonts();
  const { renderToBuffer } = await import("@react-pdf/renderer");
  return new Uint8Array(await renderToBuffer(el as React.ReactElement<DocumentProps>));
}

/** Sinh file sổ S1a (xlsx/pdf) từ dữ liệu RPC `book_s1a` + hồ sơ HKD. */
export async function buildS1aFile(sb: SupabaseClient, p: Period, locationId: string | null, mode: S1aMode, format: "xlsx" | "pdf"): Promise<BuiltFile> {
  const [{ header, location }, rows, groupsRes] = await Promise.all([
    loadBookHeader(sb, locationId),
    loadS1a(sb, p, locationId, mode),
    sb.from("tax_groups").select("code, name_vi"),
  ]);
  if (locationId && !location) throw new Error("location_not_found");
  const gname = new Map(((groupsRes.data ?? []) as Array<{ code: string; name_vi: string }>).map((g) => [g.code, g.name_vi]));
  const fileName = bookFileName("S1a-HKD", header.taxCode, p, location ? location.tax_location_code || location.name : null, format);
  const bytes = format === "xlsx"
    ? await buildXlsx([s1aSheet(header, p, rows), s1aGroupSheet(header, p, rows, (c) => gname.get(c) ?? c)], { title: "Sổ doanh thu bán hàng hóa, dịch vụ (S1a-HKD)", creator: header.businessName })
    : await renderPdf(React.createElement(S1aPdfDocument, { header, period: p, rows }));
  return { bytes, fileName, contentType: CONTENT_TYPE[format], rowCount: rows.length, total: s1aTotal(rows), templateVersion: S1A_TEMPLATE_VERSION };
}
