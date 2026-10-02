import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { ProductForm } from "../product-form";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditProductPage(props: PageProps) {
  const params = await props.params;
  const supabase = await createClient();

  const [{ data: product, error }, { data: categories }] = await Promise.all([
    supabase.from("products").select("*").eq("id", params.id).maybeSingle(),
    supabase.from("categories").select("id, name").order("name"),
  ]);

  if (error || !product) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link href="/inventory">
            <ChevronLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sửa sản phẩm</h1>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">{product.sku}</span> — {product.name}
          </p>
        </div>
      </div>
      <ProductForm
        mode="edit"
        categories={categories ?? []}
        productId={product.id}
        initial={{
          sku: product.sku,
          name: product.name,
          category_id: product.category_id,
          brand: product.brand,
          model: product.model,
          description: product.description,
          unit: product.unit,
          cost_price: Number(product.cost_price),
          sell_price: Number(product.sell_price),
          stock_qty: product.stock_qty,
          min_stock: product.min_stock,
          location: product.location,
          warranty_months: product.warranty_months,
          image_urls: product.image_urls ?? [],
        }}
      />
    </div>
  );
}
