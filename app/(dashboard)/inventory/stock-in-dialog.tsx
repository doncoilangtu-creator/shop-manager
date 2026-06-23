"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowDownToLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { stockIn } from "@/lib/actions/inventory";

interface ProductLite {
  id: string;
  sku: string;
  name: string;
  stock_qty: number;
}

interface Props {
  products: ProductLite[];
}

export function StockInDialog({ products }: Props) {
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState<string>("");
  const [qty, setQty] = useState<string>("");
  const [unitCost, setUnitCost] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setProductId("");
    setQty("");
    setUnitCost("");
    setNotes("");
    setError(null);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const fd = new FormData();
    fd.set("product_id", productId);
    fd.set("qty", qty);
    fd.set("unit_cost", unitCost);
    fd.set("notes", notes);

    startTransition(async () => {
      const res = await stockIn(fd);
      if (!res.ok) {
        setError(res.error);
        toast.error(res.error);
        return;
      }
      toast.success(`Đã nhập kho thành công`);
      reset();
      setOpen(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <ArrowDownToLine className="mr-2 h-4 w-4" />
          Nhập kho nhanh
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nhập kho nhanh</DialogTitle>
          <DialogDescription>
            Cộng thêm số lượng tồn và ghi vào lịch sử stock_movements.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="product_id">Sản phẩm</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger id="product_id">
                <SelectValue placeholder="Chọn sản phẩm…" />
              </SelectTrigger>
              <SelectContent>
                {products.length === 0 ? (
                  <SelectItem value="__none__" disabled>
                    Chưa có sản phẩm
                  </SelectItem>
                ) : (
                  products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="font-mono text-xs text-muted-foreground">
                        {p.sku}
                      </span>{" "}
                      — {p.name} (tồn {p.stock_qty})
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="qty">Số lượng</Label>
              <Input
                id="qty"
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="10"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="unit_cost">Giá nhập (đ)</Label>
              <Input
                id="unit_cost"
                type="number"
                min={0}
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Ghi chú</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="VD: nhập từ NCC XYZ, hóa đơn 001…"
              rows={2}
            />
          </div>
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Hủy
            </Button>
            <Button type="submit" disabled={pending || !productId || !qty}>
              {pending ? "Đang lưu…" : "Nhập kho"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
