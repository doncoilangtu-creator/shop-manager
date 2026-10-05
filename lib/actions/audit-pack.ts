"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import type { ActionResult } from "@/lib/actions/_shared";
import { auditPackErrorMessage, auditPackSalesTotal, auditPackSizeError, parseAuditPackRequest } from "@/lib/books/audit-pack";
import { buildAuditPackZip } from "@/lib/books/audit-pack-export";
import { vnDate } from "@/lib/time";

export type AuditPackDownload = { filename: string; base64: string; sha256: string; bytes: number };

/**
 * Xuất gói hồ sơ kiểm tra (zip) cho một kỳ (năm / 6 tháng). Ghi nhật ký book_exports (kind audit_pack, format zip, SHA-256)
 * trước khi trả file; không ghi được nhật ký thì không trả file (giống các route xuất sổ khác).
 */
export async function exportAuditPackAction(payload: unknown): Promise<ActionResult<AuditPackDownload>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const parsed = parseAuditPackRequest(payload, vnDate());
  if (!parsed.success) return { ok: false, error: parsed.error };
  const { year, kind } = parsed.data;
  try {
    const pack = await buildAuditPackZip(auth.supabase, { year, kind, generatedBy: auth.user.email ?? auth.user.id });
    const tooBig = auditPackSizeError(pack.bytes.byteLength);
    if (tooBig) return { ok: false, error: tooBig };
    const { error } = await auth.supabase.rpc("record_book_export", {
      p: {
        kind: "audit_pack",
        period_from: pack.input.period.from,
        period_to: pack.input.period.to,
        location_id: "",
        format: "zip",
        file_name: pack.fileName,
        sha256: pack.sha256,
        row_count: pack.files.length,
        total: auditPackSalesTotal(pack.input),
        template_version: pack.templateVersion,
        options: {
          year,
          kind,
          files: pack.files.map((f) => f.path),
          bk_stk_included: pack.input.isOwner,
          s1a_diff: pack.input.s1aCheck.diff,
        },
      },
    });
    if (error) return { ok: false, error: auditPackErrorMessage("record_book_export: " + error.message) };
    revalidatePath("/books/audit-pack");
    return { ok: true, data: { filename: pack.fileName, base64: Buffer.from(pack.bytes).toString("base64"), sha256: pack.sha256, bytes: pack.bytes.byteLength } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[audit-pack]", msg);
    return { ok: false, error: auditPackErrorMessage(msg) };
  }
}
