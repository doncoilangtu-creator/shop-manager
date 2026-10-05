"use server";

import { requireUser, requireUserOrThrow } from "@/lib/auth/require-user";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateCode } from "@/lib/codes";
import { isQuotationPdfPath } from "./pdf-url";
import { signQuotationPdf } from "./storage";
import { accountingErrorMessage } from "@/lib/accounting/errors";
import { vnDate } from "@/lib/time";
import { quotationFormSchema, toRpcItems, type QuotationFormInput } from "./schema";

type ActionResult =
  | { ok: true; id: string; code: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

function quotationErrorMessage(msg: string): string {
  if (msg.includes("quotation_not_draft")) return "Chỉ báo giá ở trạng thái Nháp mới có thể chỉnh sửa";
  if (msg.includes("quotation_status_transition")) return "Không thể chuyển sang trạng thái này";
  if (msg.includes("quotation_not_found")) return "Không tìm thấy báo giá";
  if (msg.includes("items_required") || msg.includes("item_invalid")) return "Dòng sản phẩm không hợp lệ";
  if (msg.includes("quotation_not_approved")) return "Chỉ lập hóa đơn từ báo giá đã duyệt";
  if (msg.includes("quotation_already_invoiced")) return "Báo giá này đã được lập hóa đơn";
  if (msg.includes("customer_required_for_invoice")) return "Báo giá chưa chọn khách hàng";
  if (msg.includes("vat_not_allowed_hkd")) return "Hộ kinh doanh không tách VAT: dùng đơn giá đã gồm thuế (báo giá cũ có VAT cần lập lại)";
  if (msg.includes("vat_rate_unknown")) return "Thuế suất VAT phải là 0, 5, 8 hoặc 10%";
  if (msg.includes("qty_not_integer")) return "Số lượng phải là số nguyên để xuất kho";
  return accountingErrorMessage(msg);
}

function parseForm(raw: QuotationFormInput) {
  const parsed = quotationFormSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false as const,
      result: {
        ok: false as const,
        error: "Dữ liệu không hợp lệ",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      },
    };
  }
  return { ok: true as const, data: parsed.data };
}

/**
 * Create a quotation. Header + items + totals are written by ONE database call (save_quotation),
 * totals are computed in SQL from the items, and the code is retried on a unique violation.
 */
export async function createQuotationAction(
  raw: QuotationFormInput,
  status: "draft" | "sent" = "draft",
): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const p = parseForm(raw);
  if (!p.ok) return p.result;
  const data = p.data;

  let lastError = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode("BG");
    const { data: res, error } = await auth.supabase.rpc("save_quotation", {
      p_id: null,
      p_code: code,
      p_customer_id: data.customer_id || null,
      p_status: status,
      p_valid_until: data.valid_until || null,
      p_notes: data.notes || null,
      p_discount: data.discount,
      p_vat_rate: data.vat_rate,
      p_items: toRpcItems(data.items),
    });
    if (!error) {
      const r = res as { id: string; code?: string };
      revalidatePath("/quotations");
      return { ok: true, id: r.id, code: r.code ?? code };
    }
    lastError = error.message;
    if (error.code !== "23505") break;      // only a code collision is worth retrying
  }
  return { ok: false, error: quotationErrorMessage(lastError) };
}

/** Update a DRAFT quotation (atomic: header + items replaced in one transaction, status checked under a row lock). */
export async function updateQuotationAction(id: string, raw: QuotationFormInput): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const p = parseForm(raw);
  if (!p.ok) return p.result;
  const data = p.data;
  const { data: res, error } = await auth.supabase.rpc("save_quotation", {
    p_id: id,
    p_code: null,
    p_customer_id: data.customer_id || null,
    p_status: "draft",
    p_valid_until: data.valid_until || null,
    p_notes: data.notes || null,
    p_discount: data.discount,
    p_vat_rate: data.vat_rate,
    p_items: toRpcItems(data.items),
  });
  if (error) return { ok: false, error: quotationErrorMessage(error.message) };
  const r = res as { id?: string; code?: string } | null;
  revalidatePath("/quotations");
  revalidatePath(`/quotations/${id}`);
  return { ok: true, id, code: r?.code ?? "" };
}

/**
 * Mark a draft quotation as sent (shared with customer).
 */
export async function sendQuotationAction(id: string): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("quotations")
    .update({ status: "sent" })
    .eq("id", id)
    .eq("status", "draft")
    .select("code")
    .single();
  if (error || !row) {
    return { ok: false, error: error?.message || "Không gửi được báo giá" };
  }
  revalidatePath("/quotations");
  revalidatePath(`/quotations/${id}`);
  return { ok: true, id, code: row.code };
}

/**
 * Approve a sent quotation (customer accepted).
 */
export async function approveQuotationAction(id: string): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("quotations")
    .update({ status: "approved" })
    .eq("id", id)
    .eq("status", "sent")
    .select("code")
    .single();
  if (error || !row) {
    return {
      ok: false,
      error: error?.message || "Chỉ duyệt được báo giá đã gửi",
    };
  }
  revalidatePath("/quotations");
  revalidatePath(`/quotations/${id}`);
  return { ok: true, id, code: row.code };
}

/**
 * Reject a sent quotation (customer declined).
 */
export async function rejectQuotationAction(id: string): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("quotations")
    .update({ status: "rejected" })
    .eq("id", id)
    .eq("status", "sent")
    .select("code")
    .single();
  if (error || !row) {
    return {
      ok: false,
      error: error?.message || "Chỉ từ chối được báo giá đã gửi",
    };
  }
  revalidatePath("/quotations");
  revalidatePath(`/quotations/${id}`);
  return { ok: true, id, code: row.code };
}

/**
 * Delete a quotation. Only allowed when in draft status (or rejected).
 */
export async function deleteQuotationAction(id: string): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const supabase = await createClient();
  // Fetch first so we can decide
  const { data: row, error: rErr } = await supabase
    .from("quotations")
    .select("status")
    .eq("id", id)
    .single();
  if (rErr || !row) return { ok: false, error: "Không tìm thấy báo giá" };
  if (row.status !== "draft" && row.status !== "rejected") {
    return {
      ok: false,
      error: "Chỉ xóa được báo giá ở trạng thái Nháp hoặc Từ chối",
    };
  }
  const { error } = await supabase.from("quotations").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/quotations");
  return { ok: true, id, code: "" };
}

/** Remember the object path of the generated PDF (private bucket). */
export async function saveQuotationPdfPathAction(id: string, path: string): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!isQuotationPdfPath(path)) return { ok: false, error: "Đường dẫn PDF không hợp lệ" };
  const { data, error } = await auth.supabase
    .from("quotations")
    .update({ pdf_path: path })
    .eq("id", id)
    .select("code")
    .single();
  if (error || !data) return { ok: false, error: error?.message || "Không lưu được PDF" };
  revalidatePath(`/quotations/${id}`);
  return { ok: true, id, code: data.code };
}

/** Short-lived signed link to the stored PDF (the bucket is private). */
export async function getQuotationPdfLinkAction(
  id: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const { data, error } = await auth.supabase.from("quotations").select("pdf_path").eq("id", id).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data?.pdf_path) return { ok: false, error: "Chưa có PDF. Hãy tạo PDF trước." };
  try {
    return { ok: true, url: await signQuotationPdf(data.pdf_path) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Approved quotation -> sales invoice (stock out + ledger entries in one DB transaction). */
export async function invoiceFromQuotationAction(
  id: string,
  opts: { dueDate?: string; allowOverLimit?: boolean } = {},
): Promise<{ ok: true; invoiceNo: string; total: number } | { ok: false; error: string }> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const { data, error } = await auth.supabase.rpc("invoice_from_quotation", {
    p_quotation_id: id,
    p_invoice_date: vnDate(),
    p_due_date: opts.dueDate || undefined,
    p_allow_over_limit: !!opts.allowOverLimit,
  });
  if (error) return { ok: false, error: quotationErrorMessage(error.message) };
  const r = data as { invoice_no: string; total: number };
  revalidatePath("/quotations");
  revalidatePath(`/quotations/${id}`);
  return { ok: true, invoiceNo: r.invoice_no, total: Number(r.total) };
}

// ---------- form-action wrappers (formData → typed payloads) ----------

const formItemSchema = z.object({
  product_id: z.string(),
  qty: z.coerce.number(),
  unit_price: z.coerce.number(),
  discount: z.coerce.number(),
  notes: z.string().optional().default(""),
});

function readItems(formData: FormData) {
  const raw = formData.getAll("items");
  if (raw.length === 0) return [];
  // Each item is a JSON string (from hidden inputs) — supports dynamic line arrays.
  return raw
    .map((r) => {
      if (typeof r !== "string") return null;
      try {
        const obj = JSON.parse(r);
        const parsed = formItemSchema.safeParse(obj);
        if (!parsed.success) return null;
        return parsed.data;
      } catch {
        return null;
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

export async function createQuotationFormAction(formData: FormData) {
  await requireUserOrThrow();
  const status = (formData.get("__status") === "sent" ? "sent" : "draft") as
    | "draft"
    | "sent";
  const payload: QuotationFormInput = {
    customer_id: String(formData.get("customer_id") || ""),
    valid_until: String(formData.get("valid_until") || ""),
    notes: String(formData.get("notes") || ""),
    discount: Number(formData.get("discount") || 0),
    vat_rate: 0,
    items: readItems(formData),
  };
  const result = await createQuotationAction(payload, status);
  if (!result.ok) {
    // For server-action failure we just throw — caller wraps with try/catch
    throw new Error(result.error);
  }
  redirect(`/quotations/${result.id}`);
}
