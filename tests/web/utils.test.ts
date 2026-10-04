import { describe, expect, it } from "vitest";
import { formatDate, formatVND, generateCode } from "@/lib/utils";

describe("generateCode", () => {
  it("has the PREFIX-YYYYMMDD-XXXXX shape", () => {
    expect(generateCode("BG")).toMatch(/^BG-\d{8}-[A-Z0-9]{1,5}$/);
  });

  it("embeds today's (local) date", () => {
    const now = new Date();
    const ymd =
      String(now.getFullYear()) +
      String(now.getMonth() + 1).padStart(2, "0") +
      String(now.getDate()).padStart(2, "0");
    expect(generateCode("X").split("-")[1]).toBe(ymd);
  });

  it("is practically unique across many calls", () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateCode("T")));
    // Only 36^5 random suffixes: allow a handful of collisions, not a pattern.
    expect(codes.size).toBeGreaterThan(495);
  });
});

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
