import { describe, expect, it } from "vitest";
import { classifyRevenue, parseRevenueByMonth, parseThresholdStatus, thresholdBanner } from "@/lib/hkd/threshold";

const TY = 1_000_000_000;

describe("classifyRevenue (mirror of threshold_status)", () => {
  it.each([
    [0, "ok"],
    [700_000_000, "ok"],
    [799_999_999, "ok"],
    [800_000_000, "warning"],
    [900_000_000, "warning"],
    [999_999_999, "warning"],
    [TY, "exceeded"],
    [1_500_000_000, "exceeded"],
    [3 * TY, "exceeded"],
  ])("revenue %d against 1 tỷ -> %s", (rev, level) => {
    expect(classifyRevenue(rev, TY)).toBe(level);
  });
  it("uses the configured warn percentage and tolerates a missing threshold", () => {
    expect(classifyRevenue(900_000_000, TY, 90)).toBe("warning");
    expect(classifyRevenue(899_999_999, TY, 90)).toBe("ok");
    expect(classifyRevenue(5, null)).toBe("none");
    expect(classifyRevenue(5, 0)).toBe("none");
  });
  it("the 3 tỷ threshold works the same (config, not code)", () => {
    expect(classifyRevenue(2_400_000_000, 3 * TY)).toBe("warning");
    expect(classifyRevenue(3 * TY, 3 * TY)).toBe("exceeded");
  });
});

describe("parseThresholdStatus", () => {
  it("coerces numeric strings and keeps nulls (no threshold configured)", () => {
    const s = parseThresholdStatus({ year: 2026, revenue: "850000000.00", threshold: "1000000000.00", pct: "85.00", remaining: "150000000.00", level: "warning", warn_pct: "80.00", source: "ND141" });
    expect(s).toEqual({ year: 2026, revenue: 850000000, threshold: 1000000000, pct: 85, remaining: 150000000, level: "warning", warn_pct: 80, source: "ND141" });
    const none = parseThresholdStatus({ year: 2020, revenue: 0, threshold: null, pct: null, remaining: null, level: "none" });
    expect(none).toMatchObject({ threshold: null, pct: null, remaining: null, level: "none", warn_pct: 80 });
  });
  it("falls back to level none on garbage", () => {
    expect(parseThresholdStatus(null).level).toBe("none");
    expect(parseThresholdStatus({ level: "boom" }).level).toBe("none");
  });
  it("parses the monthly series", () => {
    expect(parseRevenueByMonth([{ month: "2026-01-01", revenue: "5", cumulative: "5" }])).toEqual([{ month: "2026-01-01", revenue: 5, cumulative: 5 }]);
    expect(parseRevenueByMonth({})).toEqual([]);
  });
});

describe("thresholdBanner", () => {
  const base = { year: 2026, threshold: TY, remaining: 0, warn_pct: 80, source: null };
  it("shows nothing when revenue is safe or the threshold is unknown", () => {
    expect(thresholdBanner({ ...base, revenue: 100, pct: 0, remaining: TY, level: "ok" })).toBeNull();
    expect(thresholdBanner({ ...base, threshold: null, revenue: 100, pct: null, level: "none" })).toBeNull();
  });
  it("warns at 80 %", () => {
    const b = thresholdBanner({ ...base, revenue: 800_000_000, pct: 80, remaining: 200_000_000, level: "warning" });
    expect(b?.tone).toBe("warning");
    expect(b?.title).toMatch(/80%/);
    expect(b?.body).toMatch(/200\.000\.000/);
  });
  it("is a danger banner at 100 % and mentions the e-invoice duty", () => {
    const b = thresholdBanner({ ...base, revenue: TY, pct: 100, level: "exceeded" });
    expect(b?.tone).toBe("danger");
    expect(b?.body).toMatch(/hóa đơn điện tử/);
  });
});
