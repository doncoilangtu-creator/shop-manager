import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export const UNAUTHORIZED = "Unauthorized" as const;

export type AuthOk = { ok: true; user: User; supabase: SupabaseClient };
export type AuthFail = { ok: false; error: typeof UNAUTHORIZED };

/**
 * Server-side authentication guard. Call at the very top of every server
 * action / route handler that touches data (except the public signing flow).
 * Uses `auth.getUser()` (validated against the Supabase Auth server), never
 * `getSession()` (cookie only, spoofable).
 */
export async function requireUser(): Promise<AuthOk | AuthFail> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) return { ok: false, error: UNAUTHORIZED };
    return { ok: true, user: data.user, supabase };
  } catch {
    return { ok: false, error: UNAUTHORIZED };
  }
}

/** Variant for handlers that cannot return a result object (throws). */
export async function requireUserOrThrow(): Promise<AuthOk> {
  const auth = await requireUser();
  if (!auth.ok) throw new Error(UNAUTHORIZED);
  return auth;
}
