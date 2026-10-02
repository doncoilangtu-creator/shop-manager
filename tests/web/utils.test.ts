import { describe, expect, it } from "vitest";
import { formatDate, formatVND } from "@/lib/utils";

describe("formatVND", () => {
  it("formats numbers and numeric strings with the đ suffix", () => {
    expect(formatVND(1500000)).toMatch(/^1[.\u00a0 ]?500[.\u00a0 ]?000 đ$/);
    expect(formatVND("2500")).toMatch(/^2[.\u00a0 ]?500 đ$/);
  });

  it("treats null/undefined/NaN as zero", () => {
    expect(formatVND(null)).toBe("0 đ");
    expect(formatVND(undefined)).toBe("0 đ");
    expect(formatVND("abc")).toBe("0 đ");
  });
});

describe("formatDate", () => {
  it("returns empty string for empty input", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate(undefined)).toBe("");
    expect(formatDate("")).toBe("");
  });

  it("formats a Date as day/month/year (vi-VN)", () => {
    expect(formatDate(new Date(2026, 9, 2))).toBe("2/10/2026");
  });
});
