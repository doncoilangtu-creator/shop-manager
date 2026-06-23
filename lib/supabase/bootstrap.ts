/**
 * Bootstrap the initial admin user. Called once at server startup.
 * Idempotent: if the admin already exists, it does nothing.
 *
 * Required env:
 *   - INITIAL_ADMIN_PASSWORD
 *
 * The script is invoked from instrumentation.ts at the Next.js server boot.
 */

import { createAdminClient } from "./admin";

const ADMIN_EMAIL = "admin@shop.local";

export async function bootstrapAdmin(): Promise<void> {
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (!password) {
    console.warn(
      "[bootstrap] INITIAL_ADMIN_PASSWORD not set — skipping admin bootstrap.",
    );
    return;
  }

  const admin = createAdminClient();

  // Try to find existing admin by listing users (lightweight; one-user app).
  const { data: list, error: listErr } = await admin.auth.admin.listUsers({
    perPage: 200,
  });
  if (listErr) {
    console.error("[bootstrap] listUsers failed:", listErr.message);
    return;
  }

  const exists = list?.users?.some((u) => u.email === ADMIN_EMAIL);
  if (exists) {
    return; // already provisioned
  }

  const { error: createErr } = await admin.auth.admin.createUser({
    email: ADMIN_EMAIL,
    password,
    email_confirm: true,
  });
  if (createErr) {
    console.error("[bootstrap] createUser failed:", createErr.message);
    return;
  }
  console.log(`[bootstrap] ✓ Admin user created: ${ADMIN_EMAIL}`);
}
