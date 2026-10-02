/**
 * A quotation `pdf_url` may only point at OUR Supabase Storage `quotations`
 * bucket (public or signed object URL) — never an arbitrary external URL.
 */
export function isOwnQuotationPdfUrl(
  url: string,
  supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
): boolean {
  if (!supabaseUrl) return false;
  let u: URL;
  let base: URL;
  try {
    u = new URL(url);
    base = new URL(supabaseUrl);
  } catch {
    return false;
  }
  if (u.protocol !== base.protocol || u.host !== base.host) return false;
  if (u.username || u.password) return false;
  return /^\/storage\/v1\/object\/(public|sign)\/quotations\/[^/?#]+\.pdf$/.test(u.pathname);
}
