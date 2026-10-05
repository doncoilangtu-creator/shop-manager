/**
 * Helpers cho màn Bán nhanh (POS): tìm SP theo SKU/barcode/tên, kiểm tra tồn, tính tiền thừa.
 * Ghi sổ vẫn qua createSaleAction → post_sale_hkd; không tự tính số liệu chính thức.
 */
import { computeSaleTotals, lineNet } from "@/lib/sales/schema";

export type PosProduct = {
  id: string;
  sku: string;
  name: string;
  sell_price: number;
  stock_qty: number;
  tax_group: string;
};

export type PosCartLine = {
  uid: string;
  product_id: string | null;
  description: string;
  qty: number;
  unit_price: number;
  stock_qty: number | null; // null = dòng dịch vụ (không trừ kho)
};

export function normalizeSearch(q: string): string {
  return q.trim().toLowerCase();
}

/** Ưu tiên khớp SKU/barcode chính xác, rồi SKU chứa, rồi tên chứa. */
export function findProducts(products: PosProduct[], query: string, limit = 40): PosProduct[] {
  const q = normalizeSearch(query);
  if (!q) {
    return [...products]
      .sort((a, b) => {
        const sa = a.stock_qty > 0 ? 0 : 1;
        const sb = b.stock_qty > 0 ? 0 : 1;
        if (sa !== sb) return sa - sb;
        return a.name.localeCompare(b.name, "vi");
      })
      .slice(0, limit);
  }
  const exact: PosProduct[] = [];
  const skuHit: PosProduct[] = [];
  const nameHit: PosProduct[] = [];
  for (const p of products) {
    const sku = p.sku.toLowerCase();
    const name = p.name.toLowerCase();
    if (sku === q) exact.push(p);
    else if (sku.includes(q)) skuHit.push(p);
    else if (name.includes(q)) nameHit.push(p);
  }
  return [...exact, ...skuHit, ...nameHit].slice(0, limit);
}

/** Enter trên ô tìm: thêm 1 nếu khớp đúng 1 SKU, hoặc đúng 1 kết quả duy nhất. */
export function resolveScanAdd(products: PosProduct[], query: string): PosProduct | null {
  const q = normalizeSearch(query);
  if (!q) return null;
  const exact = products.find((p) => p.sku.toLowerCase() === q);
  if (exact) return exact;
  const hits = findProducts(products, q, 5);
  return hits.length === 1 ? hits[0] : null;
}

export function canAddProductQty(
  product: PosProduct,
  alreadyInCart: number,
  addQty: number,
): string | null {
  if (addQty <= 0) return "Số lượng phải > 0";
  const need = alreadyInCart + addQty;
  if (product.stock_qty <= 0) {
    return `Hết hàng: ${product.sku} (tồn 0). Thêm dòng dịch vụ nếu đây là công/dịch vụ không trừ kho.`;
  }
  if (need > product.stock_qty) {
    return `Tồn kho không đủ: ${product.sku} (còn ${product.stock_qty}, cần ${need}).`;
  }
  return null;
}

export function cartTotals(lines: PosCartLine[]) {
  return computeSaleTotals(
    lines.map((l) => ({ qty: l.qty, unit_price: l.unit_price, discount_pct: 0 })),
    [],
  );
}

export function lineAmount(l: PosCartLine): number {
  return lineNet({ qty: l.qty, unit_price: l.unit_price, discount_pct: 0 });
}

/** Tiền thừa khi khách đưa tiền mặt (chỉ hiển thị; RPC vẫn nhận đúng tổng đơn). */
export function cashChange(tendered: number, total: number): number {
  const t = Number(tendered) || 0;
  const tot = Number(total) || 0;
  return Math.max(0, Math.round((t - tot) * 100) / 100);
}
