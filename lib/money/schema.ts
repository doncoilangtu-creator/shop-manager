/**
 * Tiền theo từng tài khoản (A4): loại tài khoản, nhãn tiếng Việt, kiểm tra đầu vào, tổng hợp số dư.
 * Số liệu chính thức do RPC (`money_balances`, `post_money_transfer`, ...) tính từ sổ cái; file này không tự tính số dư.
 */
import { z } from "zod";

export const MONEY_KINDS = ["cash", "bank", "ewallet"] as const;
export type MoneyKind = (typeof MONEY_KINDS)[number];
export const MONEY_KIND_LABEL: Record<MoneyKind, string> = { cash: "Tiền mặt", bank: "Ngân hàng", ewallet: "Ví điện tử" };
export const GL_LABEL: Record<string, string> = { "111": "TK 111 — Tiền mặt", "112": "TK 112 — Tiền gửi / ví" };

export type MoneyAccountOption = {
  id: string;
  kind: MoneyKind;
  label: string;
  provider: string | null;
  account_no_masked: string | null;
  gl_account: "111" | "112";
  is_default: boolean;
};

/** Phương thức thanh toán của hệ thống (cash/bank) theo loại tài khoản: ví điện tử thuộc nhóm "bank" (TK 112). */
export const methodOfKind = (k: MoneyKind): "cash" | "bank" => (k === "cash" ? "cash" : "bank");
export const glOfMethod = (m: "cash" | "bank"): "111" | "112" => (m === "cash" ? "111" : "112");

export function accountLabel(a: Pick<MoneyAccountOption, "label" | "provider" | "account_no_masked">): string {
  const extra = [a.provider, a.account_no_masked].filter(Boolean).join(" ");
  return extra ? `${a.label} · ${extra}` : a.label;
}

/** Tài khoản hợp lệ cho phương thức thanh toán đã chọn (cash -> TK 111; bank -> TK 112). */
export const accountsForMethod = (all: MoneyAccountOption[], m: "cash" | "bank"): MoneyAccountOption[] =>
  all.filter((a) => a.gl_account === glOfMethod(m));

const text = (max: number) =>
  z.preprocess((v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v), z.string().max(max).nullable().optional());
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ");
const uuid = (msg: string) => z.string({ required_error: msg }).uuid(msg);

export const moneyAccountInputSchema = z.object({
  id: z.preprocess((v) => (v === "" ? null : v), z.string().uuid().nullable().optional()),
  kind: z.enum(MONEY_KINDS, { errorMap: () => ({ message: "Chọn loại tài khoản" }) }),
  label: z.string({ required_error: "Nhập tên hiển thị" }).trim().min(1, "Nhập tên hiển thị").max(80, "Tên hiển thị tối đa 80 ký tự"),
  provider: text(80),
  account_no: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().regex(/^[0-9A-Za-z .-]{4,40}$/, "Số tài khoản 4–30 ký tự chữ/số").optional(),
  ),
  holder: text(120),
  tax_notified: z.boolean().default(false),
  tax_notified_at: z.preprocess((v) => (v === "" ? null : v), dateStr.nullable().optional()),
  is_default: z.boolean().default(false),
  active: z.boolean().default(true),
});
export type MoneyAccountInput = z.infer<typeof moneyAccountInputSchema>;

export const transferInputSchema = z
  .object({
    from: uuid("Chọn tài khoản chuyển đi"),
    to: uuid("Chọn tài khoản nhận"),
    amount: z.coerce.number({ invalid_type_error: "Số tiền không hợp lệ" }).positive("Số tiền phải > 0").max(1e13),
    date: z.preprocess((v) => (v === "" ? null : v), dateStr.nullable().optional()),
    memo: text(300),
  })
  .refine((v) => v.from !== v.to, { message: "Hai tài khoản phải khác nhau", path: ["to"] });

export const openingInputSchema = z.object({
  account_id: uuid("Chọn tài khoản"),
  amount: z.coerce.number({ invalid_type_error: "Số tiền không hợp lệ" }).positive("Số dư đầu kỳ phải > 0").max(1e13),
  date: dateStr,
  memo: text(200),
});

export type MoneyBalanceRow = {
  account_id: string | null;
  kind: MoneyKind;
  label: string;
  provider: string | null;
  account_no_masked: string | null;
  gl_account: "111" | "112";
  tax_notified: boolean;
  tax_notified_at: string | null;
  is_default: boolean;
  active: boolean;
  balance: number;
  unassigned: boolean;
};

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const kindOf = (v: unknown): MoneyKind => ((MONEY_KINDS as readonly string[]).includes(String(v)) ? (v as MoneyKind) : "bank");

export function parseMoneyBalances(raw: unknown): MoneyBalanceRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return {
      account_id: typeof o.account_id === "string" ? o.account_id : null,
      kind: kindOf(o.kind),
      label: String(o.label ?? ""),
      provider: typeof o.provider === "string" ? o.provider : null,
      account_no_masked: typeof o.account_no_masked === "string" ? o.account_no_masked : null,
      gl_account: o.gl_account === "111" ? "111" : "112",
      tax_notified: o.tax_notified === true,
      tax_notified_at: typeof o.tax_notified_at === "string" ? o.tax_notified_at : null,
      is_default: o.is_default === true,
      active: o.active !== false,
      balance: num(o.balance),
      unassigned: o.unassigned === true,
    };
  });
}

export type MoneySummary = {
  total: number;
  cash: number;
  bank: number;
  unassigned: number;
  /** tài khoản NH/ví đang dùng nhưng CHƯA đánh dấu đã thông báo cơ quan thuế */
  notNotified: MoneyBalanceRow[];
  /** tài khoản có số dư âm (thường do chưa nhập số dư đầu kỳ hoặc ghi sai quỹ) */
  negative: MoneyBalanceRow[];
};

/** Tổng hợp cho trang Tiền & Quỹ: tổng tiền, theo TK 111/112, phần chưa gán, cảnh báo thông báo thuế và số dư âm. */
export function summarizeMoney(rows: MoneyBalanceRow[]): MoneySummary {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const sum = (f: (x: MoneyBalanceRow) => boolean) => r2(rows.filter(f).reduce((a, x) => a + x.balance, 0));
  return {
    total: sum(() => true),
    cash: sum((x) => x.gl_account === "111"),
    bank: sum((x) => x.gl_account === "112"),
    unassigned: sum((x) => x.unassigned),
    notNotified: rows.filter((x) => !x.unassigned && x.active && x.kind !== "cash" && !x.tax_notified),
    negative: rows.filter((x) => x.balance < 0),
  };
}
