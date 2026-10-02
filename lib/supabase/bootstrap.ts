/**
 * Bootstrap the initial admin user. Run ONCE by hand:  npm run bootstrap-admin
 * (no longer executed on every server cold start).
 *
 * Env: INITIAL_ADMIN_PASSWORD (required), INITIAL_ADMIN_EMAIL (default admin@shop.local)
 * Pure logic, takes the admin client as a parameter so it is unit-testable and
 * can run outside Next (this file must NOT import `server-only` modules).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const SAMPLE_PASSWORDS = new Set([
  "ChangeMeToAStrongPassword123!",
  "changeme",
  "password",
  "admin",
]);

export type BootstrapResult =
  | { ok: true; status: "created" | "exists"; email: string }
  | { ok: false; error: string };

export function validateAdminPassword(pw: string | undefined): string | null {
  if (!pw) return "INITIAL_ADMIN_PASSWORD chưa được đặt";
  if (SAMPLE_PASSWORDS.has(pw)) return "INITIAL_ADMIN_PASSWORD đang là mật khẩu mẫu — hãy đặt mật khẩu mạnh";
  if (pw.length < 12) return "INITIAL_ADMIN_PASSWORD phải có ít nhất 12 ký tự";
  return null;
}

export async function bootstrapAdmin(
  admin: Pick<SupabaseClient, "auth" | "rpc">,
  env: { email?: string; password?: string } = {
    email: process.env.INITIAL_ADMIN_EMAIL,
    password: process.env.INITIAL_ADMIN_PASSWORD,
  },
): Promise<BootstrapResult> {
  const email = (env.email || "admin@shop.local").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) return { ok: false, error: "Email admin không hợp lệ" };
  const pwErr = validateAdminPassword(env.password);
  if (pwErr) return { ok: false, error: pwErr };

  const { error } = await admin.auth.admin.createUser({
    email,
    password: env.password!,
    email_confirm: true,
  });
  let status: "created" | "exists" = "created";
  if (error) {
    // Idempotent: already registered is fine (no need to list/scan users).
    if (/already|registered|exists/i.test(error.message) || (error as { code?: string }).code === "email_exists") {
      status = "exists";
    } else {
      return { ok: false, error: error.message };
    }
  }
  // Migration 0003: only users in app_users pass RLS -> grant the bootstrap user owner access.
  const { error: grantErr } = await admin.rpc("grant_staff", { p_email: email, p_role: "owner" });
  if (grantErr) return { ok: false, error: "grant_staff failed (is migration 0003 applied?): " + grantErr.message };
  return { ok: true, status, email };
}
