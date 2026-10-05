"use server";

import { requireUser } from "@/lib/auth/require-user";
import { stockErrorMessage } from "./stock-errors";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { formDataToObject, pgErrorMessage, type ActionResult } from "@/lib/actions/_shared";
import { createAdminClient } from "@/lib/supabase/admin";

const productSchema = z.object({
  sku: z.string().min(1, "SKU bắt buộc").max(100),
  name: z.string().min(1, "Tên bắt buộc").max(255),
  category_id: z.string().uuid().nullable().optional(),
  brand: z.string().max(120).optional().nullable(),
  model: z.string().max(120).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  unit: z.string().min(1).max(40).default("cái"),
  cost_price: z.coerce.number().min(0).default(0),
  sell_price: z.coerce.number().min(0).default(0),
  stock_qty: z.coerce.number().int().min(0).default(0),
  min_stock: z.coerce.number().int().min(0).default(0),
  location: z.string().max(120).optional().nullable(),
  warranty_months: z.coerce.number().int().min(0).default(0),
  image_urls: z.array(z.string().url()).default([]),
});

export type ProductInput = z.infer<typeof productSchema>;

export type { ActionResult };

function cleanInput(formData: FormData): Record<string, unknown> {
  return formDataToObject(formData, ["image_urls"]);
}

export async function createProduct(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const parsed = productSchema.safeParse(cleanInput(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const supabase = createAdminClient();

  // Check SKU uniqueness
  const { data: existing } = await supabase
    .from("products")
    .select("id")
    .eq("sku", parsed.data.sku)
    .maybeSingle();
  if (existing) {
    return { ok: false, error: `SKU "${parsed.data.sku}" đã tồn tại` };
  }

  const { data, error } = await supabase
    .from("products")
    .insert({
      sku: parsed.data.sku,
      name: parsed.data.name,
      category_id: parsed.data.category_id ?? null,
      brand: parsed.data.brand ?? null,
      model: parsed.data.model ?? null,
      description: parsed.data.description ?? null,
      unit: parsed.data.unit,
      cost_price: parsed.data.cost_price,
      sell_price: parsed.data.sell_price,
      stock_qty: parsed.data.stock_qty,
      min_stock: parsed.data.min_stock,
      location: parsed.data.location ?? null,
      warranty_months: parsed.data.warranty_months,
      image_urls: parsed.data.image_urls,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  revalidatePath("/inventory");
  return { ok: true, data: { id: data.id } };
}

const productUpdateSchema = productSchema.omit({ stock_qty: true });

export async function updateProduct(
  id: string,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const parsed = productUpdateSchema.safeParse(cleanInput(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const supabase = createAdminClient();

  // Check SKU uniqueness (excluding self)
  const { data: existing } = await supabase
    .from("products")
    .select("id")
    .eq("sku", parsed.data.sku)
    .neq("id", id)
    .maybeSingle();
  if (existing) {
    return { ok: false, error: `SKU "${parsed.data.sku}" đã được sử dụng` };
  }

  const { error } = await supabase
    .from("products")
    .update({
      sku: parsed.data.sku,
      name: parsed.data.name,
      category_id: parsed.data.category_id ?? null,
      brand: parsed.data.brand ?? null,
      model: parsed.data.model ?? null,
      description: parsed.data.description ?? null,
      unit: parsed.data.unit,
      cost_price: parsed.data.cost_price,
      sell_price: parsed.data.sell_price,
      min_stock: parsed.data.min_stock,
      location: parsed.data.location ?? null,
      warranty_months: parsed.data.warranty_months,
      image_urls: parsed.data.image_urls,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };

  // stock is NOT editable here: use countStock() (kiểm kê) or a purchase bill (/purchases/new → post_purchase_bill) so every change is a ledger movement.
  // Manual stock-in (stock_adjust "in" without a document) is blocked in HKD mode since 0014.
  revalidatePath("/inventory");
  revalidatePath(`/inventory/${id}`);
  return { ok: true, data: { id } };
}

export async function deleteProduct(id: string): Promise<ActionResult<null>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const supabase = createAdminClient();

  // Check if referenced in quotation_items
  const { data: refs } = await supabase
    .from("quotation_items")
    .select("id")
    .eq("product_id", id)
    .limit(1);
  if (refs && refs.length > 0) {
    return {
      ok: false,
      error: "Không thể xóa: sản phẩm đang được tham chiếu trong báo giá.",
    };
  }

  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) {
    // stock_movements / invoices reference the product with ON DELETE RESTRICT (migration 0003)
    if (error.code === "23503") {
      return {
        ok: false,
        error: "Không thể xóa: sản phẩm đã có lịch sử nhập/xuất kho hoặc chứng từ. Hãy đưa tồn về 0 và giữ lại để đối chiếu sổ sách.",
      };
    }
    return { ok: false, error: pgErrorMessage(error) };
  }
  revalidatePath("/inventory");
  return { ok: true, data: null };
}

const countSchema = z.object({
  product_id: z.string().uuid(),
  counted: z.coerce.number().int().min(0, "Số lượng kiểm kê phải >= 0"),
  notes: z.string().max(500).optional().nullable(),
});

/** Stocktake: set the on-hand quantity to the counted value (delta computed under a row lock in SQL). */
export async function countStock(formData: FormData): Promise<ActionResult<{ changed: boolean; stock_qty: number; delta: number }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const parsed = countSchema.safeParse(cleanInput(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const { data, error } = await auth.supabase.rpc("stock_count", {
    p_product_id: parsed.data.product_id,
    p_counted: parsed.data.counted,
    p_notes: parsed.data.notes ?? undefined,
  });
  if (error) return { ok: false, error: stockErrorMessage(error.message) };
  const r = (data ?? {}) as { changed?: boolean; stock_qty?: number; delta?: number };
  revalidatePath("/inventory");
  revalidatePath(`/inventory/${parsed.data.product_id}`);
  return { ok: true, data: { changed: !!r.changed, stock_qty: r.stock_qty ?? parsed.data.counted, delta: r.delta ?? 0 } };
}
