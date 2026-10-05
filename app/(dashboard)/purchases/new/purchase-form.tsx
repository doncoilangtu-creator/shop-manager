"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createPurchaseAction } from "@/lib/actions/purchases";
import { VAT_RATES, computePurchaseTotals } from "@/lib/purchases/schema";
import { formatVND } from "@/lib/utils";

export type PurchaseProduct = { id: string; sku: string; name: string; stock_qty: number; cost_price: number };
export type PurchaseSupplier = { id: string; name: string; phone: string | null };

type Line = { uid: string; product_id: string; qty: string; unit_cost: string; vat_rate: string };

const selectCls = "h-9 w-full rounded-md border bg-background px-2 text-sm";
let seq = 0;
const uid = () => `p${++seq}`;
const blankLine = (): Line => ({ uid: uid(), product_id: "", qty: "1", unit_cost: "0", vat_rate: "0" });

export function PurchaseForm({ products, suppliers, today }: { products: PurchaseProduct[]; suppliers: PurchaseSupplier[]; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [supplierId, setSupplierId] = useState("");
  const [date, setDate] = useState(today);
  const [dueDate, setDueDate] = useState("");
  const [ref, setRef] = useState("");
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [error, setError] = useState<string | null>(null);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const totals = computePurchaseTotals(lines.map((l) => ({ qty: Number(l.qty), unit_cost: Number(l.unit_cost), vat_rate: Number(l.vat_rate) })));
  const patch = (id: string, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.uid === id ? { ...l, ...p } : l)));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await createPurchaseAction({
        supplier_id: supplierId,
        bill_date: date,
        due_date: dueDate || null,
        supplier_ref: ref,
        memo,
        lines: lines.map((l) => ({ product_id: l.product_id, qty: Number(l.qty), unit_cost: Number(l.unit_cost), vat_rate: Number(l.vat_rate) || 0 })),
      });
      if (!res.ok) { setError(res.error); toast.error(res.error); return; }
      toast.success(`Đã ghi phiếu mua ${res.data.bill_no} — ${formatVND(res.data.total)}`);
      router.push(`/purchases/${res.data.bill_id}`);
      router.refresh();
    });
  };

  return (
    <form className="space-y-6" onSubmit={submit}>
      <Card className="grid gap-4 p-4 md:grid-cols-4">
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="p-supplier">Nhà cung cấp</Label>
          <select id="p-supplier" required className={selectCls} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">— Chọn nhà cung cấp —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.phone ? ` · ${s.phone}` : ""}</option>)}
          </select>
          <p className="text-xs text-muted-foreground">Chưa có? <Link className="underline" href="/suppliers/new">Thêm nhà cung cấp</Link></p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="p-date">Ngày chứng từ</Label>
          <Input id="p-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="p-due">Hạn thanh toán</Label>
          <Input id="p-due" type="date" value={dueDate} min={date} onChange={(e) => setDueDate(e.target.value)} />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="p-ref">Số chứng từ của nhà cung cấp (hóa đơn/phiếu giao hàng)</Label>
          <Input id="p-ref" maxLength={60} placeholder="vd: 0001234" value={ref} onChange={(e) => setRef(e.target.value)} />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="p-memo">Ghi chú</Label>
          <Input id="p-memo" maxLength={500} value={memo} onChange={(e) => setMemo(e.target.value)} />
        </div>
      </Card>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="min-w-[260px] p-2">Sản phẩm</th>
              <th className="w-[90px] p-2 text-right">SL</th>
              <th className="w-[150px] p-2 text-right">Giá nhập (chưa VAT)</th>
              <th className="w-[130px] p-2">VAT trên hóa đơn mua</th>
              <th className="w-[140px] p-2 text-right">Giá vốn nhập kho</th>
              <th className="w-[40px] p-2" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.uid} className="border-b align-top">
                <td className="p-2">
                  <select
                    required
                    className={selectCls}
                    value={l.product_id}
                    onChange={(e) => {
                      const p = byId.get(e.target.value);
                      patch(l.uid, { product_id: e.target.value, unit_cost: p && Number(l.unit_cost) === 0 ? String(p.cost_price) : l.unit_cost });
                    }}
                  >
                    <option value="">— Chọn sản phẩm —</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name} (tồn {p.stock_qty})</option>)}
                  </select>
                </td>
                <td className="p-2"><Input type="number" min={1} step={1} className="text-right" value={l.qty} onChange={(e) => patch(l.uid, { qty: e.target.value })} /></td>
                <td className="p-2"><Input type="number" min={0} step={1000} className="text-right" value={l.unit_cost} onChange={(e) => patch(l.uid, { unit_cost: e.target.value })} /></td>
                <td className="p-2">
                  <select className={selectCls} value={l.vat_rate} onChange={(e) => patch(l.uid, { vat_rate: e.target.value })} aria-label="VAT trên hóa đơn mua">
                    {VAT_RATES.map((v) => <option key={v} value={v}>{v === 0 ? "Không / đã gồm" : `${v}%`}</option>)}
                  </select>
                </td>
                <td className="p-2 text-right font-medium">{formatVND(totals.lines[i]?.cost ?? 0)}</td>
                <td className="p-2">
                  <Button type="button" variant="ghost" size="icon" aria-label="Xóa dòng" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.uid !== l.uid))}><Trash2 className="h-4 w-4" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="p-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, blankLine()])}><Plus className="mr-1 h-4 w-4" />Thêm dòng</Button>
        </div>
      </Card>

      <Card className="ml-auto w-full max-w-md space-y-1 p-4 text-sm">
        <div className="flex justify-between"><span>Tiền hàng</span><span>{formatVND(totals.subtotal)}</span></div>
        <div className="flex justify-between"><span>VAT trên hóa đơn mua (tính vào giá vốn)</span><span>{formatVND(totals.vat)}</span></div>
        <div className="flex justify-between border-t pt-2 text-base font-semibold"><span>Phải trả nhà cung cấp</span><span>{formatVND(totals.total)}</span></div>
        <p className="pt-1 text-xs text-muted-foreground">
          Hộ kinh doanh không kê khai/khấu trừ VAT đầu vào. Số thuế ghi trên hóa đơn mua được cộng vào giá vốn hàng tồn kho (TK 156).
          Số liệu chính thức được tính lại trên máy chủ khi lưu.
        </p>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button asChild type="button" variant="outline"><Link href="/purchases">Hủy</Link></Button>
        <Button type="submit" disabled={pending || !supplierId}>{pending ? "Đang ghi…" : "Ghi phiếu mua"}</Button>
      </div>
    </form>
  );
}
