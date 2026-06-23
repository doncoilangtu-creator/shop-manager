import Link from "next/link";
import { Plus, Truck, Phone, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { SuppliersFilterBar } from "./filter-bar";
import { DeleteSupplierButton } from "./delete-button";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: {
    q?: string;
  };
}

const PAGE_SIZE = 20;

export default async function SuppliersPage({ searchParams }: PageProps) {
  const supabase = createClient();
  const q = (searchParams.q ?? "").trim();

  let query = supabase
    .from("suppliers")
    .select("id, name, tax_code, phone, contact_person, email", { count: "exact" })
    .order("name", { ascending: true })
    .range(0, PAGE_SIZE - 1);

  if (q) {
    const esc = q.replace(/[%,()]/g, "");
    query = query.or(`name.ilike.%${esc}%,tax_code.ilike.%${esc}%,phone.ilike.%${esc}%`);
  }

  const [{ data: suppliers, count, error }, { data: debtRows }] = await Promise.all([
    query,
    supabase.from("supplier_debts").select("supplier_id, amount, paid"),
  ]);

  // Aggregate unpaid debt per supplier
  const debtMap = new Map<string, number>();
  for (const d of debtRows ?? []) {
    if (d.paid) continue;
    debtMap.set(d.supplier_id, (debtMap.get(d.supplier_id) ?? 0) + Number(d.amount));
  }

  const totalCount = count ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Đối tác / Nhà cung cấp</h1>
          <p className="text-sm text-muted-foreground">
            Quản lý NCC, công nợ phải trả & lịch sử nhập hàng.
          </p>
        </div>
        <Button asChild>
          <Link href="/suppliers/new">
            <Plus className="mr-2 h-4 w-4" />
            Thêm đối tác
          </Link>
        </Button>
      </div>

      <Card className="p-4">
        <SuppliersFilterBar currentQ={q} />
      </Card>

      <Card>
        <div className="flex items-center justify-between border-b px-4 py-3 text-sm">
          <div className="text-muted-foreground">
            Tổng: <span className="font-medium text-foreground">{totalCount}</span> đối tác
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tên</TableHead>
              <TableHead>MST</TableHead>
              <TableHead>SĐT</TableHead>
              <TableHead>Người liên hệ</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="text-right">Công nợ phải trả</TableHead>
              <TableHead className="w-[100px] text-right">Thao tác</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {error ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-destructive">
                  Lỗi tải dữ liệu: {error.message}
                </TableCell>
              </TableRow>
            ) : suppliers === null ? (
              <TableSkeleton />
            ) : suppliers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center">
                  <Truck className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">Chưa có đối tác nào.</p>
                  <Button asChild variant="link" className="mt-2">
                    <Link href="/suppliers/new">Thêm đối tác đầu tiên</Link>
                  </Button>
                </TableCell>
              </TableRow>
            ) : (
              suppliers.map((s) => {
                const debt = debtMap.get(s.id) ?? 0;
                return (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Link
                        href={`/suppliers/${s.id}`}
                        className="font-medium text-foreground hover:underline"
                      >
                        {s.name}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{s.tax_code ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {s.phone ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.contact_person ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{s.email ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <span
                        className={
                          debt > 0 ? "font-medium text-destructive" : "text-muted-foreground"
                        }
                      >
                        {formatVND(debt)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/suppliers/${s.id}`}>Sửa</Link>
                        </Button>
                        <DeleteSupplierButton id={s.id} name={s.name} />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      <p className="text-xs text-muted-foreground">
        <FileText className="mr-1 inline h-3 w-3" />
        Trang hiển thị tối đa {PAGE_SIZE} đối tác. Phân trang sẽ được thêm sau khi cần.
      </p>
    </div>
  );
}

function TableSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <TableRow key={i}>
          <TableCell colSpan={7}>
            <Skeleton className="h-8 w-full" />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}
