import { describe, expect, it } from "vitest";
import {
  computeQuotationTotals,
  quotationFormSchema,
  round2,
} from "@/lib/quotations/schema";

const PID = "11111111-1111-4111-8111-111111111111";
const item = (over: Partial<Parameters<typeof computeQuotationTotals>[0]["items"][number]> = {}) => ({
  product_id: PID,
  qty: 1,
  unit_price: 100,
  discount: 0,
  ...over,
});

describe("computeQuotationTotals", () => {
  it("computes subtotal, VAT and total for a simple quote", () => {
    const r = computeQuotationTotals({
      items: [item({ qty: 2, unit_price: 1000 })],
      discount: 0,
      vat_rate: 10,
    });
    expect(r.subtotal).toBe(2000);
    expect(r.vat).toBe(200);
    expect(r.total).toBe(2200);
  });

  it("applies per-line percentage discount", () => {
    const r = computeQuotationTotals({
      items: [item({ qty: 2, unit_price: 1000, discount: 10 })],
      discount: 0,
      vat_rate: 0,
    });
    expect(r.lines[0].line_total).toBe(1800);
    expect(r.total).toBe(1800);
  });

  it("applies quotation-level discount before VAT", () => {
    const r = computeQuotationTotals({
      items: [item({ qty: 1, unit_price: 1000 })],
      discount: 100,
      vat_rate: 10,
    });
    expect(r.discount).toBe(100);
    expect(r.vat).toBe(90);
    expect(r.total).toBe(990);
  });

  it("caps the quotation discount at the subtotal (never negative total)", () => {
    const r = computeQuotationTotals({
      items: [item({ unit_price: 500 })],
      discount: 99999,
      vat_rate: 10,
    });
    expect(r.discount).toBe(500);
    expect(r.total).toBe(0);
  });

  it("ignores blank lines (no product or qty <= 0)", () => {
    const r = computeQuotationTotals({
      items: [item({ product_id: "" }), item({ qty: 0 }), item({ qty: 3, unit_price: 10 })],
      discount: 0,
      vat_rate: 0,
    });
    expect(r.lines).toHaveLength(1);
    expect(r.subtotal).toBe(30);
  });

  it("rounds to 2 decimals", () => {
    expect(round2(1.234)).toBe(1.23);
    expect(round2(1.236)).toBe(1.24);
    const r = computeQuotationTotals({
      items: [item({ qty: 3, unit_price: 33.333 })],
      discount: 0,
      vat_rate: 8,
    });
    expect(Number.isInteger(r.total * 100)).toBe(true);
  });
});

describe("quotationFormSchema", () => {
  const valid = {
    customer_id: "",
    valid_until: "2026-12-31",
    discount: 0,
    vat_rate: 10,
    items: [{ product_id: PID, qty: 1, unit_price: 10, discount: 0 }],
  };

  it("accepts a valid form and coerces numeric strings", () => {
    const r = quotationFormSchema.safeParse({
      ...valid,
      items: [{ product_id: PID, qty: "2", unit_price: "10", discount: "5" }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.items[0].qty).toBe(2);
  });

  it("rejects an empty items array", () => {
    expect(quotationFormSchema.safeParse({ ...valid, items: [] }).success).toBe(false);
  });

  it("rejects items where no row has a product", () => {
    const r = quotationFormSchema.safeParse({
      ...valid,
      items: [{ product_id: "", qty: 1, unit_price: 10, discount: 0 }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects out-of-range discount and VAT", () => {
    expect(
      quotationFormSchema.safeParse({
        ...valid,
        items: [{ product_id: PID, qty: 1, unit_price: 10, discount: 101 }],
      }).success,
    ).toBe(false);
    expect(quotationFormSchema.safeParse({ ...valid, vat_rate: 101 }).success).toBe(false);
  });

  it("rejects an invalid valid_until date", () => {
    expect(quotationFormSchema.safeParse({ ...valid, valid_until: "not-a-date" }).success).toBe(false);
  });
});
