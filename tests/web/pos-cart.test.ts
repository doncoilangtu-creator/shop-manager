import { describe, expect, it } from "vitest";
import { canAddProductQty, cashChange, findProducts, resolveScanAdd, type PosProduct } from "@/lib/pos/cart";

const P = (over: Partial<PosProduct> & Pick<PosProduct, "id" | "sku" | "name">): PosProduct => ({
  sell_price: 100000,
  stock_qty: 5,
  tax_group: "dv",
  ...over,
});

const catalog: PosProduct[] = [
  P({ id: "a", sku: "RAM8G", name: "RAM DDR4 8GB", stock_qty: 3 }),
  P({ id: "b", sku: "SSD512", name: "SSD 512GB", stock_qty: 0 }),
  P({ id: "c", sku: "KB-01", name: "Bàn phím cơ", stock_qty: 10 }),
];

describe("pos cart helpers", () => {
  it("findProducts prioritizes exact SKU then contains", () => {
    expect(findProducts(catalog, "RAM8G")[0].sku).toBe("RAM8G");
    expect(findProducts(catalog, "ssd").map((p) => p.sku)).toEqual(["SSD512"]);
    expect(findProducts(catalog, "bàn").map((p) => p.sku)).toEqual(["KB-01"]);
  });

  it("resolveScanAdd: exact SKU or single hit", () => {
    expect(resolveScanAdd(catalog, "RAM8G")?.id).toBe("a");
    expect(resolveScanAdd(catalog, "RAM")?.id).toBe("a");
    expect(resolveScanAdd(catalog, "phím")?.id).toBe("c");
    expect(resolveScanAdd(catalog, "")).toBeNull();
  });

  it("blocks oversell and zero stock with Vietnamese messages", () => {
    expect(canAddProductQty(catalog[0], 2, 2)).toMatch(/Tồn kho không đủ/);
    expect(canAddProductQty(catalog[0], 1, 1)).toBeNull();
    expect(canAddProductQty(catalog[1], 0, 1)).toMatch(/Hết hàng/);
  });

  it("cashChange only when tendered > total", () => {
    expect(cashChange(200000, 150000)).toBe(50000);
    expect(cashChange(100000, 150000)).toBe(0);
  });
});
