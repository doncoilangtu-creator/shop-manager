import { describe, expect, it } from "vitest";
import { ilikeOr, sanitizeSearchTerm } from "@/lib/search";

describe("search term sanitising (PostgREST .or injection)", () => {
  it("removes grammar and LIKE metacharacters", () => {
    expect(sanitizeSearchTerm("a,id.eq.1")).toBe("a id.eq.1");
    expect(sanitizeSearchTerm('x),or(id.gt.0')).toBe("x or id.gt.0");
    expect(sanitizeSearchTerm("100%_off*\\")).toBe("100 off");
  });
  it("keeps Vietnamese text and collapses spaces", () => {
    expect(sanitizeSearchTerm("  Màn   hình  ")).toBe("Màn hình");
  });
  it("caps length and tolerates null", () => {
    expect(sanitizeSearchTerm("a".repeat(500)).length).toBe(64);
    expect(sanitizeSearchTerm(null)).toBe("");
  });
  it("ilikeOr builds clauses or null", () => {
    expect(ilikeOr(["name", "sku"], "ssd")).toBe("name.ilike.%ssd%,sku.ilike.%ssd%");
    expect(ilikeOr(["name"], ",,,")).toBeNull();
  });
  it("a hostile term cannot add a clause", () => {
    const f = ilikeOr(["name", "sku"], "x%,id.not.is.null")!;
    // exactly two clauses (one comma) => nothing was injected
    expect(f.split(",").length).toBe(2);
  });
});
