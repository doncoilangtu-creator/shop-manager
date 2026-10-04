import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { ProductForm } from "../product-form";

export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const supabase = await createClient();
  const { data: categories } = await supabase
    .from("categories")
    .select("id, name")
    .order("name");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link href="/inventory">
            <ChevronLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Thêm sản phẩm</h1>
          <p className="text-sm text-muted-foreground">
            Tạo sản phẩm mới trong kho.
          </p>
        </div>
      </div>
      <ProductForm mode="create" categories={categories ?? []} />
    </div>
  );
}
