import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";
import { listActiveMoneyAccounts } from "@/lib/money/queries";
import { typed, unwrap, unwrapOne } from "@/lib/actions/_shared";
import { accountLabel } from "@/lib/money/schema";
import { CHANNEL_LABEL, METHOD_LABEL, type Channel, type PaymentMethod } from "@/lib/sales/schema";
import { vnDate } from "@/lib/time";
import { formatDate, formatDateTime, formatVND } from "@/lib/utils";
import { CancelEinvoiceButton, EinvoiceForm, ReturnForm, VoidReturnButton, VoidSaleButton } from "./sale-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chi tiết đơn bán | Shop Manager" };

type Inv = {
  id: string; invoice_no: string; invoice_date: string; due_date: string; total: number; paid_at_sale: number; vat_amount: number; cogs_total: number; memo: string | null;
  voided_at: string | null; sale_source: string; channel: Channel; buyer: { name?: string; tax_code?: string; address?: string; email?: string } | null;
  customers: { name: string; phone: string | null; is_walkin: boolean } | null;
};
type Line = { id: string; line_no: number; description: string | null; qty: number; unit_price: number; discount_pct: number; line_net: number; vat_amount: number; tax_group: string; vat_pct_snapshot: number | null; pit_pct_snapshot: number | null; products: { sku: string; name: string } | null };
type Pay = { id: string; method: PaymentMethod; amount: number; note: string | null; money_accounts: { label: string; provider: string | null; account_no_masked: string | null } | null };
type Ret = { id: string; return_no: string; return_date: string; total: number; ar_applied: number; refunded: number; cogs_total: number; reason: string | null; voided_at: string | null; sales_return_lines: Array<{ sale_line_id: string; qty: number; amount: number }> };
type Einv = { id: string; kind: string; status: string; provider: string | null; symbol: string | null; number: string; lookup_code: string | null; lookup_url: string | null; issued_on: string; cancel_reason: string | null };

const KIND: Record<string, string> = { original: "Hóa đơn gốc", replace: "Thay thế", adjust: "Điều chỉnh" };
const STATUS: Record<string, string> = { issued: "Còn hiệu lực", cancelled: "Đã hủy", replaced: "Đã bị thay thế" };

export default async function SaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sb = await createClient();
  const inv = unwrapOne<Inv>(
    typed<Inv>(await sb.from("sales_invoices").select("id, invoice_no, invoice_date, due_date, total, paid_at_sale, vat_amount, cogs_total, memo, voided_at, sale_source, channel, buyer, customers(name, phone, is_walkin)").eq("id", id).maybeSingle()),
    "sales_invoices",
  );
  if (!inv) notFound();
  const [lines, pays, rets, einvs, open, groupsRes] = await Promise.all([
    sb.from("sales_invoice_lines").select("id, line_no, description, qty, unit_price, discount_pct, line_net, vat_amount, tax_group, vat_pct_snapshot, pit_pct_snapshot, products(sku, name)").eq("invoice_id", id).order("line_no"),
    sb.from("sale_payments").select("id, method, amount, note, money_accounts(label, provider, account_no_masked)").eq("sale_id", id).order("created_at"),
    sb.from("sales_returns").select("id, return_no, return_date, total, ar_applied, refunded, cogs_total, reason, voided_at, sales_return_lines(sale_line_id, qty, amount)").eq("sale_id", id).order("created_at"),
    sb.from("einvoices").select("id, kind, status, provider, symbol, number, lookup_code, lookup_url, issued_on, cancel_reason").eq("sale_id", id).order("created_at"),
    sb.from("v_sales_invoice_open").select("outstanding").eq("invoice_id", id).maybeSingle(),
    sb.from("tax_groups").select("code, name_vi"),
  ]);
  const accounts = await listActiveMoneyAccounts(sb);
  const groupName = new Map(unwrap<Array<{ code: string; name_vi: string }>>(groupsRes, "tax_groups").map((g) => [g.code, g.name_vi]));
  const L = unwrap<Line[]>(typed<Line[]>(lines), "lines");
  const P = unwrap<Pay[]>(typed<Pay[]>(pays), "payments");
  const R = unwrap<Ret[]>(typed<Ret[]>(rets), "returns");
  const E = unwrap<Einv[]>(einvs, "einvoices");
  const outstanding = Number((unwrapOne<{ outstanding: number }>(open, "open")?.outstanding) ?? 0);
  const walkin = inv.customers?.is_walkin ?? false;
  const activeRets = R.filter((r) => !r.voided_at);
  const returned = new Map<string, { qty: number; amount: number }>();
  for (const r of activeRets) for (const rl of r.sales_return_lines) {
    const cur = returned.get(rl.sale_line_id) ?? { qty: 0, amount: 0 };
    returned.set(rl.sale_line_id, { qty: cur.qty + rl.qty, amount: cur.amount + Number(rl.amount) });
  }
  const returnLines = L.map((l) => ({
    id: l.id, label: l.products ? `${l.products.sku} · ${l.products.name}` : l.description ?? "Dịch vụ", isGoods: !!l.products, qty: l.qty,
    returnedQty: returned.get(l.id)?.qty ?? 0, remainingAmount: Number(l.line_net) + Number(l.vat_amount) - (returned.get(l.id)?.amount ?? 0),
  }));
  const activeEinv = E.find((e) => e.status === "issued" && e.kind !== "adjust");
  const legacyVat = Number(inv.vat_amount) !== 0;
  const netRevenue = Number(inv.total) - activeRets.reduce((a, r) => a + Number(r.total), 0);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2"><Link href="/sales"><ArrowLeft className="mr-1 h-4 w-4" />Đơn bán</Link></Button>
          <h1 className="text-2xl font-semibold tracking-tight">
            {inv.invoice_no} {inv.voided_at ? <Badge variant="destructive">Đã hủy</Badge> : <Badge>Hiệu lực</Badge>}
          </h1>
          <p className="text-sm text-muted-foreground">
            {formatDate(inv.invoice_date)} · {inv.customers?.name ?? "—"} · {CHANNEL_LABEL[inv.channel] ?? inv.channel}
            {" · "}Số này là số đơn nội bộ, không phải số hóa đơn điện tử.
          </p>
        </div>
        {!inv.voided_at && <VoidSaleButton saleId={inv.id} />}
      </div>

      {legacyVat && <Card className="border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Đơn này được lập theo cách cũ (có tách VAT {formatVND(inv.vat_amount)}). Chức năng trả hàng tự động chưa hỗ trợ đơn loại này.</Card>}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead><TableHead>Sản phẩm / dịch vụ</TableHead><TableHead className="text-right">SL</TableHead><TableHead className="text-right">Đơn giá</TableHead>
              <TableHead className="text-right">CK %</TableHead><TableHead>Nhóm ngành (GTGT/TNCN)</TableHead><TableHead className="text-right">Thành tiền</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {L.map((l) => (
              <TableRow key={l.id}>
                <TableCell>{l.line_no}</TableCell>
                <TableCell>{l.products ? `${l.products.sku} · ${l.products.name}` : l.description}</TableCell>
                <TableCell className="text-right">{l.qty}</TableCell>
                <TableCell className="text-right">{formatVND(l.unit_price)}</TableCell>
                <TableCell className="text-right">{Number(l.discount_pct) || 0}</TableCell>
                <TableCell>{groupName.get(l.tax_group) ?? l.tax_group}{l.vat_pct_snapshot !== null ? ` (${l.vat_pct_snapshot}% / ${l.pit_pct_snapshot}%)` : ""}</TableCell>
                <TableCell className="text-right">{formatVND(Number(l.line_net) + Number(l.vat_amount))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="space-y-2 p-4 text-sm">
          <h2 className="font-medium">Thanh toán</h2>
          {inv.sale_source !== "hkd_sale" && <p className="text-muted-foreground">Đơn lập theo cách cũ: thu tiền ghi riêng bằng phiếu thu.</p>}
          {P.map((p) => <div key={p.id} className="flex justify-between"><span>{METHOD_LABEL[p.method]}{p.money_accounts ? ` · ${accountLabel(p.money_accounts)}` : ""}{p.note ? ` · ${p.note}` : ""}</span><span>{formatVND(p.amount)}</span></div>)}
          <div className="flex justify-between border-t pt-2"><span>Tổng tiền</span><span className="font-semibold">{formatVND(inv.total)}</span></div>
          <div className="flex justify-between"><span>Doanh thu sau trả hàng</span><span>{formatVND(netRevenue)}</span></div>
          {!inv.voided_at && <div className="flex justify-between"><span>{walkin ? "Còn thiếu" : "Công nợ còn lại"}</span><span className={outstanding > 0 ? "font-medium text-destructive" : ""}>{formatVND(outstanding)}</span></div>}
          {inv.buyer && <p className="text-xs text-muted-foreground">Người mua: {[inv.buyer.name, inv.buyer.tax_code, inv.buyer.address].filter(Boolean).join(" · ")}</p>}
          {inv.memo && <p className="text-xs text-muted-foreground">Ghi chú: {inv.memo}</p>}
        </Card>

        <Card className="space-y-3 p-4 text-sm">
          <h2 className="font-medium">Hóa đơn điện tử</h2>
          <p className="text-xs text-muted-foreground">Chỉ lưu số hóa đơn và mã tra cứu do nhà cung cấp hóa đơn điện tử cấp (hệ thống không kết nối trực tiếp).</p>
          {E.length === 0 && <p className="text-muted-foreground">Chưa có hóa đơn điện tử cho đơn này.</p>}
          {E.map((e) => (
            <div key={e.id} className="rounded-md border p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{e.symbol ? `${e.symbol} · ` : ""}{e.number}</span>
                <span className="flex items-center gap-2"><Badge variant="outline">{KIND[e.kind] ?? e.kind}</Badge><Badge variant={e.status === "issued" ? "secondary" : "destructive"}>{STATUS[e.status] ?? e.status}</Badge></span>
              </div>
              <div className="text-xs text-muted-foreground">
                {formatDate(e.issued_on)}{e.provider ? ` · ${e.provider}` : ""}{e.lookup_code ? ` · Mã tra cứu: ${e.lookup_code}` : ""}
                {e.lookup_url && /^https?:\/\//i.test(e.lookup_url) ? <> · <a className="underline" href={e.lookup_url} target="_blank" rel="noopener noreferrer">Tra cứu</a></> : null}
                {e.cancel_reason ? ` · Lý do hủy: ${e.cancel_reason}` : ""}
              </div>
              {e.status === "issued" && e.kind !== "adjust" && !inv.voided_at && <div className="mt-2"><CancelEinvoiceButton saleId={inv.id} einvoiceId={e.id} /></div>}
            </div>
          ))}
          {!inv.voided_at && <EinvoiceForm saleId={inv.id} hasActive={!!activeEinv} />}
        </Card>
      </div>

      <Card className="space-y-3 p-4">
        <h2 className="font-medium">Hàng bán trả lại / giảm giá</h2>
        {R.length === 0 && <p className="text-sm text-muted-foreground">Chưa có phiếu trả hàng.</p>}
        {R.length > 0 && (
          <Table>
            <TableHeader><TableRow><TableHead>Phiếu</TableHead><TableHead>Ngày</TableHead><TableHead className="text-right">Giá trị</TableHead><TableHead className="text-right">Trừ công nợ</TableHead><TableHead className="text-right">Hoàn tiền</TableHead><TableHead>Lý do</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {R.map((r) => (
                <TableRow key={r.id} className={r.voided_at ? "opacity-50" : ""}>
                  <TableCell>{r.return_no}</TableCell><TableCell>{formatDate(r.return_date)}</TableCell>
                  <TableCell className="text-right">{formatVND(r.total)}</TableCell><TableCell className="text-right">{formatVND(r.ar_applied)}</TableCell><TableCell className="text-right">{formatVND(r.refunded)}</TableCell>
                  <TableCell>{r.reason ?? ""}{r.voided_at ? ` (đã hủy ${formatDateTime(r.voided_at)})` : ""}</TableCell>
                  <TableCell>{!r.voided_at && <VoidReturnButton saleId={inv.id} returnId={r.id} />}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {!inv.voided_at && !legacyVat && <ReturnForm saleId={inv.id} lines={returnLines} today={vnDate()} walkin={walkin} outstanding={outstanding} accounts={accounts} />}
      </Card>
    </div>
  );
}
