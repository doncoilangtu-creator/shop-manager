"use server";

import { requireUser } from "@/lib/auth/require-user";
import { stockErrorMessage } from "./stock-errors";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
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

export type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function emptyToNull(v: unknown): unknown {
  if (typeof v === "string" && v.trim() === "") return null;
  return v;
}

function cleanInput(formData: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) {
    obj[k] = emptyToNull(v);
  }
  // Handle image_urls (multi-value)
  const urls = formData.getAll("image_urls").filter((v) => typeof v === "string" && v.trim() !== "");
  if (urls.length) obj.image_urls = urls;
  return obj;
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

export async function updateProduct(
  id: string,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const parsed = productSchema.safeParse(cleanInput(formData));
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

  // products.stock_qty is a cache of the stock ledger (migration 0003): a changed
  // quantity in the edit form is recorded as an explicit 'adjust' movement.
  const { data: cur } = await supabase.from("products").select("stock_qty").eq("id", id).single();
  const delta = parsed.data.stock_qty - (cur?.stock_qty ?? 0);
  if (delta !== 0) {
    const { error: adjErr } = await auth.supabase.rpc("stock_adjust", {
      p_product_id: id,
      p_type: "adjust",
      p_qty: delta,
      p_ref_type: "edit",
      p_notes: "Điều chỉnh tồn từ form sửa sản phẩm",
    });
    if (adjErr) return { ok: false, error: stockErrorMessage(adjErr.message) };
  }
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

  // Check stock_movements references — do not block, just inform
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/inventory");
  return { ok: true, data: null };
}

const stockInSchema = z.object({
  product_id: z.string().uuid(),
  qty: z.coerce.number().int().positive("Số lượng phải > 0"),
  unit_cost: z.coerce.number().min(0).default(0),
  notes: z.string().max(500).optional().nullable(),
});

export async function stockIn(formData: FormData): Promise<ActionResult<null>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const parsed = stockInSchema.safeParse(cleanInput(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const { error } = await auth.supabase.rpc("stock_adjust", {
    p_product_id: parsed.data.product_id,
    p_type: "in",
    p_qty: parsed.data.qty,
    p_unit_cost: parsed.data.unit_cost,
    p_ref_type: "manual",
    p_notes: parsed.data.notes ?? `Nhập kho nhanh ${parsed.data.qty}`,
  });
  if (error) return { ok: false, error: stockErrorMessage(error.message) };

  revalidatePath("/inventory");
  return { ok: true, data: null };
}
