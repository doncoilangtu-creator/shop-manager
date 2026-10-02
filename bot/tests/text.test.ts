import { describe, expect, it } from "vitest";
import { commandArgs, esc, ilikeOr, parseArgs, parseMoney, parsePositiveInt, sanitizeSearchTerm } from "../src/lib/text";
import { addDaysYmd, monthRange, vnDate } from "../src/lib/time";
import { generateCode } from "../src/lib/codes";

describe("esc", () => {
  it("escapes Telegram HTML specials", () => {
    expect(esc('<b>"A&B"</b>')).toBe("&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;");
    expect(esc(null)).toBe("");
    expect(esc(42)).toBe("42");
  });
});

describe("parseArgs / commandArgs", () => {
  it("keeps quoted groups together", () => {
    expect(parseArgs('"Nguyen Van A" HP-1234 2')).toEqual(["Nguyen Van A", "HP-1234", "2"]);
    expect(parseArgs("a   b\tc")).toEqual(["a", "b", "c"]);
  });
  it("accepts smart quotes from phone keyboards and unterminated quotes", () => {
    expect(parseArgs("“Tran Thi B” SKU1 3")).toEqual(["Tran Thi B", "SKU1", "3"]);
    expect(parseArgs('"Le Van C SKU1 3')).toEqual(["Le Van C SKU1 3"]);
    expect(parseArgs("   ")).toEqual([]);
  });
  it("strips /cmd and /cmd@Bot", () => {
    expect(commandArgs("/ban x y z", "ban")).toBe("x y z");
    expect(commandArgs("/ban@Shop_bot  x", "ban")).toBe("x");
    expect(commandArgs("/ban", "ban")).toBe("");
    expect(commandArgs("/banana x", "ban")).toBe("/banana x");
  });
});

describe("number parsing", () => {
  it("parsePositiveInt is strict", () => {
    expect(parsePositiveInt("5")).toBe(5);
    for (const bad of ["0", "-1", "5.5", "1e3", "0x10", "", "abc", "1000000000", undefined]) expect(parsePositiveInt(bad as string)).toBeNull();
  });
  it("parseMoney rejects exponents, negatives and separators", () => {
    expect(parseMoney("4500000")).toBe(4500000);
    expect(parseMoney("0")).toBe(0);
    for (const bad of ["-5", "1e9", "4,500,000", "NaN", "Infinity", "1.234"]) expect(parseMoney(bad)).toBeNull();
  });
});

describe("search sanitising (PostgREST .or injection)", () => {
  it("removes grammar characters", () => {
    expect(sanitizeSearchTerm('a,id.eq.1)"%_')).toBe("a id.eq.1");
    expect(ilikeOr(["name", "phone"], "x,y")).toBe("name.ilike.%x y%,phone.ilike.%x y%");
    expect(ilikeOr(["name"], " ,() ")).toBeNull();
  });
});

describe("time helpers", () => {
  it("monthRange validates 1..12 and computes the last day", () => {
    expect(monthRange("2026-06")).toMatchObject({ from: "2026-06-01", to: "2026-06-30", key: "2026-06" });
    expect(monthRange("2028-2")).toMatchObject({ to: "2028-02-29", key: "2028-02" });
    expect(monthRange("2026-13")).toBeNull();
    expect(monthRange("2026-00")).toBeNull();
    expect(monthRange("abc")).toBeNull();
  });
  it("vnDate uses Vietnam time, not UTC", () => {
    expect(vnDate(new Date("2026-09-30T18:30:00Z"))).toBe("2026-10-01"); // 01:30 on 1 Oct in VN
    expect(addDaysYmd("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("generateCode: VN date + 8 random chars, practically unique", () => {
    const c = generateCode("TK", new Date("2026-09-30T18:30:00Z"));
    expect(c).toMatch(/^TK-20261001-[0-9A-Z]{8}$/);
    expect(new Set(Array.from({ length: 500 }, () => generateCode("TK"))).size).toBe(500);
  });
});
