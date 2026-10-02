/**
 * Shop identity printed on quotations. Server-side env first (SHOP_*), then the NEXT_PUBLIC_SHOP_* names
 * the old settings page documented, so existing .env files keep working.
 */
export type ShopInfo = { name: string; taxCode?: string; address?: string; phone?: string; email?: string };

export function getShopInfo(env: Record<string, string | undefined> = process.env): ShopInfo {
  const pick = (k: string) => (env[`SHOP_${k}`] || env[`NEXT_PUBLIC_SHOP_${k}`] || "").trim() || undefined;
  return {
    name: pick("NAME") ?? "Shop Manager",
    taxCode: pick("TAX_CODE"),
    address: pick("ADDRESS"),
    phone: pick("PHONE"),
    email: pick("EMAIL"),
  };
}
