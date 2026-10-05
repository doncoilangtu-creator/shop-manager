"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Minus, Plus, Search, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSaleAction } from "@/lib/actions/sales";
import {
  canAddProductQty,
  cashChange,
  cartTotals,
  findProducts,
  lineAmount,
  resolveScanAdd,
  type PosCartLine,
  type PosProduct,
} from "@/lib/pos/cart";
import { accountLabel, methodOfKind, type MoneyAccountOption } from "@/lib/money/schema";
import { formatVND } from "@/lib/utils";
import { cn } from "@/lib/utils";

export type PosCustomer = { id: string; name: string; phone: string | null };

let seq = 0;
const uid = () => `c${++seq}`;

type Success = { invoice_id: string; invoice_no: string; total: number; change: number };

export function PosClient({
  products,
  customers,
  accounts,
}: {
  products: PosProduct[];
  customers: PosCustomer[];
  accounts: MoneyAccountOption[];
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<PosCartLine[]>([]);
  const [accountId, setAccountId] = useState(() => accounts.find((a) => a.is_default && a.kind === "cash")?.id ?? accounts.find((a) => a.kind === "cash")?.id ?? accounts.find((a) => a.is_default)?.id ?? accounts[0]?.id ?? "");
  const [customerId, setCustomerId] = useState("");
  const [memo, setMemo] = useState("");
  const [tendered, setTendered] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<Success | null>(null);
  const [serviceOpen, setServiceOpen] = useState(false);
  const [serviceDesc, setServiceDesc] = useState("");
  const [servicePrice, setServicePrice] = useState("");

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const listed = useMemo(() => findProducts(products, query, 48), [products, query]);
  const totals = useMemo(() => cartTotals(cart), [cart]);
  const selectedAccount = accounts.find((a) => a.id === accountId);
  const payMethod = selectedAccount ? methodOfKind(selectedAccount.kind) : "cash";
  const isCash = payMethod === "cash";
  const change = isCash ? cashChange(Number(tendered) || totals.total, totals.total) : 0;

  const focusSearch = useCallback(() => {
    searchRef.current?.focus();
    searchRef.current?.select();
  }, []);

  useEffect(() => {
    focusSearch();
  }, [focusSearch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        focusSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusSearch]);

  const qtyInCart = (productId: string) => cart.filter((l) => l.product_id === productId).reduce((a, l) => a + l.qty, 0);

  const addProduct = (p: PosProduct, addQty = 1) => {
    setError(null);
    setSuccess(null);
    const err = canAddProductQty(p, qtyInCart(p.id), addQty);
    if (err) {
      setError(err);
      toast.error(err);
      return;
    }
    setCart((prev) => {
      const existing = prev.find((l) => l.product_id === p.id);
      if (existing) {
        return prev.map((l) => (l.uid === existing.uid ? { ...l, qty: l.qty + addQty } : l));
      }
      return [
        ...prev,
        {
          uid: uid(),
          product_id: p.id,
          description: p.name,
          qty: addQty,
          unit_price: Number(p.sell_price) || 0,
          stock_qty: p.stock_qty,
        },
      ];
    });
    setQuery("");
    focusSearch();
  };

  const setQty = (lineUid: string, qty: number) => {
    setError(null);
    setCart((prev) => {
      const line = prev.find((l) => l.uid === lineUid);
      if (!line) return prev;
      if (qty <= 0) return prev.filter((l) => l.uid !== lineUid);
      if (line.product_id) {
        const p = byId.get(line.product_id);
        if (p) {
          const others = prev.filter((l) => l.uid !== lineUid && l.product_id === p.id).reduce((a, l) => a + l.qty, 0);
          const err = canAddProductQty(p, others, qty);
          if (err) {
            setError(err);
            toast.error(err);
            return prev;
          }
          return prev.map((l) => (l.uid === lineUid ? { ...l, qty, stock_qty: p.stock_qty } : l));
        }
      }
      return prev.map((l) => (l.uid === lineUid ? { ...l, qty } : l));
    });
  };

  const addService = () => {
    const desc = serviceDesc.trim();
    const price = Number(servicePrice);
    if (!desc) {
      toast.error("Nhập mô tả dịch vụ");
      return;
    }
    if (!(price >= 0) || Number.isNaN(price)) {
      toast.error("Đơn giá không hợp lệ");
      return;
    }
    setCart((prev) => [
      ...prev,
      { uid: uid(), product_id: null, description: desc, qty: 1, unit_price: price, stock_qty: null },
    ]);
    setServiceDesc("");
    setServicePrice("");
    setServiceOpen(false);
    setError(null);
    focusSearch();
  };

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setQuery("");
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const hit = resolveScanAdd(products, query);
      if (hit) {
        addProduct(hit, 1);
        return;
      }
      if (listed.length === 1) {
        addProduct(listed[0], 1);
        return;
      }
      if (query.trim()) toast.message("Chọn sản phẩm trong danh sách hoặc quét đúng mã SKU");
    }
  };

  const clearCart = () => {
    setCart([]);
    setMemo("");
    setTendered("");
    setError(null);
    focusSearch();
  };

  const checkout = () => {
    setError(null);
    setSuccess(null);
    if (cart.length === 0) {
      setError("Giỏ hàng trống");
      toast.error("Giỏ hàng trống");
      return;
    }
    for (const l of cart) {
      if (!l.product_id) continue;
      const p = byId.get(l.product_id);
      if (!p) {
        setError("Không tìm thấy sản phẩm trong giỏ");
        return;
      }
      const err = canAddProductQty(p, 0, l.qty);
      if (err) {
        setError(err);
        toast.error(err);
        return;
      }
    }
    if (!accountId) {
      setError("Chọn tài khoản thu tiền (Tiền mặt / VCB / MoMo…)");
      toast.error("Chọn tài khoản thu tiền");
      return;
    }
    const payAmount = totals.total;
    if (isCash && tendered.trim() !== "") {
      const t = Number(tendered);
      if (!(t >= payAmount)) {
        setError("Tiền khách đưa phải ≥ tổng đơn");
        toast.error("Tiền khách đưa phải ≥ tổng đơn");
        return;
      }
    }
    start(async () => {
      const res = await createSaleAction({
        customer_id: customerId || null,
        channel: "store",
        memo: memo || null,
        lines: cart.map((l) => ({
          product_id: l.product_id,
          description: l.product_id ? null : l.description,
          qty: l.qty,
          unit_price: l.unit_price,
          discount_pct: 0,
          tax_group: null,
        })),
        payments: [
          {
            method: payMethod,
            amount: payAmount,
            note: null,
            money_account_id: accountId || null,
          },
        ],
      });
      if (!res.ok) {
        setError(res.error);
        toast.error(res.error);
        return;
      }
      const ch = isCash ? cashChange(Number(tendered) || payAmount, res.data.total) : 0;
      setSuccess({
        invoice_id: res.data.invoice_id,
        invoice_no: res.data.invoice_no,
        total: res.data.total,
        change: ch,
      });
      toast.success(`Đã thu · ${res.data.invoice_no}`);
      setCart([]);
      setMemo("");
      setTendered("");
      setQuery("");
      focusSearch();
    });
  };

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col gap-4 lg:flex-row">
      {/* Trái: tìm + lưới SP */}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <Zap className="h-6 w-6 text-amber-500" />
              Bán nhanh
            </h1>
            <p className="text-sm text-muted-foreground">Quét mã / gõ tên → Enter thêm vào giỏ · F2 tìm lại · Thu tiền một bước</p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/sales/new">Form bán đầy đủ</Link>
          </Button>
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKey}
              placeholder="Quét barcode / SKU hoặc gõ tên — Enter thêm"
              className="h-12 pl-10 text-base"
              autoComplete="off"
              aria-label="Tìm sản phẩm"
            />
          </div>
          <Button type="button" variant="secondary" className="h-12 px-4" onClick={focusSearch} title="F2">
            F2
          </Button>
          <Button type="button" variant="outline" className="h-12" onClick={() => setServiceOpen((v) => !v)}>
            Dịch vụ
          </Button>
        </div>

        {serviceOpen && (
          <Card className="flex flex-wrap items-end gap-2 p-3">
            <div className="min-w-[200px] flex-1 space-y-1">
              <Label htmlFor="svc-desc">Mô tả dịch vụ (không trừ kho)</Label>
              <Input id="svc-desc" value={serviceDesc} onChange={(e) => setServiceDesc(e.target.value)} placeholder="vd: Công cài Windows" />
            </div>
            <div className="w-36 space-y-1">
              <Label htmlFor="svc-price">Đơn giá</Label>
              <Input id="svc-price" type="number" min={0} step={1000} value={servicePrice} onChange={(e) => setServicePrice(e.target.value)} />
            </div>
            <Button type="button" onClick={addService}>
              Thêm dịch vụ
            </Button>
          </Card>
        )}

        <div className="grid flex-1 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 xl:grid-cols-4" style={{ maxHeight: "min(60vh, 560px)" }}>
          {listed.length === 0 && (
            <p className="col-span-full py-8 text-center text-sm text-muted-foreground">Không tìm thấy sản phẩm phù hợp.</p>
          )}
          {listed.map((p) => {
            const out = p.stock_qty <= 0;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => addProduct(p, 1)}
                className={cn(
                  "flex flex-col rounded-lg border p-3 text-left transition-colors hover:bg-accent",
                  out && "opacity-60",
                )}
              >
                <span className="line-clamp-2 text-sm font-medium leading-snug">{p.name}</span>
                <span className="mt-1 text-xs text-muted-foreground">{p.sku}</span>
                <span className="mt-auto pt-2 text-base font-semibold">{formatVND(p.sell_price)}</span>
                <span className={cn("text-xs", out ? "text-destructive" : "text-muted-foreground")}>
                  {out ? "Hết hàng" : `Tồn ${p.stock_qty}`}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Phải: giỏ + thu tiền */}
      <Card className="flex w-full shrink-0 flex-col lg:w-[380px] xl:w-[420px]">
        <div className="border-b p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Giỏ hàng ({cart.length})</h2>
            {cart.length > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={clearCart}>
                Xóa hết
              </Button>
            )}
          </div>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-3" style={{ maxHeight: "min(40vh, 320px)" }}>
          {cart.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Chưa có hàng — quét mã hoặc chọn sản phẩm.</p>}
          {cart.map((l) => (
            <div key={l.uid} className="rounded-md border p-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{l.description}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatVND(l.unit_price)}
                    {l.stock_qty != null ? ` · tồn ${l.stock_qty}` : " · dịch vụ"}
                  </div>
                </div>
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Xóa dòng" onClick={() => setCart((c) => c.filter((x) => x.uid !== l.uid))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <Button type="button" variant="outline" size="icon" className="h-9 w-9" aria-label="Giảm" onClick={() => setQty(l.uid, l.qty - 1)}>
                    <Minus className="h-4 w-4" />
                  </Button>
                  <Input
                    type="number"
                    min={1}
                    className="h-9 w-14 text-center"
                    value={l.qty}
                    onChange={(e) => setQty(l.uid, Math.max(1, Number(e.target.value) || 1))}
                  />
                  <Button type="button" variant="outline" size="icon" className="h-9 w-9" aria-label="Tăng" onClick={() => setQty(l.uid, l.qty + 1)}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <div className="font-semibold">{formatVND(lineAmount(l))}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-3 border-t p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-muted-foreground">Tổng cộng</span>
            <span className="text-2xl font-bold tabular-nums">{formatVND(totals.total)}</span>
          </div>

          <div className="space-y-1">
            <Label htmlFor="pos-pay">Thu vào tài khoản</Label>
            <select
              id="pos-pay"
              className="h-11 w-full rounded-md border bg-background px-2 text-sm"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              {accounts.length === 0 && <option value="">Chưa có tài khoản tiền</option>}
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {accountLabel(a)}
                  {a.kind === "cash" ? " (TM)" : a.kind === "ewallet" ? " (Ví)" : " (NH)"}
                </option>
              ))}
            </select>
          </div>

          {isCash && (
            <div className="space-y-1">
              <Label htmlFor="pos-tender">Tiền khách đưa (tuỳ chọn — tính tiền thừa)</Label>
              <Input
                id="pos-tender"
                type="number"
                min={0}
                step={1000}
                className="h-11"
                value={tendered}
                onChange={(e) => setTendered(e.target.value)}
                placeholder={String(totals.total || "")}
              />
              {change > 0 && (
                <p className="text-sm font-medium text-green-700">
                  Tiền thừa: {formatVND(change)}
                </p>
              )}
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="pos-customer">Khách hàng</Label>
            <select
              id="pos-customer"
              className="h-10 w-full rounded-md border bg-background px-2 text-sm"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              <option value="">Khách lẻ (phải thu đủ)</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.phone ? ` · ${c.phone}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="pos-memo">Ghi chú</Label>
            <Input id="pos-memo" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Tuỳ chọn" />
          </div>

          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

          {success && (
            <div className="rounded-md border border-green-600/40 bg-green-50 px-3 py-3 text-sm dark:bg-green-950/30">
              <p className="font-semibold text-green-800 dark:text-green-300">Thu thành công · {success.invoice_no}</p>
              <p>Tổng: {formatVND(success.total)}</p>
              {success.change > 0 && <p>Tiền thừa: {formatVND(success.change)}</p>}
              <Link className="mt-1 inline-block underline" href={`/sales/${success.invoice_id}`}>
                Xem đơn
              </Link>
            </div>
          )}

          <Button
            type="button"
            className="h-14 w-full text-lg font-semibold"
            disabled={pending || cart.length === 0}
            onClick={checkout}
          >
            {pending ? "Đang ghi…" : "Thu tiền"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
