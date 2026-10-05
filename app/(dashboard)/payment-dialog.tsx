"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Banknote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { paySupplier, receiveCustomerPayment } from "@/lib/actions/accounting";
import { formatVND } from "@/lib/utils";
import { MoneyAccountSelect } from "@/components/money/account-select";
import type { MoneyAccountOption } from "@/lib/money/schema";

export function PaymentDialog({ kind, partnerId, outstanding, accounts = [] }: { kind: "receipt" | "disbursement"; partnerId: string; outstanding: number; accounts?: MoneyAccountOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "bank">("cash");
  const [accountId, setAccountId] = useState("");
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const title = kind === "receipt" ? "Thu tiền khách hàng" : "Chi tiền nhà cung cấp";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const fd = new FormData();
    fd.set("partner_id", partnerId);
    fd.set("amount", amount);
    fd.set("method", method);
    fd.set("money_account_id", accountId);
    fd.set("memo", memo);
    startTransition(async () => {
      const res = await (kind === "receipt" ? receiveCustomerPayment(fd) : paySupplier(fd));
      if (!res.ok) { setError(res.error); toast.error(res.error); return; }
      toast.success(`Đã ghi ${res.data.payment_no}` + (res.data.unapplied > 0 ? ` (dư ${formatVND(res.data.unapplied)} chưa phân bổ)` : ""));
      setOpen(false); setAmount(""); setMemo("");
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setAmount(outstanding > 0 ? String(outstanding) : ""); setError(null); } }}>
      <DialogTrigger asChild>
        <Button size="sm"><Banknote className="mr-2 h-4 w-4" />{kind === "receipt" ? "Thu tiền" : "Chi tiền"}</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>Tự trừ vào chứng từ cũ nhất trước. Còn nợ: {formatVND(outstanding)}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="pay-amount">Số tiền (đ)</Label>
            <Input id="pay-amount" type="number" min={1} step="1" required value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pay-method">Hình thức</Label>
            <select id="pay-method" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={method} onChange={(e) => { setMethod(e.target.value as "cash" | "bank"); setAccountId(""); }}>
              <option value="cash">Tiền mặt</option>
              <option value="bank">Chuyển khoản</option>
            </select>
          </div>
          {accounts.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="pay-account">Tài khoản {kind === "receipt" ? "nhận tiền" : "chi tiền"}</Label>
              <MoneyAccountSelect id="pay-account" accounts={accounts} method={method} value={accountId} onChange={setAccountId} />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="pay-memo">Ghi chú</Label>
            <Input id="pay-memo" value={memo} onChange={(e) => setMemo(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter><Button type="submit" disabled={pending}>{pending ? "Đang ghi…" : "Xác nhận"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
