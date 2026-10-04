import { createClient } from "@supabase/supabase-js";
import { bootstrapAdmin } from "../lib/supabase/bootstrap";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Thiếu NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
bootstrapAdmin(admin).then((r) => {
  if (!r.ok) {
    console.error("[bootstrap-admin] FAILED:", r.error);
    process.exit(1);
  }
  console.log(`[bootstrap-admin] ${r.status}: ${r.email}`);
});
