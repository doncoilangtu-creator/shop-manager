import type { Customer, Product } from "@/types/db";

export interface PickerCustomer {
  id: string;
  name: string;
  type: "retail" | "business";
  phone: string | null;
  tax_code: string | null;
  address: string | null;
}

export interface PickerProduct {
  id: string;
  sku: string;
  name: string;
  sell_price: number;
  unit: string;
  stock_qty: number;
}

export interface LineRow {
  uid: string; // local React key
  product_id: string;
  qty: number;
  unit_price: number;
  discount: number; // %
  notes: string;
}

export function makeBlankLine(uid: string): LineRow {
  return {
    uid,
    product_id: "",
    qty: 1,
    unit_price: 0,
    discount: 0,
    notes: "",
  };
}

export type { Customer, Product };
