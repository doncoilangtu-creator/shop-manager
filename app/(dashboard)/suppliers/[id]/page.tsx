import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";
import { listActiveMoneyAccounts } from "@/lib/money/queries";
import { formatDate, formatVND } from "@/lib/utils";
import { unwrap } from "@/lib/actions/_shared";
import { SupplierForm } from "../supplier-form";
import { OpenItemsCard } from "../../open-items-card";
import { DebtRowActions } from "./debt-row-actions";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function SupplierDetailPage(props: PageProps) {
  const { id } = await props.params;
  const supabase = await createClient();

  const [supRes, debtsRes, apRes, billsRes] = await Promise.all([
    supabase.from("suppliers").select("*").eq("id", id).maybeSingle(),
    supabase.from("supplier_debts").select("id, amount, due_date, paid, paid_at, notes, created_at").eq("supplier_id", id).order("created_at", { ascending: false }).limit(100),
    supabase.from("v_ap_by_supplier").select("balance, gl_balance").eq("supplier_id", id).maybeSingle(),
    supabase
      .from("v_purchase_bill_open")
      .select("bill_id, bill_no, bill_date, due_date, total, outstanding")
      .eq("supplier_id", id)
      .gt("outstanding", 0)
      .order("bill_date", { ascending: true })
      .limit(100),
  ]);
  if (supRes.error) throw new Error("suppliers: " + supRes.error.message);
  const supplier = supRes.data;
  if (!supplier) notFound();
  if (apRes.error) throw new Error("v_ap_by_supplier: " + apRes.error.message);
  const debts = unwrap(debtsRes, "supplier_debts") as Array<{ id: string; amount: number; due_date: string | null; paid: boolean; notes: string | null; created_at: string }>;
  const bills = unwrap(billsRes, "v_purchase_bill_open") as Array<{ bill_id: string; bill_no: string; bill_date: string; due_date: string | null; total: number; outstanding: number }>;
  const unpaidManual = debts.filter((d) => !d.paid).reduce((s, d) => s + Number(d.amount), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link href="/suppliers"><ChevronLeft className="h-5 w-5" /></Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{supplier.name}</h1>
          <p className="text-sm text-muted-foreground">Tạo {formatDate(supplier.created_at)} · MST {supplier.tax_code || "—"}</p>
        </div>
      </div>

      <OpenItemsCard
        accounts={await listActiveMoneyAccounts(supabase)}
        kind="disbursement"
        partnerId={supplier.id}
        balance={Number(apRes.data?.balance ?? 0)}
        glBalance={apRes.data ? Number(apRes.data.gl_balance) : 0}
        items={bills.map((b) => ({ id: b.bill_id, no: b.bill_no, date: b.bill_date, due: b.due_date, total: Number(b.total), outstanding: Number(b.outstanding) }))}
      />

      <Card>
        <CardHeader>
          <CardTitle>Công nợ ghi tay (cũ)</CardTitle>
          <CardDescription>
            Chưa trả: <span className={unpaidManual > 0 ? "font-semibold text-destructive" : "font-medium"}>{formatVND(unpaidManual)}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {debts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa ghi nhận công nợ.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ngày</TableHead><TableHead>Hạn</TableHead>
                  <TableHead className="text-right">Số tiền</TableHead><TableHead>Trạng thái</TableHead>
                  <TableHead>Ghi chú</TableHead><TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {debts.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>{formatDate(d.created_at)}</TableCell>
                    <TableCell>{formatDate(d.due_date)}</TableCell>
                    <TableCell className="text-right">{formatVND(d.amount)}</TableCell>
                    <TableCell>{d.paid ? <Badge variant="secondary">Đã trả</Badge> : <Badge variant="destructive">Chưa trả</Badge>}</TableCell>
                    <TableCell className="text-muted-foreground">{d.notes ?? "—"}</TableCell>
                    <TableCell><DebtRowActions debtId={d.id} paid={d.paid} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sửa thông tin</CardTitle>
          <CardDescription>Có thể thêm khoản nợ ghi tay mới ở cuối biểu mẫu.</CardDescription>
        </CardHeader>
        <CardContent>
          <SupplierForm
            mode="edit"
            supplierId={supplier.id}
            initial={{
              name: supplier.name, tax_code: supplier.tax_code, phone: supplier.phone, email: supplier.email,
              address: supplier.address, contact_person: supplier.contact_person, bank_account: supplier.bank_account, notes: supplier.notes,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
