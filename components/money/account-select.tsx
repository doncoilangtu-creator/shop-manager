"use client";

import { accountLabel, accountsForMethod, type MoneyAccountOption } from "@/lib/money/schema";

const selectCls = "h-9 w-full rounded-md border bg-background px-2 text-sm";

/** Chọn tài khoản tiền cho một lần thu/chi. Để trống = tài khoản mặc định của phương thức (nếu chưa có thì "chưa gán tài khoản"). */
export function MoneyAccountSelect({ accounts, method, value, onChange, id, label = "Tài khoản" }: {
  accounts: MoneyAccountOption[];
  method: "cash" | "bank";
  value: string;
  onChange: (v: string) => void;
  id?: string;
  label?: string;
}) {
  const opts = accountsForMethod(accounts, method);
  const def = opts.find((a) => a.is_default);
  return (
    <select id={id} aria-label={label} className={selectCls} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{def ? `Mặc định: ${accountLabel(def)}` : "Chưa gán tài khoản (chọn để theo dõi)"}</option>
      {opts.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
    </select>
  );
}
