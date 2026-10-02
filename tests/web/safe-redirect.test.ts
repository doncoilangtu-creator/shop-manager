import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/lib/auth/safe-redirect";
import { isQuotationPdfPath } from "@/lib/quotations/pdf-url";

describe("safeRedirectPath", () => {
  it.each(["/", "/customers", "/inventory?filter=low", "/maintenance/tickets/abc#x"])("keeps %s", (p) => {
    expect(safeRedirectPath(p)).toBe(p);
  });
  it.each([
    "https://evil.com", "http://evil.com/x", "//evil.com", "/\\evil.com", "\\\\evil.com",
    "javascript:alert(1)", "evil.com", "", "/a\nb", "/%0d%0a" + "x".repeat(3000),
  ])("rejects %j", (p) => {
    expect(safeRedirectPath(p)).toBe("/");
  });
  it("null/undefined → fallback", () => {
    expect(safeRedirectPath(null)).toBe("/");
    expect(safeRedirectPath(undefined, "/home")).toBe("/home");
  });
});

describe("isQuotationPdfPath (private bucket object paths)", () => {
  it("accepts generated names", () => {
    expect(isQuotationPdfPath("BG-20261003-AB12CD34-1790000000000.pdf")).toBe(true);
  });
  it.each(["../x-1790000000000.pdf", "a/b-1790000000000.pdf", "BG-1.pdf", "x-1790000000000.html",
    "https://evil.com/a-1790000000000.pdf", "", "-1790000000000.pdf"])("rejects %j", (p) => {
    expect(isQuotationPdfPath(p)).toBe(false);
  });
});
