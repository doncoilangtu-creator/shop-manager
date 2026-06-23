import Link from "next/link";
import { Plus, Package, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";
import { formatVND } from "@/lib/utils";
import { InventoryFilterBar } from "./filter-bar";
import { StockInDialog } from "./stock-in-dialog";
import { DeleteProductButton } from "./delete-button";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: {
    q?: string;
    category?: string;
    page?: string;
  };
}

const PAGE_SIZE = 20;

export default async function InventoryPage({ searchParams }: PageProps) {
  const supabase = createClient();
  const q = (searchParams.q ?? "").trim();
  const categoryId = searchParams.category ?? "";
  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from("products")
    .select("id, sku, name, stock_qty, min_stock, sell_price, location, categories(id, name)", {
      count: "exact",
    })
    .order("name", { ascending: true })
    .range(from, to);

  if (q) {
    const esc = q.replace(/[%,()]/g, "");
    query = query.or(`name.ilike.%${esc}%,sku.ilike.%${esc}%`);
  }
  if (categoryId) {
    query = query.eq("category_id", categoryId);
  }

  const [{ data: products, count, error }, { data: categories }] = await Promise.all([
    query,
    supabase.from("categories").select("id, name").order("name"),
  ]);

  const totalCount = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Kho hàng</h1>
          <p className="text-sm text-muted-foreground">
            Quản lý sản phẩm, tồn kho và nhập xuất.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StockInDialog products={products ?? []} />
          <Button asChild>
            <Link href="/inventory/new">
              <Plus className="mr-2 h-4 w-4" />
              Thêm sản phẩm
            </Link>
          </Button>
        </div>
      </div>

      <Card className="p-4">
        <InventoryFilterBar
          categories={categories ?? []}
          currentQ={q}
          currentCategory={categoryId}
        />
      </Card>

      <Card>
        <div className="flex items-center justify-between border-b px-4 py-3 text-sm">
          <div className="text-muted-foreground">
            Tổng: <span className="font-medium text-foreground">{totalCount}</span> sản phẩm
          </div>
          <div className="text-xs text-muted-foreground">
            Trang {page}/{totalPages}
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Tên</TableHead>
              <TableHead>Nhóm</TableHead>
              <TableHead className="text-right">Tồn</TableHead>
              <TableHead className="text-right">Tối thiểu</TableHead>
              <TableHead className="text-right">Giá bán</TableHead>
              <TableHead>Vị trí</TableHead>
              <TableHead className="w-[100px] text-right">Thao tác</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {error ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm text-destructive">
                  Lỗi tải dữ liệu: {error.message}
                </TableCell>
              </TableRow>
            ) : products === null ? (
              <TableSkeleton />
            ) : products.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center">
                  <Package className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">Chưa có sản phẩm nào.</p>
                  <Button asChild variant="link" className="mt-2">
                    <Link href="/inventory/new">Thêm sản phẩm đầu tiên</Link>
                  </Button>
                </TableCell>
              </TableRow>
            ) : (
              products.map((p) => {
                const lowStock = (p.stock_qty ?? 0) <= (p.min_stock ?? 0);
                const cats = (p as unknown as { categories?: { id: string; name: string }[] | null }).categories;
                const cat = cats?.[0] ?? null;
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                    <TableCell>
                      <Link
                        href={`/inventory/${p.id}`}
                        className="font-medium text-foreground hover:underline"
                      >
                        {p.name}
                      </Link>
                      {lowStock && (
                        <Badge variant="destructive" className="ml-2 gap-1 text-[10px]">
                          <AlertTriangle className="h-3 w-3" />
                          Sắp hết
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {cat?.name ?? "—"}
                    </TableCell>
                    <TableCell className="text-right font-medium">{p.stock_qty ?? 0}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {p.min_stock ?? 0}
                    </TableCell>
                    <TableCell className="text-right">{formatVND(p.sell_price)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {p.location ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/inventory/${p.id}`}>Sửa</Link>
                        </Button>
                        <DeleteProductButton id={p.id} name={p.name} />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
            <Button asChild variant="outline" size="sm" disabled={page <= 1}>
              <Link
                href={{
                  pathname: "/inventory",
                  query: { ...searchParams, page: String(page - 1) },
                }}
              >
                Trước
              </Link>
            </Button>
            <span className="text-xs text-muted-foreground">
              Trang {page} / {totalPages}
            </span>
            <Button asChild variant="outline" size="sm" disabled={page >= totalPages}>
              <Link
                href={{
                  pathname: "/inventory",
                  query: { ...searchParams, page: String(page + 1) },
                }}
              >
                Sau
              </Link>
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

function TableSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <TableRow key={i}>
          <TableCell colSpan={8}>
            <Skeleton className="h-8 w-full" />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}
