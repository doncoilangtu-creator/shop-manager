import { describe, expect, it } from "vitest";
import { einvoiceSchema, saleInputSchema } from "@/lib/sales/schema";
import { einvoiceOriginalChoices, type EinvoiceOption } from "@/lib/einvoice/originals";
import { accountingErrorMessage } from "@/lib/accounting/errors";

const ORIG = "11111111-1111-4111-8111-111111111111";

describe("einvoiceSchema — Ghi mới (original)", () => {
  it("vẫn nhận payload cũ (không có trường mới)", () => {
    const r = einvoiceSchema.parse({ number: "0000123", symbol: "C26TAA", lookup_url: "https://tracuu.example.vn/x" });
    expect(r).toMatchObject({ kind: "original", number: "0000123", replaces_id: null, adjust_amount: null, adjust_reason: null });
  });
  it("bỏ replaces_id/adjust_* khi ghi mới", () => {
    const r = einvoiceSchema.parse({ kind: "original", number: "1", replaces_id: ORIG, adjust_amount: "5000", adjust_reason: "abcdef" });
    expect(r.replaces_id).toBeNull();
    expect(r.adjust_amount).toBeNull();
  });
  it("chuẩn hóa chuỗi rỗng và kiểm tra cqt_code / pdf_url", () => {
    expect(einvoiceSchema.parse({ number: "1", cqt_code: "", pdf_url: "" })).toMatchObject({ cqt_code: null, pdf_url: null });
    expect(einvoiceSchema.parse({ number: "1", cqt_code: "M1-26-ABCDE-00000000001" }).cqt_code).toBe("M1-26-ABCDE-00000000001");
    expect(einvoiceSchema.safeParse({ number: "1", cqt_code: "mã có dấu" }).success).toBe(false);
    expect(einvoiceSchema.safeParse({ number: "1", pdf_url: "ftp://x/y.pdf" }).success).toBe(false);
    expect(einvoiceSchema.safeParse({ number: "1", pdf_url: "https://x.vn/y.pdf" }).success).toBe(true);
  });
  it("saleInputSchema vẫn nhận einvoice tùy chọn", () => {
    const base = { lines: [{ description: "Dịch vụ", qty: 1, unit_price: 1000 }] };
    expect(saleInputSchema.safeParse(base).success).toBe(true);
    expect(saleInputSchema.safeParse({ ...base, einvoice: { number: "7" } }).success).toBe(true);
    expect(saleInputSchema.safeParse({ ...base, einvoice: null }).success).toBe(true);
  });
});

describe("einvoiceSchema — Thay thế (replace)", () => {
  it("nhận replaces_id, bỏ adjust_* và return_id", () => {
    const r = einvoiceSchema.parse({ kind: "replace", number: "0000124", replaces_id: ORIG, adjust_amount: 1, adjust_reason: "xxxxx", return_id: ORIG });
    expect(r).toMatchObject({ kind: "replace", replaces_id: ORIG, adjust_amount: null, adjust_reason: null, return_id: null });
  });
  it("replaces_id tùy chọn (RPC mặc định thay bản đang hiệu lực) nhưng phải là uuid", () => {
    expect(einvoiceSchema.safeParse({ kind: "replace", number: "2" }).success).toBe(true);
    expect(einvoiceSchema.safeParse({ kind: "replace", number: "2", replaces_id: "abc" }).success).toBe(false);
  });
  it("vẫn bắt buộc số hóa đơn mới", () => {
    expect(einvoiceSchema.safeParse({ kind: "replace", replaces_id: ORIG, number: "" }).success).toBe(false);
  });
});

describe("einvoiceSchema — Điều chỉnh (adjust)", () => {
  it("hợp lệ với số tiền âm (giảm) và lý do", () => {
    const r = einvoiceSchema.parse({ kind: "adjust", number: "3", replaces_id: ORIG, adjust_amount: "-50000", adjust_reason: "Giảm giá do hàng lỗi" });
    expect(r).toMatchObject({ kind: "adjust", replaces_id: ORIG, adjust_amount: -50000, adjust_reason: "Giảm giá do hàng lỗi" });
  });
  it("hiểu dấu phân cách hàng nghìn kiểu VN và làm tròn 2 chữ số", () => {
    expect(einvoiceSchema.parse({ kind: "adjust", number: "3", adjust_amount: "1.250.000", adjust_reason: "Tăng giá" }).adjust_amount).toBe(1250000);
    expect(einvoiceSchema.parse({ kind: "adjust", number: "3", adjust_amount: 10.005, adjust_reason: "Tăng giá" }).adjust_amount).toBe(10.01);
  });
  it("bắt buộc số tiền khác 0", () => {
    const r1 = einvoiceSchema.safeParse({ kind: "adjust", number: "3", adjust_reason: "Lý do đủ dài" });
    expect(r1.success).toBe(false);
    if (!r1.success) expect(r1.error.issues[0]).toMatchObject({ path: ["adjust_amount"] });
    expect(einvoiceSchema.safeParse({ kind: "adjust", number: "3", adjust_amount: 0, adjust_reason: "Lý do đủ dài" }).success).toBe(false);
    expect(einvoiceSchema.safeParse({ kind: "adjust", number: "3", adjust_amount: "abc", adjust_reason: "Lý do đủ dài" }).success).toBe(false);
  });
  it("bắt buộc lý do ≥ 5 ký tự", () => {
    const r = einvoiceSchema.safeParse({ kind: "adjust", number: "3", adjust_amount: 1000, adjust_reason: "ab" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path[0])).toContain("adjust_reason");
  });
  it("từ chối loại không hợp lệ", () => {
    expect(einvoiceSchema.safeParse({ kind: "cancel", number: "3" }).success).toBe(false);
  });
});

describe("einvoiceOriginalChoices", () => {
  const e = (id: string, kind: string, status: string, replaces_id: string | null = null): EinvoiceOption => ({ id, kind, status, symbol: "C26TAA", number: id, replaces_id });
  it("điều chỉnh: chỉ bản chính còn hiệu lực", () => {
    const list = [e("a", "original", "replaced"), e("b", "replace", "issued", "a"), e("c", "adjust", "issued", "b")];
    expect(einvoiceOriginalChoices(list, "adjust").map((x) => x.id)).toEqual(["b"]);
  });
  it("thay thế: bản hiệu lực; không đưa bản đã hủy khi còn bản hiệu lực", () => {
    const list = [e("a", "original", "cancelled"), e("b", "original", "issued")];
    expect(einvoiceOriginalChoices(list, "replace").map((x) => x.id)).toEqual(["b"]);
  });
  it("thay thế: bản đã hủy chưa có thay thế khi đơn không còn bản hiệu lực", () => {
    expect(einvoiceOriginalChoices([e("a", "original", "cancelled")], "replace").map((x) => x.id)).toEqual(["a"]);
    const list = [e("a", "original", "cancelled"), e("b", "replace", "cancelled", "a"), e("c", "original", "cancelled")];
    expect(einvoiceOriginalChoices(list, "replace").map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
  it("ghi mới: không cần hóa đơn gốc", () => {
    expect(einvoiceOriginalChoices([e("a", "original", "issued")], "original")).toEqual([]);
  });
});

describe("thông báo lỗi RPC tiếng Việt", () => {
  it.each([
    ["einvoice_adjust_amount_required", "số tiền điều chỉnh"],
    ["einvoice_adjust_reason_required", "lý do điều chỉnh"],
    ["einvoice_already_replaced", "đã có hóa đơn thay thế"],
    ["einvoice_original_not_found", "hóa đơn gốc"],
    ["einvoice_original_not_active", "còn hiệu lực"],
    ["einvoice_nothing_to_adjust", "để điều chỉnh"],
    ["einvoice_pdf_url_invalid", "PDF"],
    ["einvoice_cqt_code_invalid", "cơ quan thuế"],
    ["einvoice_url_invalid", "tra cứu"],
    ["einvoice_invalid", "không hợp lệ"],
  ])("%s", (code, frag) => {
    expect(accountingErrorMessage(`ERROR: ${code}`).toLowerCase()).toContain(frag.toLowerCase());
  });
});
