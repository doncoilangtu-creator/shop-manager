import { describe, expect, it } from "vitest";
import {
  vnCurrentMonthStartIso, vnMonthStartIso, vnDate, vnLastMonthKeys, vnMonthKey, vnMonthRange, vnMonthsAgoStartIso, vnParts, vnYmd,
} from "@/lib/time";
import { generateCode } from "@/lib/codes";
import { formatDate, formatDateTime } from "@/lib/utils";

describe("Vietnam time helpers", () => {
  it("UTC 23:30 on the 30th is already the 1st of next month in Vietnam", () => {
    const d = new Date("2026-09-30T23:30:00Z");
    expect(vnDate(d)).toBe("2026-10-01");
    expect(vnMonthKey(d)).toBe("2026-10");
    expect(vnParts(d)).toMatchObject({ year: 2026, month: 10, day: 1, hour: 6, minute: 30 });
  });

  it("UTC 16:59 on the 30th is still the 30th in Vietnam", () => {
    expect(vnDate("2026-09-30T16:59:59Z")).toBe("2026-09-30");
    expect(vnDate("2026-09-30T17:00:00Z")).toBe("2026-10-01");
  });

  it("year rollover: UTC Dec 31 18:00 is Jan 1 in Vietnam", () => {
    expect(vnDate("2026-12-31T18:00:00Z")).toBe("2027-01-01");
    expect(vnYmd("2026-12-31T18:00:00Z")).toBe("20270101");
  });

  it("month start is 17:00 UTC of the previous day", () => {
    expect(vnMonthStartIso(2026, 10)).toBe("2026-09-30T17:00:00.000Z");
    expect(vnCurrentMonthStartIso(new Date("2026-09-30T23:30:00Z"))).toBe("2026-09-30T17:00:00.000Z");
    expect(vnCurrentMonthStartIso(new Date("2026-09-30T10:00:00Z"))).toBe("2026-08-31T17:00:00.000Z");
  });

  it("vnMonthRange is half-open and handles December", () => {
    expect(vnMonthRange(2026, 12)).toEqual({ from: "2026-11-30T17:00:00.000Z", to: "2026-12-31T17:00:00.000Z" });
    expect(() => vnMonthRange(2026, 13)).toThrow(RangeError);
    expect(() => vnMonthRange(2026, 0)).toThrow(RangeError);
  });

  it("12-month window starts 11 months back", () => {
    expect(vnMonthsAgoStartIso(11, new Date("2026-10-03T00:00:00Z"))).toBe("2025-10-31T17:00:00.000Z");
    expect(vnLastMonthKeys(3, new Date("2026-01-15T00:00:00Z"))).toEqual(["2025-11", "2025-12", "2026-01"]);
  });

  it("rejects invalid dates", () => {
    expect(() => vnParts("nope")).toThrow(RangeError);
  });

  it("formatDate/formatDateTime render in Vietnam time regardless of server TZ", () => {
    expect(formatDate("2026-09-30T23:30:00Z")).toBe("1/10/2026");
    expect(formatDateTime("2026-09-30T23:30:00Z")).toMatch(/06:30:00/);
    expect(formatDate("garbage")).toBe("");
  });
});

describe("generateCode (crypto, VN date)", () => {
  it("uses the Vietnam date and an 8-char unambiguous suffix", () => {
    const c = generateCode("BG", new Date("2026-09-30T23:30:00Z"));
    expect(c).toMatch(/^BG-20261001-[0-9A-HJKMNP-TV-Z]{8}$/);
  });

  it("does not collide in 20k draws", () => {
    const set = new Set(Array.from({ length: 20000 }, () => generateCode("T")));
    expect(set.size).toBe(20000);
  });
});
