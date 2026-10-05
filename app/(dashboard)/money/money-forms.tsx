"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeftRight, Pencil, Plus, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { postMoneyOpeningAction, reverseMoneyTransferAction, saveMoneyAccountAction, transferMoneyAction } from "@/lib/actions/money";
import { MONEY_KINDS, MONEY_KIND_LABEL, accountLabel, type MoneyKind } from "@/lib/money/schema";

const selectCls = "h-9 w-full rounded-md border bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60";

export type AccountRow = {
  id: string; kind: MoneyKind; label: string; provider: string | null; account_no_masked: string | null; holder: string | null;
  tax_notified: boolean; tax_notified_at: string | null; is_default: boolean; active: boolean;
};
export type AccountPick = { id: string; kind: MoneyKind; label: string; provider: string | null; account_no_masked: string | null };

function useSubmit() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string, done: () => void) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) { setError(res.error ?? "Có lỗi xảy ra"); toast.error(res.error ?? "Có lỗi xảy ra"); return; }
      toast.success(okMsg);
      done();
      router.refresh();
    });
  };
  return { error, setError, pending, run };
}

/** Thêm / sửa tài khoản tiền (chủ hộ). */
export function AccountDialog({ account, trigger }: { account?: AccountRow; trigger: "new" | "edit" }) {
  const { error, setError, pending, run } = useSubmit();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<MoneyKind>(account?.kind ?? "bank");
  const [tn, setTn] = useState(account?.tax_notified ?? false);
  const [def, setDef] = useState(account?.is_default ?? false);
  const [active, setActive] = useState(account?.active ?? true);
  const isNew = !account;
  const cash = kind === "cash";

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "");
    run(() => saveMoneyAccountAction({
      id: account?.id ?? null, kind, label: s("label"), provider: s("provider"), account_no: s("account_no"), holder: s("holder"),
      tax_notified: !cash && tn, tax_notified_at: !cash && tn ? s("tax_notified_at") : "", is_default: def, active,
    }), isNew ? "Đã thêm tài khoản" : "Đã lưu tài khoản", () => setOpen(false));
  };

  return (
    <>
      {trigger === "new"
        ? <Button size="sm" onClick={() => { setOpen(true); setError(null); }}><Plus className="mr-2 h-4 w-4" />Thêm tài khoản</Button>
        : <Button size="sm" variant="ghost" aria-label={`Sửa ${account?.label}`} onClick={() => { setOpen(true); setError(null); }}><Pencil className="h-4 w-4" /></Button>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={submit} className="space-y-3">
            <DialogHeader>
              <DialogTitle>{isNew ? "Thêm tài khoản tiền" : "Sửa tài khoản tiền"}</DialogTitle>
              <DialogDescription>Hệ thống chỉ lưu 4 số cuối của số tài khoản để hiển thị. Không nhập mật khẩu/OTP ngân hàng.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1">
              <Label htmlFor="ma-kind">Loại</Label>
              <select id="ma-kind" className={selectCls} value={kind} disabled={!isNew} onChange={(e) => setKind(e.target.value as MoneyKind)}>
                {MONEY_KINDS.map((k) => <option key={k} value={k}>{MONEY_KIND_LABEL[k]}</option>)}
              </select>
            </div>
            <div className="space-y-1"><Label htmlFor="ma-label">Tên hiển thị *</Label><Input id="ma-label" name="label" required maxLength={80} defaultValue={account?.label ?? ""} placeholder="vd: Quỹ tiền mặt, MB Bank chính" /></div>
            {!cash && (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1"><Label htmlFor="ma-prov">Ngân hàng / nhà cung cấp ví</Label><Input id="ma-prov" name="provider" maxLength={80} defaultValue={account?.provider ?? ""} placeholder="vd: Vietcombank, MoMo" /></div>
                  <div className="space-y-1"><Label htmlFor="ma-no">Số tài khoản</Label><Input id="ma-no" name="account_no" inputMode="numeric" autoComplete="off" placeholder={account?.account_no_masked ? `Đang lưu ${account.account_no_masked} — nhập để thay` : "chỉ lưu 4 số cuối"} /></div>
                </div>
                <div className="space-y-1"><Label htmlFor="ma-holder">Chủ tài khoản</Label><Input id="ma-holder" name="holder" maxLength={120} defaultValue={account?.holder ?? ""} /></div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={tn} onChange={(e) => setTn(e.target.checked)} />Đã thông báo số tài khoản cho cơ quan thuế (mẫu 01/BK-STK)</label>
                {tn && <div className="space-y-1"><Label htmlFor="ma-tna">Ngày thông báo</Label><Input id="ma-tna" name="tax_notified_at" type="date" defaultValue={account?.tax_notified_at ?? ""} /></div>}
              </>
            )}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={def} onChange={(e) => setDef(e.target.checked)} />Tài khoản mặc định cho {cash ? "tiền mặt" : "chuyển khoản / ví"} (dùng khi không chọn tài khoản)</label>
            {!isNew && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Đang sử dụng</label>}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter><Button type="submit" disabled={pending}>{pending ? "Đang lưu…" : "Lưu"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Nhập số dư đầu kỳ (chủ hộ). */
export function OpeningDialog({ accounts, today }: { accounts: AccountPick[]; today: string }) {
  const { error, setError, pending, run } = useSubmit();
  const [open, setOpen] = useState(false);
  const [acc, setAcc] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [memo, setMemo] = useState("");
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => { setOpen(true); setError(null); }}><Wallet className="mr-2 h-4 w-4" />Số dư đầu kỳ</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={(e) => { e.preventDefault(); run(() => postMoneyOpeningAction({ account_id: acc, amount, date, memo }), "Đã ghi số dư đầu kỳ", () => { setOpen(false); setAmount(""); setMemo(""); }); }} className="space-y-3">
            <DialogHeader>
              <DialogTitle>Số dư đầu kỳ</DialogTitle>
              <DialogDescription>Ghi số tiền đang có ở tài khoản khi bắt đầu dùng phần mềm (Nợ 111/112 — Có 411 Vốn chủ sở hữu). Chỉ nhập một lần cho mỗi tài khoản — nhập lại sẽ cộng thêm; sai thì liên hệ kế toán để điều chỉnh.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1"><Label htmlFor="op-acc">Tài khoản</Label>
              <select id="op-acc" required className={selectCls} value={acc} onChange={(e) => setAcc(e.target.value)}>
                <option value="">— Chọn —</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
              </select></div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1"><Label htmlFor="op-amt">Số tiền (đ)</Label><Input id="op-amt" type="number" min={1} step={1} required value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="op-date">Ngày</Label><Input id="op-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></div>
            </div>
            <div className="space-y-1"><Label htmlFor="op-memo">Ghi chú</Label><Input id="op-memo" value={memo} onChange={(e) => setMemo(e.target.value)} /></div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter><Button type="submit" disabled={pending}>{pending ? "Đang ghi…" : "Ghi số dư"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Chuyển tiền nội bộ. */
export function TransferDialog({ accounts, today }: { accounts: AccountPick[]; today: string }) {
  const { error, setError, pending, run } = useSubmit();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [memo, setMemo] = useState("");
  const opts = (
    <>
      <option value="">— Chọn —</option>
      {accounts.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
    </>
  );
  return (
    <>
      <Button size="sm" onClick={() => { setOpen(true); setError(null); }} disabled={accounts.length < 2}><ArrowLeftRight className="mr-2 h-4 w-4" />Chuyển tiền nội bộ</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={(e) => { e.preventDefault(); run(() => transferMoneyAction({ from, to, amount, date, memo }), "Đã ghi phiếu chuyển tiền", () => { setOpen(false); setAmount(""); setMemo(""); }); }} className="space-y-3">
            <DialogHeader>
              <DialogTitle>Chuyển tiền nội bộ</DialogTitle>
              <DialogDescription>Nộp tiền mặt vào ngân hàng, rút tiền, chuyển giữa ngân hàng và ví. Không phải doanh thu hay chi phí.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1"><Label htmlFor="tr-from">Từ tài khoản</Label><select id="tr-from" required className={selectCls} value={from} onChange={(e) => setFrom(e.target.value)}>{opts}</select></div>
            <div className="space-y-1"><Label htmlFor="tr-to">Đến tài khoản</Label><select id="tr-to" required className={selectCls} value={to} onChange={(e) => setTo(e.target.value)}>{opts}</select></div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1"><Label htmlFor="tr-amt">Số tiền (đ)</Label><Input id="tr-amt" type="number" min={1} step={1} required value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="tr-date">Ngày</Label><Input id="tr-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></div>
            </div>
            <div className="space-y-1"><Label htmlFor="tr-memo">Ghi chú</Label><Input id="tr-memo" value={memo} onChange={(e) => setMemo(e.target.value)} /></div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter><Button type="submit" disabled={pending}>{pending ? "Đang ghi…" : "Xác nhận"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ReverseTransferButton({ transferId }: { transferId: string }) {
  const { error, pending, run } = useSubmit();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) return <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Hủy</Button>;
  return (
    <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); run(() => reverseMoneyTransferAction(transferId, reason), "Đã hủy phiếu chuyển tiền", () => setOpen(false)); }}>
      <Input aria-label="Lý do hủy" placeholder="Lý do hủy" required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} className="h-8 w-40" />
      <Button size="sm" type="submit" disabled={pending}>Xác nhận</Button>
      <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)}>Đóng</Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </form>
  );
}
