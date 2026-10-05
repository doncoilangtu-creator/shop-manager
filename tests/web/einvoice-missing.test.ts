import { describe, expect, it } from "vitest";
import {
  EINV_REMINDER_COOKIE,
  defaultMissingPeriod,
  parseMissingFilter,
  parseMissingRows,
  reminderEnabled,
  reminderVisible,
  snoozeCookieValue,
  summarizeMissing,
} from "@/lib/einvoice/missing";

describe("parseMissingRows", () => {
  it("parses typed rows and skips junk", () => {
    const rows = parseMissingRows([
      { sale_id: "a", invoice_no: "HD001", invoice_date: "2026-10-01", customer_id: "c1", customer_name: "Anh A", total: "150000" },
      { sale_id: "b", invoice_no: "HD002", invoice_date: "2026-10-02T00:00:00", customer_id: null, customer_name: null, total: null },
      null,
      { invoice_no: "x" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ sale_id: "a", invoice_no: "HD001", invoice_date: "2026-10-01", customer_id: "c1", customer_name: "Anh A", total: 150000 });
    expect(rows[1].invoice_date).toBe("2026-10-02");
    expect(rows[1].total).toBe(0);
    expect(rows[1].customer_name).toBe("");
    expect(parseMissingRows(null)).toEqual([]);
  });
});

describe("period filter", () => {
  it("defaults to current quarter", () => {
    expect(defaultMissingPeriod("2026-10-05")).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(defaultMissingPeriod("2026-02-28")).toEqual({ from: "2026-01-01", to: "2026-03-31" });
    expect(parseMissingFilter({}, "2026-05-10")).toMatchObject({ kind: "quarter", year: 2026, n: 2, period: { from: "2026-04-01", to: "2026-06-30" } });
  });
  it("supports month/quarter/year/custom", () => {
    expect(parseMissingFilter({ kind: "month", year: "2026", n: "2" }, "2026-10-05").period).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(parseMissingFilter({ kind: "month" }, "2026-10-05").period).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(parseMissingFilter({ kind: "quarter", year: "2025", n: "3" }, "2026-10-05").period).toEqual({ from: "2025-07-01", to: "2025-09-30" });
    expect(parseMissingFilter({ kind: "year", year: "2025" }, "2026-10-05").period).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(parseMissingFilter(new URLSearchParams("kind=custom&from=2026-09-15&to=2026-10-04"), "2026-10-05")).toMatchObject({ kind: "custom", period: { from: "2026-09-15", to: "2026-10-04" } });
  });
  it("falls back to default on invalid input", () => {
    const def = { from: "2026-10-01", to: "2026-12-31" };
    expect(parseMissingFilter({ kind: "month", year: "2026", n: "13" }, "2026-10-05").period).toEqual(def);
    expect(parseMissingFilter({ kind: "quarter", year: "abc" }, "2026-10-05").period).toEqual(def);
    expect(parseMissingFilter({ kind: "custom", from: "2026-10-05", to: "2026-10-01" }, "2026-10-05").period).toEqual(def);
    expect(parseMissingFilter({ kind: "custom", from: "2026-02-30", to: "2026-03-01" }, "2026-10-05").period).toEqual(def);
    expect(parseMissingFilter({ kind: "half" }, "2026-10-05").period).toEqual(def);
    expect(parseMissingFilter({ kind: ["year", "x"], year: ["2024"] }, "2026-10-05").period).toEqual({ from: "2024-01-01", to: "2024-12-31" });
  });
});

describe("summarizeMissing", () => {
  it("counts and totals", () => {
    expect(summarizeMissing([])).toEqual({ count: 0, total: 0 });
    expect(summarizeMissing([{ total: 100 }, { total: 250.5 }, { total: NaN }])).toEqual({ count: 3, total: 350.5 });
  });
});

describe("reminder cookie", () => {
  it("has the expected name", () => expect(EINV_REMINDER_COOKIE).toBe("einv_reminder"));
  it("is visible by default", () => {
    expect(reminderVisible(undefined, "2026-10-05")).toBe(true);
    expect(reminderVisible("", "2026-10-05")).toBe(true);
    expect(reminderVisible("garbage", "2026-10-05")).toBe(true);
  });
  it("off hides", () => {
    expect(reminderVisible("off", "2026-10-05")).toBe(false);
    expect(reminderEnabled("off")).toBe(false);
    expect(reminderEnabled(undefined)).toBe(true);
  });
  it("snooze hides for 30 days then shows", () => {
    const v = snoozeCookieValue("2026-10-05");
    expect(v).toBe("snooze:2026-11-04");
    expect(reminderVisible(v, "2026-10-05")).toBe(false);
    expect(reminderVisible(v, "2026-11-03")).toBe(false);
    expect(reminderVisible(v, "2026-11-04")).toBe(true);
    expect(reminderVisible(v, "2026-12-01")).toBe(true);
    expect(reminderVisible("snooze:bad", "2026-10-05")).toBe(true);
    expect(snoozeCookieValue("2026-12-15")).toBe("snooze:2027-01-14");
  });
});
