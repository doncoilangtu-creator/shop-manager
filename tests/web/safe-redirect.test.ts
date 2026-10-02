import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/lib/auth/safe-redirect";
import { isOwnQuotationPdfUrl } from "@/lib/quotations/pdf-url";

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

describe("isOwnQuotationPdfUrl", () => {
  const base = "https://abc.supabase.co";
  it("accepts public + signed object urls of the quotations bucket", () => {
    expect(isOwnQuotationPdfUrl(`${base}/storage/v1/object/public/quotations/BG-1.pdf`, base)).toBe(true);
    expect(isOwnQuotationPdfUrl(`${base}/storage/v1/object/sign/quotations/BG-1.pdf?token=x`, base)).toBe(true);
  });
  it("rejects others", () => {
    expect(isOwnQuotationPdfUrl("https://evil.com/storage/v1/object/public/quotations/a.pdf", base)).toBe(false);
    expect(isOwnQuotationPdfUrl(`${base}/storage/v1/object/public/quotations/../x.pdf`, base)).toBe(false);
    expect(isOwnQuotationPdfUrl(`${base}/storage/v1/object/public/quotations/a.html`, base)).toBe(false);
    expect(isOwnQuotationPdfUrl("not a url", base)).toBe(false);
    expect(isOwnQuotationPdfUrl(`${base}/x.pdf`, undefined)).toBe(false);
  });
});
