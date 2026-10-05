"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cancelEinvoiceAction, recordEinvoiceAction, returnSaleAction, voidSaleAction, voidSaleReturnAction } from "@/lib/actions/sales";
import type { ActionResult } from "@/lib/actions/_shared";
import { formatVND } from "@/lib/utils";

const selectCls = "h-9 w-full rounded-md border bg-background px-2 text-sm";

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionResult<unknown>>, ok: string, after?: () => void) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) { setError(res.error); toast.error(res.error); return; }
      toast.success(ok);
      after?.();
      router.refresh();
    });
  };
  return { pending, error, run };
}

function askReason(message: string): string | null {
  const r = window.prompt(message);
  return r && r.trim().length >= 3 ? r.trim() : null;
}

export function VoidSaleButton({ saleId }: { saleId: string }) {
  const { pending, run } = useAct();
  return (
    <Button variant="outline" size="sm" disabled={pending} onClick={() => {
      const reason = askReason("Lý do hủy đơn (hoàn kho, đảo bút toán; chỉ dùng khi nhập sai):");
      if (reason) run(() => voidSaleAction(saleId, reason), "Đã hủy đơn bán");
    }}>Hủy đơn</Button>
  );
}

export function VoidReturnButton({ saleId, returnId }: { saleId: string; returnId: string }) {
  const { pending, run } = useAct();
  return (
    <Button variant="ghost" size="sm" disabled={pending} onClick={() => {
      const reason = askReason("Lý do hủy phiếu trả hàng:");
      if (reason) run(() => voidSaleReturnAction(saleId, returnId, reason), "Đã hủy phiếu trả hàng");
    }}>Hủy phiếu</Button>
  );
}

export function CancelEinvoiceButton({ saleId, einvoiceId }: { saleId: string; einvoiceId: string }) {
  const { pending, run } = useAct();
  return (
    <Button variant="outline" size="sm" disabled={pending} onClick={() => {
      const reason = askReason("Lý do hủy hóa đơn điện tử (đã hủy/điều chỉnh ở hệ thống hóa đơn):");
      if (reason) run(() => cancelEinvoiceAction(saleId, einvoiceId, reason), "Đã đánh dấu hủy hóa đơn điện tử");
    }}>Đánh dấu đã hủy</Button>
  );
}

export function EinvoiceForm({ saleId, hasActive }: { saleId: string; hasActive: boolean }) {
  const { pending, error, run } = useAct();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ symbol: "", number: "", lookup_code: "", lookup_url: "", provider: "", issued_on: "" });
  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)}>{hasActive ? "Ghi hóa đơn thay thế" : "Nhập số hóa đơn điện tử"}</Button>;
  return (
    <form className="space-y-2 rounded-md border p-3" onSubmit={(e) => {
      e.preventDefault();
      run(() => recordEinvoiceAction(saleId, { ...v, kind: hasActive ? "replace" : "original" }), "Đã lưu hóa đơn điện tử", () => { setOpen(false); setV({ symbol: "", number: "", lookup_code: "", lookup_url: "", provider: "", issued_on: "" }); });
    }}>
      <div className="grid gap-2 md:grid-cols-3">
        <div className="space-y-1"><Label htmlFor="ei-sym">Ký hiệu</Label><Input id="ei-sym" placeholder="C26TAA" value={v.symbol} onChange={(e) => setV({ ...v, symbol: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="ei-num">Số hóa đơn *</Label><Input id="ei-num" required value={v.number} onChange={(e) => setV({ ...v, number: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="ei-date">Ngày lập</Label><Input id="ei-date" type="date" value={v.issued_on} onChange={(e) => setV({ ...v, issued_on: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="ei-code">Mã tra cứu</Label><Input id="ei-code" value={v.lookup_code} onChange={(e) => setV({ ...v, lookup_code: e.target.value })} /></div>
        <div className="space-y-1 md:col-span-2"><Label htmlFor="ei-url">Đường dẫn tra cứu</Label><Input id="ei-url" placeholder="https://" value={v.lookup_url} onChange={(e) => setV({ ...v, lookup_url: e.target.value })} /></div>
        <div className="space-y-1 md:col-span-3"><Label htmlFor="ei-prov">Nhà cung cấp hóa đơn</Label><Input id="ei-prov" value={v.provider} onChange={(e) => setV({ ...v, provider: e.target.value })} /></div>
      </div>
      {hasActive && <p className="text-xs text-muted-foreground">Bản đang hiệu lực sẽ chuyển sang “Đã bị thay thế”.</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2"><Button type="submit" size="sm" disabled={pending}>{pending ? "Đang lưu…" : "Lưu"}</Button><Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Đóng</Button></div>
    </form>
  );
}

export type ReturnLineInfo = { id: string; label: string; isGoods: boolean; qty: number; returnedQty: number; remainingAmount: number };

export function ReturnForm({ saleId, lines, today, walkin, outstanding }: { saleId: string; lines: ReturnLineInfo[]; today: string; walkin: boolean; outstanding: number }) {
  const { pending, error, run } = useAct();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState<"cash" | "bank">("cash");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [amount, setAmount] = useState<Record<string, string>>({});
  const open_ = lines.some((l) => l.remainingAmount > 0);
  if (!open_) return <p className="text-sm text-muted-foreground">Mọi dòng của đơn đã được trả/giảm hết.</p>;
  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Tạo phiếu trả hàng / giảm giá</Button>;

  const picked = lines.map((l) => ({ l, q: Number(qty[l.id] || 0), a: Number(amount[l.id] || 0) })).filter((x) => x.q > 0 || x.a > 0);
  return (
    <form className="space-y-3 rounded-md border p-3" onSubmit={(e) => {
      e.preventDefault();
      run(() => returnSaleAction({
        sale_id: saleId, date, reason,
        lines: picked.map((x) => ({ sale_line_id: x.l.id, qty: x.q, amount: x.a > 0 ? x.a : null })),
        // Hoàn tiền: để trống = hệ thống tự trừ công nợ của đơn trước, phần còn lại hoàn theo phương thức đã chọn
        refund_method: method,
      }), "Đã ghi phiếu trả hàng", () => { setOpen(false); setQty({}); setAmount({}); });
    }}>
      <p className="text-xs text-muted-foreground">
        Nhập số lượng trả (nhập lại kho theo giá vốn gốc) hoặc chỉ số tiền giảm giá (số lượng 0).{" "}
        {walkin ? "Khách lẻ: hoàn tiền trực tiếp." : `Hệ thống trừ vào công nợ còn lại của đơn trước (${formatVND(outstanding)}), phần còn lại hoàn tiền.`}
      </p>
      <div className="space-y-2">
        {lines.map((l) => (
          <div key={l.id} className="grid items-center gap-2 md:grid-cols-[1fr_120px_160px]">
            <span className="text-sm">{l.label} <span className="text-xs text-muted-foreground">(đã bán {l.qty}, đã trả {l.returnedQty}; còn {formatVND(l.remainingAmount)})</span></span>
            <Input type="number" min={0} max={l.qty - l.returnedQty} step={1} disabled={!l.isGoods || l.qty - l.returnedQty <= 0} aria-label={`Số lượng trả ${l.label}`} placeholder="SL trả" value={qty[l.id] ?? ""} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} />
            <Input type="number" min={0} step={1} aria-label={`Số tiền ${l.label}`} placeholder="Số tiền (tự tính nếu bỏ trống)" value={amount[l.id] ?? ""} onChange={(e) => setAmount({ ...amount, [l.id]: e.target.value })} />
          </div>
        ))}
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        <div className="space-y-1"><Label htmlFor="rt-date">Ngày</Label><Input id="rt-date" type="date" value={date} min="2000-01-01" onChange={(e) => setDate(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="rt-method">Hoàn tiền bằng</Label>
          <select id="rt-method" className={selectCls} value={method} onChange={(e) => setMethod(e.target.value as "cash" | "bank")}><option value="cash">Tiền mặt</option><option value="bank">Chuyển khoản</option></select></div>
        <div className="space-y-1"><Label htmlFor="rt-reason">Lý do</Label><Input id="rt-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2"><Button type="submit" size="sm" disabled={pending || picked.length === 0}>{pending ? "Đang ghi…" : "Ghi phiếu trả hàng"}</Button><Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Đóng</Button></div>
    </form>
  );
}
