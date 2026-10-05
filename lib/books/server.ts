import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BookHeader } from "@/lib/books/s1a";
import { vnDate } from "@/lib/time";

export const sha256Hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

type Loc = { id: string; name: string; address: string; is_hq: boolean; status: string; tax_location_code: string | null };

/** Tiêu đề sổ/biểu: tên HKD, địa chỉ (trụ sở, nếu chưa có thì địa chỉ cư trú), MST, địa điểm, người ký, ngày lập. */
export async function loadBookHeader(sb: SupabaseClient, locationId: string | null): Promise<{ header: BookHeader; locations: Loc[]; location: Loc | null }> {
  const [profRes, locRes] = await Promise.all([
    sb.rpc("get_business_profile"),
    sb.from("business_locations").select("id, name, address, is_hq, status, tax_location_code").order("is_hq", { ascending: false }).order("created_at"),
  ]);
  if (profRes.error) throw new Error("get_business_profile: " + profRes.error.message);
  if (locRes.error) throw new Error("business_locations: " + locRes.error.message);
  const prof = ((profRes.data as { profile?: Record<string, unknown> } | null)?.profile ?? {}) as Record<string, string | null>;
  const locations = (locRes.data ?? []) as Loc[];
  const hq = locations.find((l) => l.is_hq && l.status !== "closed") ?? locations.find((l) => l.is_hq) ?? null;
  const location = locationId ? locations.find((l) => l.id === locationId) ?? null : null;
  const only = !locationId && locations.length === 1 ? locations[0] : null;
  const loc = location ?? only;
  return {
    locations,
    location,
    header: {
      businessName: prof.business_name ?? "(chưa khai báo hồ sơ hộ kinh doanh)",
      address: hq?.address ?? prof.residence_address ?? "",
      taxCode: prof.tax_code ?? "",
      locationLabel: loc ? `${loc.name} — ${loc.address}` : locations.length ? "Tất cả địa điểm kinh doanh (tổng hợp)" : "(chưa khai báo địa điểm)",
      locationCode: loc?.tax_location_code ?? null,
      signer: prof.ledger_signer ?? prof.owner_name ?? "",
      createdOn: vnDate(),
    },
  };
}
