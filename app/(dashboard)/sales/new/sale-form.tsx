"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSaleAction } from "@/lib/actions/sales";
import { CHANNELS, CHANNEL_LABEL, METHOD_LABEL, PAYMENT_METHODS, computeSaleTotals, type Channel, type PaymentMethod } from "@/lib/sales/schema";
import { formatVND } from "@/lib/utils";

export type SaleProduct = { id: string; sku: string; name: string; sell_price: number; stock_qty: number; tax_group: string };
export type SaleCustomer = { id: string; name: string; phone: string | null };
export type TaxGroupOption = { code: string; name_vi: string };

type Line = { uid: string; product_id: string; description: string; qty: string; unit_price: string; discount_pct: string; tax_group: string };
type Pay = { uid: string; method: PaymentMethod; amount: string; note: string };

const selectCls = "h-9 w-full rounded-md border bg-background px-2 text-sm";
let seq = 0;
const uid = () => `r${++seq}`;
const blankLine = (): Line => ({ uid: uid(), product_id: "", description: "", qty: "1", unit_price: "0", discount_pct: "0", tax_group: "" });

export function SaleForm({ products, customers, taxGroups, today }: { products: SaleProduct[]; customers: SaleCustomer[]; taxGroups: TaxGroupOption[]; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [customerId, setCustomerId] = useState("");
  const [date, setDate] = useState(today);
  const [dueDate, setDueDate] = useState("");
  const [channel, setChannel] = useState<Channel>("store");
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [pays, setPays] = useState<Pay[]>([]);
  const [showEinv, setShowEinv] = useState(false);
  const [einv, setEinv] = useState({ symbol: "", number: "", lookup_code: "", lookup_url: "", provider: "" });
  const [showBuyer, setShowBuyer] = useState(false);
  const [buyer, setBuyer] = useState({ name: "", tax_code: "", address: "", email: "" });
  const [error, setError] = useState<string | null>(null);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const totals = computeSaleTotals(
    lines.map((l) => ({ qty: Number(l.qty), unit_price: Number(l.unit_price), discount_pct: Number(l.discount_pct) })),
    pays.map((p) => ({ amount: Number(p.amount) })),
  );
  const walkin = customerId === "";
  const patchLine = (id: string, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.uid === id ? { ...l, ...p } : l)));
  const patchPay = (id: string, p: Partial<Pay>) => setPays((ps) => ps.map((x) => (x.uid === id ? { ...x, ...p } : x)));
  const payRest = (method: PaymentMethod) => setPays((ps) => [...ps.filter((p) => Number(p.amount) > 0), { uid: uid(), method, amount: String(totals.debt || ""), note: "" }]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await createSaleAction({
        customer_id: customerId || null,
        date,
        due_date: totals.debt > 0 ? dueDate || null : null,
        channel,
        memo,
        lines: lines.map((l) => ({
          product_id: l.product_id || null,
          description: l.product_id ? null : l.description,
          qty: Number(l.qty),
          unit_price: Number(l.unit_price),
          discount_pct: Number(l.discount_pct) || 0,
          tax_group: l.tax_group || null,
        })),
        payments: pays.filter((p) => Number(p.amount) > 0).map((p) => ({ method: p.method, amount: Number(p.amount), note: p.note })),
        buyer: showBuyer ? buyer : null,
        einvoice: showEinv && einv.number.trim() ? einv : null,
      });
      if (!res.ok) { setError(res.error); toast.error(res.error); return; }
      toast.success(`Đã ghi đơn ${res.data.invoice_no}` + (res.data.debt > 0 ? ` — còn nợ ${formatVND(res.data.debt)}` : ""));
      router.push(`/sales/${res.data.invoice_id}`);
      router.refresh();
    });
  };

  return (
    <form className="space-y-6" onSubmit={submit}>
      <Card className="grid gap-4 p-4 md:grid-cols-4">
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="s-customer">Khách hàng</Label>
          <select id="s-customer" className={selectCls} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Khách lẻ (không lấy thông tin — phải thanh toán đủ)</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="s-date">Ngày bán</Label>
          <Input id="s-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="s-channel">Kênh bán</Label>
          <select id="s-channel" className={selectCls} value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
            {CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
          </select>
        </div>
      </Card>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="min-w-[240px] p-2">Sản phẩm / dịch vụ</th>
              <th className="w-[80px] p-2 text-right">SL</th>
              <th className="w-[140px] p-2 text-right">Đơn giá (đã gồm thuế)</th>
              <th className="w-[80px] p-2 text-right">CK %</th>
              <th className="w-[230px] p-2">Nhóm ngành thuế</th>
              <th className="w-[130px] p-2 text-right">Thành tiền</th>
              <th className="w-[40px] p-2" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const prod = byId.get(l.product_id);
              return (
                <tr key={l.uid} className="border-b align-top">
                  <td className="p-2">
                    <select
                      className={selectCls}
                      value={l.product_id}
                      onChange={(e) => {
                        const p = byId.get(e.target.value);
                        patchLine(l.uid, { product_id: e.target.value, unit_price: p ? String(p.sell_price) : l.unit_price, tax_group: "" });
                      }}
                    >
                      <option value="">— Dịch vụ / dòng tự nhập —</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name} (tồn {p.stock_qty})</option>)}
                    </select>
                    {!l.product_id && <Input className="mt-1" placeholder="Mô tả dịch vụ (vd: Công cài đặt)" value={l.description} onChange={(e) => patchLine(l.uid, { description: e.target.value })} />}
                    {prod && Number(l.qty) > prod.stock_qty && <p className="mt-1 text-xs text-amber-600">Vượt tồn kho hiện tại ({prod.stock_qty}).</p>}
                  </td>
                  <td className="p-2"><Input type="number" min={1} step={1} className="text-right" value={l.qty} onChange={(e) => patchLine(l.uid, { qty: e.target.value })} /></td>
                  <td className="p-2"><Input type="number" min={0} step={1000} className="text-right" value={l.unit_price} onChange={(e) => patchLine(l.uid, { unit_price: e.target.value })} /></td>
                  <td className="p-2"><Input type="number" min={0} max={100} className="text-right" value={l.discount_pct} onChange={(e) => patchLine(l.uid, { discount_pct: e.target.value })} /></td>
                  <td className="p-2">
                    <select className={selectCls} value={l.tax_group} onChange={(e) => patchLine(l.uid, { tax_group: e.target.value })} aria-label="Nhóm ngành thuế">
                      <option value="">{prod ? `Theo sản phẩm (${taxGroups.find((g) => g.code === prod.tax_group)?.name_vi ?? prod.tax_group})` : "Theo hồ sơ HKD"}</option>
                      {taxGroups.map((g) => <option key={g.code} value={g.code}>{g.name_vi}</option>)}
                    </select>
                  </td>
                  <td className="p-2 text-right font-medium">{formatVND(totals.lineNets[i] ?? 0)}</td>
                  <td className="p-2">
                    <Button type="button" variant="ghost" size="icon" aria-label="Xóa dòng" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.uid !== l.uid))}><Trash2 className="h-4 w-4" /></Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="p-3"><Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, blankLine()])}><Plus className="mr-2 h-4 w-4" />Thêm dòng</Button></div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Thanh toán</h2>
            <div className="flex gap-2">
              {PAYMENT_METHODS.map((m) => <Button key={m} type="button" size="sm" variant="outline" disabled={totals.debt <= 0} onClick={() => payRest(m)}>Thu đủ · {METHOD_LABEL[m]}</Button>)}
            </div>
          </div>
          {pays.length === 0 && <p className="text-sm text-muted-foreground">Chưa nhập khoản thu nào{walkin ? " — khách lẻ phải thanh toán đủ." : " — toàn bộ sẽ ghi công nợ."}</p>}
          {pays.map((p) => (
            <div key={p.uid} className="grid grid-cols-[130px_1fr_1fr_40px] gap-2">
              <select className={selectCls} aria-label="Phương thức" value={p.method} onChange={(e) => patchPay(p.uid, { method: e.target.value as PaymentMethod })}>
                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
              </select>
              <Input type="number" min={1} step={1} aria-label="Số tiền" className="text-right" value={p.amount} onChange={(e) => patchPay(p.uid, { amount: e.target.value })} />
              <Input aria-label="Ghi chú" placeholder="Ghi chú (vd: tài khoản nhận)" value={p.note} onChange={(e) => patchPay(p.uid, { note: e.target.value })} />
              <Button type="button" variant="ghost" size="icon" aria-label="Xóa khoản thu" onClick={() => setPays((ps) => ps.filter((x) => x.uid !== p.uid))}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setPays((ps) => [...ps, { uid: uid(), method: "cash", amount: "", note: "" }])}><Plus className="mr-2 h-4 w-4" />Thêm khoản thu</Button>
          {totals.debt > 0 && !walkin && (
            <div className="space-y-2">
              <Label htmlFor="s-due">Hạn thanh toán công nợ</Label>
              <Input id="s-due" type="date" min={date} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          )}
        </Card>
        <Card className="space-y-2 p-4 text-sm">
          <div className="flex justify-between"><span>Tổng tiền (đã gồm thuế)</span><span className="text-base font-semibold">{formatVND(totals.total)}</span></div>
          <div className="flex justify-between"><span>Đã thu</span><span>{formatVND(totals.paid)}</span></div>
          <div className={`flex justify-between border-t pt-2 ${totals.debt > 0 && walkin ? "text-destructive" : ""}`}><span>{walkin ? "Còn thiếu" : "Ghi công nợ"}</span><span className="font-medium">{formatVND(totals.debt)}</span></div>
          {totals.over > 0 && <p className="text-destructive">Số tiền thu lớn hơn tổng tiền {formatVND(totals.over)}.</p>}
          {walkin && totals.debt > 0 && <p className="text-xs text-destructive">Khách lẻ phải thanh toán đủ. Chọn khách hàng có tên nếu muốn ghi công nợ.</p>}
          <p className="text-xs text-muted-foreground">Doanh thu ghi nhận = tổng tiền, không có VAT. Giá vốn lấy theo bình quân gia quyền. Số liệu được tính lại ở máy chủ.</p>
        </Card>
      </div>

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={showEinv} onChange={(e) => setShowEinv(e.target.checked)} />Đã xuất hóa đơn điện tử ở phần mềm khác — nhập số & mã tra cứu</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={showBuyer} onChange={(e) => setShowBuyer(e.target.checked)} />Khách yêu cầu thông tin người mua (tên/MST/địa chỉ)</label>
        </div>
        {showEinv && (
          <div className="grid gap-3 md:grid-cols-5">
            <div className="space-y-1"><Label htmlFor="e-sym">Ký hiệu</Label><Input id="e-sym" placeholder="C26TAA" value={einv.symbol} onChange={(e) => setEinv({ ...einv, symbol: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="e-num">Số hóa đơn</Label><Input id="e-num" value={einv.number} onChange={(e) => setEinv({ ...einv, number: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="e-code">Mã tra cứu</Label><Input id="e-code" value={einv.lookup_code} onChange={(e) => setEinv({ ...einv, lookup_code: e.target.value })} /></div>
            <div className="space-y-1 md:col-span-2"><Label htmlFor="e-url">Đường dẫn tra cứu</Label><Input id="e-url" placeholder="https://" value={einv.lookup_url} onChange={(e) => setEinv({ ...einv, lookup_url: e.target.value })} /></div>
          </div>
        )}
        {showBuyer && (
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1"><Label htmlFor="b-name">Tên người mua</Label><Input id="b-name" value={buyer.name} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="b-tax">Mã số thuế</Label><Input id="b-tax" value={buyer.tax_code} onChange={(e) => setBuyer({ ...buyer, tax_code: e.target.value })} /></div>
            <div className="space-y-1 md:col-span-2"><Label htmlFor="b-addr">Địa chỉ</Label><Input id="b-addr" value={buyer.address} onChange={(e) => setBuyer({ ...buyer, address: e.target.value })} /></div>
          </div>
        )}
        <div className="space-y-1"><Label htmlFor="s-memo">Ghi chú</Label><Input id="s-memo" value={memo} onChange={(e) => setMemo(e.target.value)} /></div>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || totals.total <= 0 || totals.over > 0 || (walkin && totals.debt > 0)}>{pending ? "Đang ghi…" : "Ghi đơn bán"}</Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>Hủy</Button>
      </div>
    </form>
  );
}
