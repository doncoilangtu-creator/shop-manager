import Link from "next/link";
import { Plus, Users, Mail, Phone, Building2, User } from "lucide-react";
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
import { CustomersFilterBar } from "./filter-bar";
import { DeleteCustomerButton } from "./delete-button";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    q?: string;
    type?: string;
    tag?: string;
  }>;
}

const PAGE_SIZE = 20;

export default async function CustomersPage(props: PageProps) {
  const searchParams = await props.searchParams;
  const supabase = await createClient();
  const q = (searchParams.q ?? "").trim();
  const type = searchParams.type ?? "";
  const tag = searchParams.tag ?? "";

  let query = supabase
    .from("customers")
    .select(
      "id, type, name, phone, email, tax_code, debt_limit, tags",
      { count: "exact" },
    )
    .order("name", { ascending: true })
    .range(0, PAGE_SIZE - 1);

  if (q) {
    const esc = q.replace(/[%,()]/g, "");
    query = query.or(
      `name.ilike.%${esc}%,phone.ilike.%${esc}%,tax_code.ilike.%${esc}%`,
    );
  }
  if (type === "retail" || type === "business") {
    query = query.eq("type", type);
  }
  if (tag) {
    query = query.contains("tags", [tag]);
  }

  const [{ data: customers, count, error }, { data: debtRows }] = await Promise.all([
    query,
    supabase
      .from("customer_debts")
      .select("customer_id, amount, paid")
      .eq("paid", false),
  ]);

  // Aggregate debt per customer
  const debtMap = new Map<string, number>();
  for (const d of debtRows ?? []) {
    debtMap.set(d.customer_id, (debtMap.get(d.customer_id) ?? 0) + Number(d.amount));
  }

  const totalCount = count ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Khách hàng</h1>
          <p className="text-sm text-muted-foreground">
            Khách lẻ, doanh nghiệp, công nợ & lịch sử.
          </p>
        </div>
        <Button asChild>
          <Link href="/customers/new">
            <Plus className="mr-2 h-4 w-4" />
            Thêm khách hàng
          </Link>
        </Button>
      </div>

      <Card className="p-4">
        <CustomersFilterBar currentQ={q} currentType={type} currentTag={tag} />
      </Card>

      <Card>
        <div className="flex items-center justify-between border-b px-4 py-3 text-sm">
          <div className="text-muted-foreground">
            Tổng: <span className="font-medium text-foreground">{totalCount}</span> khách
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tên</TableHead>
              <TableHead>Loại</TableHead>
              <TableHead>SĐT</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>MST</TableHead>
              <TableHead className="text-right">Công nợ</TableHead>
              <TableHead>Tags</TableHead>
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
            ) : customers === null ? (
              <TableSkeleton />
            ) : customers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center">
                  <Users className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">Chưa có khách hàng nào.</p>
                  <Button asChild variant="link" className="mt-2">
                    <Link href="/customers/new">Thêm khách hàng đầu tiên</Link>
                  </Button>
                </TableCell>
              </TableRow>
            ) : (
              customers.map((c) => {
                const debt = debtMap.get(c.id) ?? 0;
                return (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link
                        href={`/customers/${c.id}`}
                        className="font-medium text-foreground hover:underline"
                      >
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {c.type === "business" ? (
                        <Badge variant="secondary" className="gap-1">
                          <Building2 className="h-3 w-3" />
                          Doanh nghiệp
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1">
                          <User className="h-3 w-3" />
                          Lẻ
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {c.phone ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {c.email ? (
                        <span className="inline-flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          {c.email}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {c.tax_code ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={debt > 0 ? "font-medium text-destructive" : "text-muted-foreground"}>
                        {formatVND(debt)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(c.tags ?? []).slice(0, 2).map((t: string) => (
                          <Badge key={t} variant="outline" className="text-[10px]">
                            {t}
                          </Badge>
                        ))}
                        {(c.tags ?? []).length > 2 && (
                          <span className="text-xs text-muted-foreground">
                            +{(c.tags ?? []).length - 2}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/customers/${c.id}`}>Sửa</Link>
                        </Button>
                        <DeleteCustomerButton id={c.id} name={c.name} />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
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
