import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "@/lib/actions/_shared";
import type { MoneyAccountOption } from "@/lib/money/schema";

/** Tài khoản tiền đang dùng, cho các ô chọn tài khoản (bán hàng, thu/chi, trả hàng). */
export async function listActiveMoneyAccounts(sb: SupabaseClient): Promise<MoneyAccountOption[]> {
  const res = await sb
    .from("money_accounts")
    .select("id, kind, label, provider, account_no_masked, gl_account, is_default")
    .eq("active", true)
    .order("gl_account")
    .order("label");
  return unwrap<MoneyAccountOption[]>(res as { data: MoneyAccountOption[] | null; error: never }, "money_accounts");
}
