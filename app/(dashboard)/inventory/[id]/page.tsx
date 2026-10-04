import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { ProductForm } from "../product-form";
import { StockCountDialog } from "../stock-count-dialog";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, formatVND } from "@/lib/utils";
import { unwrap } from "@/lib/actions/_shared";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditProductPage(props: PageProps) {
  const params = await props.params;
  const supabase = await createClient();

  const [{ data: product, error }, { data: categories }, cardRes] = await Promise.all([
    supabase.from("products").select("*").eq("id", params.id).maybeSingle(),
    supabase.from("categories").select("id, name").order("name"),
    supabase
      .from("v_stock_card")
      .select("id, created_at, type, qty_delta, unit_cost, value_delta, ref_type, notes, running_qty")
      .eq("product_id", params.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const card = unwrap(cardRes, "stock card") as Array<{
    id: string; created_at: string; type: string; qty_delta: number; unit_cost: number | null;
    value_delta: number | null; ref_type: string | null; notes: string | null; running_qty: number;
  }>;

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
        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Tồn: <b className="text-foreground">{product.stock_qty}</b></span>
          <StockCountDialog productId={product.id} current={product.stock_qty} />
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

      <Card>
        <div className="border-b px-4 py-3 text-sm font-medium">Thẻ kho (50 phiếu gần nhất)</div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Thời gian</TableHead>
              <TableHead>Loại</TableHead>
              <TableHead className="text-right">+/-</TableHead>
              <TableHead className="text-right">Tồn sau</TableHead>
              <TableHead className="text-right">Giá trị</TableHead>
              <TableHead>Nguồn / ghi chú</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {card.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">Chưa có phiếu kho.</TableCell></TableRow>
            ) : (
              card.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="whitespace-nowrap text-xs">{formatDateTime(m.created_at)}</TableCell>
                  <TableCell>{m.type}</TableCell>
                  <TableCell className={`text-right font-medium ${m.qty_delta < 0 ? "text-destructive" : ""}`}>
                    {m.qty_delta > 0 ? "+" : ""}{m.qty_delta}
                  </TableCell>
                  <TableCell className="text-right">{m.running_qty}</TableCell>
                  <TableCell className="text-right">{m.value_delta == null ? "—" : formatVND(m.value_delta)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{[m.ref_type, m.notes].filter(Boolean).join(" · ")}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
