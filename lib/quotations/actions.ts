"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateCode } from "@/lib/utils";
import {
  quotationFormSchema,
  computeQuotationTotals,
  type QuotationFormInput,
} from "./schema";

type ActionResult =
  | { ok: true; id: string; code: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * Create a new quotation. Optionally sends immediately if `status === "sent"`.
 */
export async function createQuotationAction(
  raw: QuotationFormInput,
  status: "draft" | "sent" = "draft",
): Promise<ActionResult> {
  const parsed = quotationFormSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Dữ liệu không hợp lệ",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const data = parsed.data;

  const supabase = createClient();
  const totals = computeQuotationTotals({
    items: data.items,
    discount: data.discount,
    vat_rate: data.vat_rate,
  });

  const code = generateCode("BG");

  // Insert header
  const { data: row, error } = await supabase
    .from("quotations")
    .insert({
      code,
      customer_id: data.customer_id || null,
      status,
      valid_until: data.valid_until || null,
      notes: data.notes || null,
      subtotal: totals.subtotal,
      discount: totals.discount,
      vat: totals.vat,
      total: totals.total,
    })
    .select("id, code")
    .single();

  if (error || !row) {
    return { ok: false, error: error?.message || "Không tạo được báo giá" };
  }

  // Insert line items
  const itemsPayload = totals.lines.map((l) => ({
    quotation_id: row.id,
    product_id: l.product_id,
    qty: l.qty,
    unit_price: l.unit_price,
    discount: l.discount,
    line_total: l.line_total,
    notes: data.items.find((it) => it.product_id === l.product_id)?.notes || null,
  }));

  const { error: itemErr } = await supabase
    .from("quotation_items")
    .insert(itemsPayload);

  if (itemErr) {
    // Roll back header so we don't leave orphan quotations.
    await supabase.from("quotations").delete().eq("id", row.id);
    return { ok: false, error: "Không lưu được dòng sản phẩm: " + itemErr.message };
  }

  revalidatePath("/quotations");
  return { ok: true, id: row.id, code: row.code };
}

/**
 * Update an existing quotation.
 * If the quotation already moved beyond draft, allow editing of notes/totals
 * only (the items list may be edited for non-sent statuses).
 */
export async function updateQuotationAction(
  id: string,
  raw: QuotationFormInput,
): Promise<ActionResult> {
  const parsed = quotationFormSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Dữ liệu không hợp lệ",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const data = parsed.data;
  const supabase = createClient();

  const { data: existing, error: exErr } = await supabase
    .from("quotations")
    .select("status")
    .eq("id", id)
    .single();
  if (exErr || !existing) {
    return { ok: false, error: "Không tìm thấy báo giá" };
  }
  if (existing.status !== "draft") {
    return {
      ok: false,
      error: "Chỉ báo giá ở trạng thái Nháp mới có thể chỉnh sửa",
    };
  }

  const totals = computeQuotationTotals({
    items: data.items,
    discount: data.discount,
    vat_rate: data.vat_rate,
  });

  const { error: upErr } = await supabase
    .from("quotations")
    .update({
      customer_id: data.customer_id || null,
      valid_until: data.valid_until || null,
      notes: data.notes || null,
      subtotal: totals.subtotal,
      discount: totals.discount,
      vat: totals.vat,
      total: totals.total,
    })
    .eq("id", id);

  if (upErr) {
    return { ok: false, error: upErr.message };
  }

  // Replace items atomically: delete then insert
  const { error: delErr } = await supabase
    .from("quotation_items")
    .delete()
    .eq("quotation_id", id);
  if (delErr) {
    return { ok: false, error: delErr.message };
  }

  const itemsPayload = totals.lines.map((l) => ({
    quotation_id: id,
    product_id: l.product_id,
    qty: l.qty,
    unit_price: l.unit_price,
    discount: l.discount,
    line_total: l.line_total,
    notes: data.items.find((it) => it.product_id === l.product_id)?.notes || null,
  }));

  const { error: insErr } = await supabase
    .from("quotation_items")
    .insert(itemsPayload);
  if (insErr) {
    return { ok: false, error: insErr.message };
  }

  revalidatePath("/quotations");
  revalidatePath(`/quotations/${id}`);
  return { ok: true, id, code: "" };
}

/**
 * Mark a draft quotation as sent (shared with customer).
 */
export async function sendQuotationAction(id: string): Promise<ActionResult> {
  const supabase = createClient();
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
  const supabase = createClient();
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
  const supabase = createClient();
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
  const supabase = createClient();
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

/**
 * Save (or refresh) the generated PDF URL on the quotation row.
 * Uses admin client to ensure we don't fight with RLS.
 */
export async function saveQuotationPdfUrlAction(
  id: string,
  pdfUrl: string,
): Promise<ActionResult> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("quotations")
    .update({ pdf_url: pdfUrl })
    .eq("id", id)
    .select("code")
    .single();
  if (error || !data) {
    return { ok: false, error: error?.message || "Không lưu được URL PDF" };
  }
  revalidatePath(`/quotations/${id}`);
  return { ok: true, id, code: data.code };
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
  const status = (formData.get("__status") === "sent" ? "sent" : "draft") as
    | "draft"
    | "sent";
  const payload: QuotationFormInput = {
    customer_id: String(formData.get("customer_id") || ""),
    valid_until: String(formData.get("valid_until") || ""),
    notes: String(formData.get("notes") || ""),
    discount: Number(formData.get("discount") || 0),
    vat_rate: Number(formData.get("vat_rate") || 10),
    items: readItems(formData),
  };
  const result = await createQuotationAction(payload, status);
  if (!result.ok) {
    // For server-action failure we just throw — caller wraps with try/catch
    throw new Error(result.error);
  }
  redirect(`/quotations/${result.id}`);
}
