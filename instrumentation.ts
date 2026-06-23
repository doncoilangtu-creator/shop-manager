/**
 * Next.js instrumentation hook. Runs once when the server starts.
 * Used to provision the initial admin user (idempotent).
 *
 * See https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootstrapAdmin } = await import("./lib/supabase/bootstrap");
    await bootstrapAdmin();
  }
}
