/**
 * Shop identity printed on quotations. Source of truth = `business_profile` (settings page, migration 0012);
 * server-side env (SHOP_*, then the NEXT_PUBLIC_SHOP_* names the old settings page documented) is only a
 * fallback for a database that has no profile yet, so existing .env files keep working.
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

type ProfileRow = {
  business_name?: string | null;
  tax_code?: string | null;
  residence_address?: string | null;
  phone?: string | null;
  email?: string | null;
};

/** Profile fields win over env; blank profile fields fall back to env. */
export function mergeShopInfo(profile: ProfileRow | null | undefined, env: Record<string, string | undefined> = process.env): ShopInfo {
  const base = getShopInfo(env);
  if (!profile) return base;
  const v = (x: string | null | undefined) => (x && x.trim() ? x.trim() : undefined);
  return {
    name: v(profile.business_name) ?? base.name,
    taxCode: v(profile.tax_code) ?? base.taxCode,
    address: v(profile.residence_address) ?? base.address,
    phone: v(profile.phone) ?? base.phone,
    email: v(profile.email) ?? base.email,
  };
}

/** Load the identity from the database (RPC get_business_profile); any failure degrades to env, never throws. */
export async function loadShopInfo(
  sb: { rpc: (fn: string) => PromiseLike<{ data: unknown; error: unknown }> },
  env: Record<string, string | undefined> = process.env,
): Promise<ShopInfo> {
  try {
    const { data, error } = await sb.rpc("get_business_profile");
    if (error) return getShopInfo(env);
    const profile = ((data ?? {}) as { profile?: ProfileRow | null }).profile ?? null;
    return mergeShopInfo(profile, env);
  } catch {
    return getShopInfo(env);
  }
}
