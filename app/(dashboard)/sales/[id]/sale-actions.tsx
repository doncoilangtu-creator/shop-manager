"use client";

import { useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cancelEinvoiceAction, recordEinvoiceAction, returnSaleAction, voidSaleAction, voidSaleReturnAction } from "@/lib/actions/sales";
import type { ActionResult } from "@/lib/actions/_shared";
import { formatVND } from "@/lib/utils";
import { MoneyAccountSelect } from "@/components/money/account-select";
import type { MoneyAccountOption } from "@/lib/money/schema";
import { einvoiceOriginalChoices, type EinvMode, type EinvoiceOption } from "@/lib/einvoice/originals";

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

const MODE_LABEL: Record<EinvMode, string> = { original: "Ghi mới", replace: "Thay thế", adjust: "Điều chỉnh" };
const EMPTY_EINV = { symbol: "", number: "", lookup_code: "", lookup_url: "", provider: "", issued_on: "", cqt_code: "", pdf_url: "", adjust_amount: "", adjust_reason: "", note: "" };
const einvLabel = (e: EinvoiceOption) => `${e.symbol ? `${e.symbol} · ` : ""}${e.number} (${e.status === "issued" ? "còn hiệu lực" : e.status === "cancelled" ? "đã hủy" : "đã bị thay thế"})`;

export function EinvoiceForm({ saleId, hasActive, invoices = [] }: { saleId: string; hasActive: boolean; invoices?: EinvoiceOption[] }) {
  const { pending, error, run } = useAct();
  const [open, setOpen] = useState(false);
  const initialMode: EinvMode = hasActive ? "replace" : "original";
  const [mode, setMode] = useState<EinvMode>(initialMode);
  const [v, setV] = useState(EMPTY_EINV);
  const choices = einvoiceOriginalChoices(invoices, mode);
  const [orig, setOrig] = useState<string>("");
  const origId = choices.some((c) => c.id === orig) ? orig : (choices[choices.length - 1]?.id ?? "");
  const pickMode = (m: EinvMode) => { setMode(m); setOrig(""); };
  const reset = () => { setOpen(false); setV(EMPTY_EINV); setMode(initialMode); setOrig(""); };
  const set = (k: keyof typeof EMPTY_EINV) => (e: ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  const needOrig = mode !== "original";

  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)}>{hasActive ? "Ghi hóa đơn thay thế / điều chỉnh" : "Nhập số hóa đơn điện tử"}</Button>;
  return (
    <form className="space-y-2 rounded-md border p-3" onSubmit={(e) => {
      e.preventDefault();
      if (needOrig && !origId) return void toast.error("Chọn hóa đơn gốc");
      const base = { symbol: v.symbol, number: v.number, lookup_code: v.lookup_code, lookup_url: v.lookup_url, provider: v.provider, issued_on: v.issued_on, cqt_code: v.cqt_code, pdf_url: v.pdf_url, note: v.note };
      const payload =
        mode === "original" ? { ...base, kind: "original" as const }
        : mode === "replace" ? { ...base, kind: "replace" as const, replaces_id: origId }
        : { ...base, kind: "adjust" as const, replaces_id: origId, adjust_amount: v.adjust_amount, adjust_reason: v.adjust_reason };
      run(() => recordEinvoiceAction(saleId, payload), mode === "original" ? "Đã lưu hóa đơn điện tử" : mode === "replace" ? "Đã lưu hóa đơn thay thế" : "Đã lưu hóa đơn điều chỉnh", reset);
    }}>
      <p className="text-xs text-muted-foreground">HĐĐT có bắt buộc hay không tùy Thuế cơ sở quản lý hộ kinh doanh. Hệ thống chỉ lưu thông tin hóa đơn do nhà cung cấp phát hành.</p>
      <div className="grid gap-2 md:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="ei-mode">Loại ghi nhận</Label>
          <select id="ei-mode" className={selectCls} value={mode} onChange={(e) => pickMode(e.target.value as EinvMode)}>
            {(Object.keys(MODE_LABEL) as EinvMode[]).map((m) => (
              <option key={m} value={m} disabled={m === "original" ? hasActive : einvoiceOriginalChoices(invoices, m).length === 0}>{MODE_LABEL[m]}</option>
            ))}
          </select>
        </div>
        {needOrig && (
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="ei-orig">{mode === "replace" ? "Hóa đơn gốc bị thay thế *" : "Hóa đơn gốc được điều chỉnh *"}</Label>
            <select id="ei-orig" className={selectCls} value={origId} onChange={(e) => setOrig(e.target.value)} required>
              {choices.length === 0 && <option value="">— Không có hóa đơn phù hợp —</option>}
              {choices.map((c) => <option key={c.id} value={c.id}>{einvLabel(c)}</option>)}
            </select>
          </div>
        )}
      </div>
      {mode === "adjust" && (
        <div className="grid gap-2 md:grid-cols-3">
          <div className="space-y-1"><Label htmlFor="ei-adj-amt">Số tiền điều chỉnh *</Label><Input id="ei-adj-amt" inputMode="decimal" placeholder="-50000 = giảm, 50000 = tăng" required value={v.adjust_amount} onChange={set("adjust_amount")} /></div>
          <div className="space-y-1 md:col-span-2"><Label htmlFor="ei-adj-reason">Lý do điều chỉnh *</Label><Input id="ei-adj-reason" required minLength={5} maxLength={500} value={v.adjust_reason} onChange={set("adjust_reason")} /></div>
        </div>
      )}
      <p className="text-xs font-medium">{mode === "original" ? "Thông tin hóa đơn" : mode === "replace" ? "Thông tin hóa đơn thay thế (mới)" : "Thông tin hóa đơn điều chỉnh"}</p>
      <div className="grid gap-2 md:grid-cols-3">
        <div className="space-y-1"><Label htmlFor="ei-sym">Ký hiệu</Label><Input id="ei-sym" placeholder="C26TAA" value={v.symbol} onChange={set("symbol")} /></div>
        <div className="space-y-1"><Label htmlFor="ei-num">Số hóa đơn *</Label><Input id="ei-num" required value={v.number} onChange={set("number")} /></div>
        <div className="space-y-1"><Label htmlFor="ei-date">Ngày lập</Label><Input id="ei-date" type="date" value={v.issued_on} onChange={set("issued_on")} /></div>
        <div className="space-y-1"><Label htmlFor="ei-cqt">Mã của cơ quan thuế</Label><Input id="ei-cqt" placeholder="Nếu là hóa đơn có mã" value={v.cqt_code} onChange={set("cqt_code")} /></div>
        <div className="space-y-1"><Label htmlFor="ei-code">Mã tra cứu</Label><Input id="ei-code" value={v.lookup_code} onChange={set("lookup_code")} /></div>
        <div className="space-y-1"><Label htmlFor="ei-prov">Nhà cung cấp hóa đơn</Label><Input id="ei-prov" value={v.provider} onChange={set("provider")} /></div>
        <div className="space-y-1 md:col-span-3 lg:col-span-1"><Label htmlFor="ei-url">Đường dẫn tra cứu</Label><Input id="ei-url" placeholder="https://" value={v.lookup_url} onChange={set("lookup_url")} /></div>
        <div className="space-y-1 md:col-span-3 lg:col-span-2"><Label htmlFor="ei-pdf">Đường dẫn PDF</Label><Input id="ei-pdf" placeholder="https://" value={v.pdf_url} onChange={set("pdf_url")} /></div>
      </div>
      {mode === "replace" && <p className="text-xs text-muted-foreground">Hóa đơn gốc còn hiệu lực sẽ chuyển sang “Đã bị thay thế”; hóa đơn gốc đã hủy giữ nguyên trạng thái.</p>}
      {mode === "adjust" && <p className="text-xs text-muted-foreground">Hóa đơn gốc vẫn còn hiệu lực; số tiền điều chỉnh chỉ để đối chiếu, không tự tạo bút toán (dùng “Hàng bán trả lại / giảm giá” để ghi sổ).</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2"><Button type="submit" size="sm" disabled={pending}>{pending ? "Đang lưu…" : "Lưu"}</Button><Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Đóng</Button></div>
    </form>
  );
}

export type ReturnLineInfo = { id: string; label: string; isGoods: boolean; qty: number; returnedQty: number; remainingAmount: number };

export function ReturnForm({ saleId, lines, today, walkin, outstanding, accounts = [] }: { saleId: string; lines: ReturnLineInfo[]; today: string; walkin: boolean; outstanding: number; accounts?: MoneyAccountOption[] }) {
  const { pending, error, run } = useAct();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState<"cash" | "bank">("cash");
  const [accountId, setAccountId] = useState("");
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
        refund_account_id: accountId || null,
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
      <div className="grid gap-2 md:grid-cols-4">
        <div className="space-y-1"><Label htmlFor="rt-date">Ngày</Label><Input id="rt-date" type="date" value={date} min="2000-01-01" onChange={(e) => setDate(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="rt-method">Hoàn tiền bằng</Label>
          <select id="rt-method" className={selectCls} value={method} onChange={(e) => { setMethod(e.target.value as "cash" | "bank"); setAccountId(""); }}><option value="cash">Tiền mặt</option><option value="bank">Chuyển khoản</option></select></div>
        {accounts.length > 0 && <div className="space-y-1"><Label htmlFor="rt-account">Hoàn từ tài khoản</Label><MoneyAccountSelect id="rt-account" accounts={accounts} method={method} value={accountId} onChange={setAccountId} /></div>}
        <div className="space-y-1"><Label htmlFor="rt-reason">Lý do</Label><Input id="rt-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2"><Button type="submit" size="sm" disabled={pending || picked.length === 0}>{pending ? "Đang ghi…" : "Ghi phiếu trả hàng"}</Button><Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Đóng</Button></div>
    </form>
  );
}
