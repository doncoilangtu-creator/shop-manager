import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ChevronLeft,
  Building2,
  User,
  Phone,
  Mail,
  MapPin,
  FileText,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";
import { formatVND, formatDate } from "@/lib/utils";
import { CustomerForm } from "../customer-form";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

const QUOTATION_STATUS_LABELS: Record<string, string> = {
  draft: "Nháp",
  sent: "Đã gửi",
  approved: "Đã duyệt",
  rejected: "Từ chối",
};

const TICKET_STATUS_LABELS: Record<string, string> = {
  received: "Tiếp nhận",
  assigned: "Phân công",
  in_progress: "Đang xử lý",
  waiting_parts: "Chờ linh kiện",
  completed: "Hoàn thành",
  awaiting_signature: "Chờ ký",
  signed: "Đã ký",
  closed: "Đóng",
};

export default async function CustomerDetailPage(props: PageProps) {
  const params = await props.params;
  const supabase = await createClient();

  const [
    { data: customer, error },
    { data: quotations },
    { data: tickets },
    { data: debts },
  ] = await Promise.all([
    supabase.from("customers").select("*").eq("id", params.id).maybeSingle(),
    supabase
      .from("quotations")
      .select("id, code, status, total, created_at")
      .eq("customer_id", params.id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("maintenance_tickets")
      .select("id, code, title, status, priority, created_at")
      .eq("customer_id", params.id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("customer_debts")
      .select("id, amount, due_date, paid, paid_at, notes, created_at")
      .eq("customer_id", params.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  if (error || !customer) {
    notFound();
  }

  const totalDebt = (debts ?? [])
    .filter((d) => !d.paid)
    .reduce((sum, d) => sum + Number(d.amount), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link href="/customers">
            <ChevronLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{customer.name}</h1>
            {customer.type === "business" ? (
              <Badge variant="secondary" className="gap-1">
                <Building2 className="h-3 w-3" />
                Doanh nghiệp
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1">
                <User className="h-3 w-3" />
                Khách lẻ
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Tạo {formatDate(customer.created_at)} · Cập nhật {formatDate(customer.updated_at)}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Liên hệ</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="flex items-center gap-2 text-sm">
            <Phone className="h-4 w-4 text-muted-foreground" />
            <span>{customer.phone || "—"}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <span>{customer.email || "—"}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            <span className="truncate">{customer.address || "—"}</span>
          </div>
          {customer.type === "business" && (
            <>
              <div className="text-sm">
                <span className="text-muted-foreground">MST: </span>
                <span className="font-mono">{customer.tax_code || "—"}</span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">LH: </span>
                {customer.contact_person || "—"}
                {customer.contact_phone && ` (${customer.contact_phone})`}
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Hạn mức nợ: </span>
                <span className="font-medium">{formatVND(customer.debt_limit)}</span>
              </div>
            </>
          )}
        </CardContent>
        {(customer.tags ?? []).length > 0 && (
          <CardContent className="pt-0">
            <Separator className="mb-3" />
            <div className="flex flex-wrap gap-1">
              {(customer.tags ?? []).map((t: string) => (
                <Badge key={t} variant="outline">
                  {t}
                </Badge>
              ))}
            </div>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sửa thông tin</CardTitle>
          <CardDescription>Chỉnh sửa thông tin khách hàng.</CardDescription>
        </CardHeader>
        <CardContent>
          <CustomerForm
            mode="edit"
            customerId={customer.id}
            initial={{
              type: customer.type,
              name: customer.name,
              phone: customer.phone,
              email: customer.email,
              address: customer.address,
              tax_code: customer.tax_code,
              contact_person: customer.contact_person,
              contact_phone: customer.contact_phone,
              debt_limit: Number(customer.debt_limit),
              notes: customer.notes,
              tags: customer.tags ?? [],
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Công nợ hiện tại</CardTitle>
          <CardDescription>
            Tổng nợ chưa thanh toán:{" "}
            <span className={totalDebt > 0 ? "font-semibold text-destructive" : "font-medium"}>
              {formatVND(totalDebt)}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!debts || debts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa ghi nhận công nợ.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ngày</TableHead>
                  <TableHead>Hạn</TableHead>
                  <TableHead className="text-right">Số tiền</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead>Ghi chú</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {debts.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>{formatDate(d.created_at)}</TableCell>
                    <TableCell>{formatDate(d.due_date)}</TableCell>
                    <TableCell className="text-right">{formatVND(d.amount)}</TableCell>
                    <TableCell>
                      {d.paid ? (
                        <Badge variant="secondary">Đã trả</Badge>
                      ) : (
                        <Badge variant="destructive">Chưa trả</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{d.notes ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Lịch sử báo giá
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!quotations || quotations.length === 0 ? (
              <p className="text-sm text-muted-foreground">Chưa có báo giá.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mã</TableHead>
                    <TableHead>Trạng thái</TableHead>
                    <TableHead className="text-right">Tổng</TableHead>
                    <TableHead>Ngày</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quotations.map((q) => (
                    <TableRow key={q.id}>
                      <TableCell>
                        <Link href={`/quotations/${q.id}`} className="font-mono text-xs hover:underline">
                          {q.code}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{QUOTATION_STATUS_LABELS[q.status] ?? q.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{formatVND(q.total)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(q.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wrench className="h-4 w-4" />
              Tickets bảo trì
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!tickets || tickets.length === 0 ? (
              <p className="text-sm text-muted-foreground">Chưa có ticket.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mã</TableHead>
                    <TableHead>Tiêu đề</TableHead>
                    <TableHead>Trạng thái</TableHead>
                    <TableHead>Ngày</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tickets.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>
                        <Link href={`/maintenance/${t.id}`} className="font-mono text-xs hover:underline">
                          {t.code}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate">{t.title}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{TICKET_STATUS_LABELS[t.status] ?? t.status}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(t.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
