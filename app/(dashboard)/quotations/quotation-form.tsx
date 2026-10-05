"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createQuotationAction, updateQuotationAction } from "@/lib/quotations/actions";
import { computeQuotationTotals, round2, type QuotationFormInput } from "@/lib/quotations/schema";
import { makeBlankLine, type LineRow, type PickerCustomer, type PickerProduct } from "@/lib/quotations/defaults";
import { formatVND } from "@/lib/utils";

interface Props {
  customers: PickerCustomer[];
  products: PickerProduct[];
  quotationId?: string;
  initial?: {
    customer_id: string;
    valid_until: string;
    notes: string;
    discount: number;
    vat_rate?: number;
    lines: Array<Omit<LineRow, "uid">>;
  };
  defaultValidUntil: string;
}

const selectCls = "h-9 w-full rounded-md border bg-background px-2 text-sm";
let uidSeq = 0;
const nextUid = () => `l${++uidSeq}`;

export function QuotationForm({ customers, products, quotationId, initial, defaultValidUntil }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [customerId, setCustomerId] = useState(initial?.customer_id ?? "");
  const [validUntil, setValidUntil] = useState(initial?.valid_until ?? defaultValidUntil);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [discount, setDiscount] = useState(String(initial?.discount ?? 0));
  const [lines, setLines] = useState<LineRow[]>(
    initial?.lines.length ? initial.lines.map((l) => ({ ...l, uid: nextUid() })) : [makeBlankLine(nextUid())],
  );
  const [error, setError] = useState<string | null>(null);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const payload: QuotationFormInput = {
    customer_id: customerId,
    valid_until: validUntil,
    notes,
    discount: Number(discount) || 0,
    vat_rate: 0,
    items: lines.map((l) => ({ product_id: l.product_id, qty: l.qty, unit_price: l.unit_price, discount: l.discount, notes: l.notes })),
  };
  const totals = computeQuotationTotals(payload);

  const patch = (uid: string, p: Partial<LineRow>) => setLines((ls) => ls.map((l) => (l.uid === uid ? { ...l, ...p } : l)));

  const submit = (status: "draft" | "sent") => {
    setError(null);
    startTransition(async () => {
      const res = quotationId ? await updateQuotationAction(quotationId, payload) : await createQuotationAction(payload, status);
      if (!res.ok) {
        const fe = res.fieldErrors ? Object.values(res.fieldErrors).flat().join("; ") : "";
        const msg = fe ? `${res.error}: ${fe}` : res.error;
        setError(msg);
        toast.error(msg);
        return;
      }
      toast.success(quotationId ? "Đã lưu báo giá" : `Đã tạo báo giá ${res.code}`);
      router.push(`/quotations/${res.id}`);
      router.refresh();
    });
  };

  return (
    <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); submit("draft"); }}>
      <Card className="grid gap-4 p-4 md:grid-cols-4">
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="q-customer">Khách hàng</Label>
          <select id="q-customer" className={selectCls} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">— Chọn khách hàng —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="q-valid">Hiệu lực đến</Label>
          <Input id="q-valid" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} required />
        </div>
        <div className="space-y-1 text-sm text-muted-foreground">
          <Label>Thuế</Label>
          <p>Đơn giá trong báo giá <b>đã gồm thuế</b> (hộ kinh doanh không tách VAT).</p>
        </div>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[240px]">Sản phẩm</TableHead>
              <TableHead className="w-[90px] text-right">SL</TableHead>
              <TableHead className="w-[140px] text-right">Đơn giá</TableHead>
              <TableHead className="w-[90px] text-right">CK %</TableHead>
              <TableHead className="w-[140px] text-right">Thành tiền</TableHead>
              <TableHead>Ghi chú</TableHead>
              <TableHead className="w-[40px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l) => {
              const prod = byId.get(l.product_id);
              const lineTotal = l.product_id && l.qty > 0 ? round2(l.qty * l.unit_price * (1 - (l.discount || 0) / 100)) : 0;
              return (
                <TableRow key={l.uid}>
                  <TableCell>
                    <select
                      className={selectCls}
                      value={l.product_id}
                      onChange={(e) => {
                        const p = byId.get(e.target.value);
                        patch(l.uid, { product_id: e.target.value, unit_price: p ? Number(p.sell_price) : 0 });
                      }}
                    >
                      <option value="">— Chọn sản phẩm —</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name} (tồn {p.stock_qty})</option>)}
                    </select>
                    {prod && l.qty > prod.stock_qty && <p className="mt-1 text-xs text-amber-600">Vượt tồn kho hiện tại ({prod.stock_qty}).</p>}
                  </TableCell>
                  <TableCell><Input type="number" min={1} step={1} className="text-right" value={l.qty} onChange={(e) => patch(l.uid, { qty: Number(e.target.value) })} /></TableCell>
                  <TableCell><Input type="number" min={0} step={1000} className="text-right" value={l.unit_price} onChange={(e) => patch(l.uid, { unit_price: Number(e.target.value) })} /></TableCell>
                  <TableCell><Input type="number" min={0} max={100} className="text-right" value={l.discount} onChange={(e) => patch(l.uid, { discount: Number(e.target.value) })} /></TableCell>
                  <TableCell className="text-right font-medium">{formatVND(lineTotal)}</TableCell>
                  <TableCell><Input value={l.notes} onChange={(e) => patch(l.uid, { notes: e.target.value })} /></TableCell>
                  <TableCell>
                    <Button type="button" variant="ghost" size="icon" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.uid !== l.uid))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <div className="border-t p-3">
          <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, makeBlankLine(nextUid())])}>
            <Plus className="mr-2 h-4 w-4" />Thêm dòng
          </Button>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="space-y-2 p-4">
          <Label htmlFor="q-notes">Ghi chú</Label>
          <textarea id="q-notes" rows={4} className="w-full rounded-md border bg-background p-2 text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Card>
        <Card className="space-y-2 p-4 text-sm">
          <div className="flex justify-between"><span>Tạm tính</span><span>{formatVND(totals.subtotal)}</span></div>
          <div className="flex items-center justify-between gap-3">
            <span>Chiết khấu (đ)</span>
            <Input type="number" min={0} className="w-40 text-right" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </div>
          <div className="flex justify-between border-t pt-2 text-base font-semibold"><span>Tổng cộng (đã gồm thuế)</span><span>{formatVND(totals.total)}</span></div>
          <p className="text-xs text-muted-foreground">Số liệu chính thức được tính lại trên máy chủ khi lưu.</p>
        </Card>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Đang lưu…" : quotationId ? "Lưu thay đổi" : "Lưu nháp"}</Button>
        {!quotationId && (
          <Button type="button" variant="secondary" disabled={pending} onClick={() => submit("sent")}>Lưu & đánh dấu đã gửi</Button>
        )}
        <Button type="button" variant="ghost" onClick={() => router.back()}>Hủy</Button>
      </div>
    </form>
  );
}
