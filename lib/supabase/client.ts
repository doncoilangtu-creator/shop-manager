import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client. Use inside Client Components only.
 * Reads public anon key from env; safe to expose.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
