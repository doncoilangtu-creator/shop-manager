import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sha256Hex } from "@/lib/books/server";
import type { BuiltFile } from "@/lib/books/s1a-export";

export type ExportMeta = { kind: "s1a" | "tkn_cnkd" | "bk_stk" | "audit_pack"; period_from: string; period_to: string; location_id?: string | null; options?: Record<string, unknown> };

/** Ghi nhật ký xuất (SHA-256) rồi trả file; không ghi được nhật ký thì không trả file. */
export async function sendRecordedFile(sb: SupabaseClient, f: BuiltFile, meta: ExportMeta, format: "xlsx" | "pdf" | "zip"): Promise<NextResponse> {
  const sha = sha256Hex(f.bytes);
  const { error } = await sb.rpc("record_book_export", {
    p: { ...meta, location_id: meta.location_id ?? "", format, file_name: f.fileName, sha256: sha, row_count: f.rowCount, total: f.total, template_version: f.templateVersion, options: meta.options ?? {} },
  });
  if (error) return NextResponse.json({ error: "Không ghi được nhật ký xuất: " + error.message }, { status: 500 });
  return new NextResponse(Buffer.from(f.bytes), {
    status: 200,
    headers: {
      "Content-Type": f.contentType,
      "Content-Disposition": `attachment; filename="${f.fileName}"`,
      "X-Content-SHA256": sha,
      "Cache-Control": "no-store",
    },
  });
}

export function exportError(tag: string, e: unknown): NextResponse {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("forbidden")) return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  if (msg.includes("location_not_found")) return NextResponse.json({ error: "Không tìm thấy địa điểm" }, { status: 404 });
  if (msg.includes("period_invalid")) return NextResponse.json({ error: "Kỳ không hợp lệ" }, { status: 400 });
  console.error(`[${tag}]`, msg);
  return NextResponse.json({ error: "Không xuất được file" }, { status: 500 });
}
