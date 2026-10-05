import { describe, expect, it } from "vitest";
import {
  accountLabel, accountsForMethod, glOfMethod, methodOfKind, moneyAccountInputSchema, openingInputSchema, parseMoneyBalances, summarizeMoney,
  transferInputSchema, type MoneyAccountOption,
} from "@/lib/money/schema";
import { salePaymentSchema, returnInputSchema } from "@/lib/sales/schema";
import { accountingErrorMessage } from "@/lib/accounting/errors";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

describe("method / gl mapping", () => {
  it("ví điện tử và ngân hàng đều thuộc phương thức bank (TK 112)", () => {
    expect(methodOfKind("cash")).toBe("cash");
    expect(methodOfKind("bank")).toBe("bank");
    expect(methodOfKind("ewallet")).toBe("bank");
    expect(glOfMethod("cash")).toBe("111");
    expect(glOfMethod("bank")).toBe("112");
  });
  it("accountsForMethod lọc đúng TK 111 / 112", () => {
    const all: MoneyAccountOption[] = [
      { id: U1, kind: "cash", label: "Tiền mặt", provider: null, account_no_masked: null, gl_account: "111", is_default: true },
      { id: U2, kind: "bank", label: "MB", provider: "MB Bank", account_no_masked: "****6789", gl_account: "112", is_default: false },
    ];
    expect(accountsForMethod(all, "cash").map((a) => a.id)).toEqual([U1]);
    expect(accountsForMethod(all, "bank").map((a) => a.id)).toEqual([U2]);
    expect(accountLabel(all[1])).toBe("MB · MB Bank ****6789");
    expect(accountLabel(all[0])).toBe("Tiền mặt");
  });
});

describe("moneyAccountInputSchema", () => {
  it("chấp nhận tài khoản ngân hàng đầy đủ", () => {
    const r = moneyAccountInputSchema.safeParse({ kind: "bank", label: " MB chính ", provider: "MB", account_no: "0123456789", holder: "Nguyễn A", tax_notified: true, tax_notified_at: "2026-01-15" });
    expect(r.success).toBe(true);
    if (r.success) { expect(r.data.label).toBe("MB chính"); expect(r.data.id ?? null).toBeNull(); }
  });
  it("từ chối loại sai, tên trống, số tài khoản quá ngắn", () => {
    expect(moneyAccountInputSchema.safeParse({ kind: "crypto", label: "x" }).success).toBe(false);
    expect(moneyAccountInputSchema.safeParse({ kind: "cash", label: "  " }).success).toBe(false);
    const r = moneyAccountInputSchema.safeParse({ kind: "bank", label: "A", account_no: "12" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toContain("Số tài khoản");
  });
  it("số tài khoản để trống = không đổi", () => {
    const r = moneyAccountInputSchema.parse({ kind: "bank", label: "A", account_no: "" });
    expect(r.account_no).toBeUndefined();
  });
});

describe("transfer / opening schema", () => {
  it("chuyển cùng một tài khoản bị chặn", () => {
    const r = transferInputSchema.safeParse({ from: U1, to: U1, amount: 100 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("Hai tài khoản phải khác nhau");
  });
  it("số tiền phải dương, ép kiểu từ chuỗi", () => {
    expect(transferInputSchema.safeParse({ from: U1, to: U2, amount: "0" }).success).toBe(false);
    const r = transferInputSchema.parse({ from: U1, to: U2, amount: "1500000", date: "" });
    expect(r.amount).toBe(1500000);
    expect(r.date).toBeNull();
  });
  it("số dư đầu kỳ cần ngày và số tiền > 0", () => {
    expect(openingInputSchema.safeParse({ account_id: U1, amount: 5, date: "2026-01-01" }).success).toBe(true);
    expect(openingInputSchema.safeParse({ account_id: U1, amount: -5, date: "2026-01-01" }).success).toBe(false);
    expect(openingInputSchema.safeParse({ account_id: U1, amount: 5, date: "01/01/2026" }).success).toBe(false);
  });
});

describe("summarizeMoney", () => {
  const rows = parseMoneyBalances([
    { account_id: U1, kind: "cash", label: "Tiền mặt", gl_account: "111", balance: "6000000", is_default: true, active: true, unassigned: false },
    { account_id: U2, kind: "bank", label: "MB", gl_account: "112", balance: 4000000, tax_notified: false, active: true },
    { account_id: "33333333-3333-4333-8333-333333333333", kind: "ewallet", label: "MoMo", gl_account: "112", balance: -50000, tax_notified: true, active: true },
    { account_id: null, kind: "bank", label: "Chưa gán tài khoản (TK 112)", gl_account: "112", balance: 1000, unassigned: true, active: true },
  ]);
  it("tính tổng, theo TK 111/112 và phần chưa gán", () => {
    const s = summarizeMoney(rows);
    expect(s.total).toBe(9951000);
    expect(s.cash).toBe(6000000);
    expect(s.bank).toBe(3951000);
    expect(s.unassigned).toBe(1000);
  });
  it("cảnh báo tài khoản chưa thông báo thuế (không tính tiền mặt, dòng chưa gán) và số dư âm", () => {
    const s = summarizeMoney(rows);
    expect(s.notNotified.map((r) => r.label)).toEqual(["MB"]);
    expect(s.negative.map((r) => r.label)).toEqual(["MoMo"]);
  });
  it("dữ liệu rác không làm vỡ", () => {
    expect(parseMoneyBalances(null)).toEqual([]);
    expect(parseMoneyBalances([{ balance: "abc", kind: "zzz" }])[0]).toMatchObject({ balance: 0, kind: "bank" });
  });
});

describe("sales schema carries money_account_id", () => {
  it("khoản thu có tài khoản; chuỗi rỗng = mặc định (null)", () => {
    expect(salePaymentSchema.parse({ method: "bank", amount: 100, money_account_id: U2 }).money_account_id).toBe(U2);
    expect(salePaymentSchema.parse({ method: "cash", amount: 100, money_account_id: "" }).money_account_id).toBeNull();
    expect(salePaymentSchema.safeParse({ method: "cash", amount: 100, money_account_id: "abc" }).success).toBe(false);
  });
  it("phiếu trả hàng nhận refund_account_id", () => {
    const r = returnInputSchema.parse({ sale_id: U1, lines: [{ sale_line_id: U2, qty: 1 }], refund_method: "bank", refund_account_id: U2 });
    expect(r.refund_account_id).toBe(U2);
  });
});

describe("error messages", () => {
  it("dịch mã lỗi tài khoản tiền", () => {
    expect(accountingErrorMessage("money_account_mismatch")).toContain("không khớp");
    expect(accountingErrorMessage("transfer_same_account")).toContain("khác nhau");
    expect(accountingErrorMessage("money_account_has_balance")).toContain("số dư");
    expect(accountingErrorMessage("money_account_label_duplicate")).toContain("đã tồn tại");
  });
});
