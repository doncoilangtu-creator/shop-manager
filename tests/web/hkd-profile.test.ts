import { beforeEach, describe, expect, it, vi } from "vitest";
import { locationSchema, parseProfileState, profileSchema } from "@/lib/hkd/profile";
import { loadShopInfo, mergeShopInfo } from "@/lib/shop";
import { accountingErrorMessage } from "@/lib/accounting/errors";

const rpc = vi.fn();
const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser }, rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const form = (o: Record<string, string | undefined>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) { if (v !== undefined) f.set(k, v); } return f; };

beforeEach(() => {
  rpc.mockReset(); getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
});

describe("profileSchema", () => {
  it("accepts a full profile and normalises blanks to null", () => {
    const r = profileSchema.parse({ business_name: "  HKD A ", tax_code: "001234567890", citizen_id: "", phone: " ", tax_method: "exempt_notice", start_date: "2024-03-01" });
    expect(r).toMatchObject({ business_name: "HKD A", tax_code: "001234567890", citizen_id: null, phone: null, start_date: "2024-03-01", tax_method: "exempt_notice" });
  });
  it.each(["12345", "12345678901", "abc1234567", "1234567890-12"])("rejects tax code %s", (tax_code) => {
    expect(profileSchema.safeParse({ business_name: "A", tax_code }).success).toBe(false);
  });
  it.each(["0123456789", "0123456789-001", "001234567890"])("accepts tax code %s", (tax_code) => {
    expect(profileSchema.safeParse({ business_name: "A", tax_code }).success).toBe(true);
  });
  it("validates CCCD, email, method and name", () => {
    expect(profileSchema.safeParse({ business_name: "A", citizen_id: "12ab" }).success).toBe(false);
    expect(profileSchema.safeParse({ business_name: "A", citizen_id: "123456789" }).success).toBe(true);
    expect(profileSchema.safeParse({ business_name: "A", email: "x" }).success).toBe(false);
    expect(profileSchema.safeParse({ business_name: "A", tax_method: "khoan" }).success).toBe(false);
    expect(profileSchema.safeParse({ business_name: "   " }).success).toBe(false);
    expect(profileSchema.safeParse({ business_name: "A", start_date: "01/02/2024" }).success).toBe(false);
  });
});

describe("locationSchema", () => {
  it("requires name and address, rejects close before open", () => {
    expect(locationSchema.safeParse({ name: "", address: "x" }).success).toBe(false);
    expect(locationSchema.safeParse({ name: "x", address: "" }).success).toBe(false);
    const bad = locationSchema.safeParse({ name: "x", address: "y", opened_on: "2026-05-01", closed_on: "2026-04-01" });
    expect(bad.success).toBe(false);
    expect(locationSchema.safeParse({ name: "x", address: "y", opened_on: "2026-05-01", closed_on: "2026-06-01", status: "closed" }).success).toBe(true);
  });
});

describe("business actions", () => {
  it("saveBusinessProfileAction sends the normalised profile to set_business_profile", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    const { saveBusinessProfileAction } = await import("@/lib/actions/business");
    const r = await saveBusinessProfileAction(form({ business_name: " HKD A ", tax_code: "0123456789", main_tax_group: "goods", tax_method: "exempt_notice" }));
    expect(r.ok).toBe(true);
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe("set_business_profile");
    expect(args.p).toMatchObject({ business_name: "HKD A", tax_code: "0123456789", main_tax_group: "goods", citizen_id: null });
  });
  it("does not call the DB on invalid input and maps DB errors to Vietnamese", async () => {
    const { saveBusinessProfileAction } = await import("@/lib/actions/business");
    const bad = await saveBusinessProfileAction(form({ business_name: "A", tax_code: "123" }));
    expect(bad.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: { message: "forbidden" } });
    const denied = await saveBusinessProfileAction(form({ business_name: "A" }));
    expect(denied).toEqual({ ok: false, error: "Bạn không có quyền thực hiện thao tác này." });
  });
  it("requires login", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { saveBusinessProfileAction, saveBusinessLocationAction } = await import("@/lib/actions/business");
    expect((await saveBusinessProfileAction(form({ business_name: "A" }))).ok).toBe(false);
    expect((await saveBusinessLocationAction(form({ name: "A", address: "B" }))).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("saveBusinessLocationAction maps the checkbox and calls upsert_business_location", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    const { saveBusinessLocationAction } = await import("@/lib/actions/business");
    await saveBusinessLocationAction(form({ name: "Cửa hàng", address: "1 Lê Lợi", is_hq: "on", status: "active" }));
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe("upsert_business_location");
    expect(args.p).toMatchObject({ name: "Cửa hàng", address: "1 Lê Lợi", is_hq: true, status: "active", id: null });
    await saveBusinessLocationAction(form({ name: "Kho", address: "2" }));
    expect(rpc.mock.calls[1][1].p.is_hq).toBe(false);
  });
  it("explains new database errors in Vietnamese", () => {
    expect(accountingErrorMessage("location_dates_invalid")).toMatch(/Ngày đóng/);
    expect(accountingErrorMessage("tax_code_invalid")).toMatch(/Mã số thuế/);
  });
});

describe("parseProfileState / shop identity from the profile", () => {
  it("tolerates a missing profile", () => {
    expect(parseProfileState(null)).toEqual({ exists: false, is_owner: false, profile: null });
    expect(parseProfileState({ exists: true, is_owner: true, profile: { business_name: "A" } }).profile?.business_name).toBe("A");
  });
  it("profile fields win over env, blanks fall back to env", () => {
    const env = { SHOP_NAME: "Env shop", SHOP_PHONE: "090", SHOP_ADDRESS: "Env addr" };
    expect(mergeShopInfo({ business_name: "HKD A", tax_code: "0123456789", residence_address: " ", phone: null }, env)).toEqual({
      name: "HKD A", taxCode: "0123456789", address: "Env addr", phone: "090", email: undefined,
    });
    expect(mergeShopInfo(null, env).name).toBe("Env shop");
  });
  it("loadShopInfo reads get_business_profile and degrades to env on error", async () => {
    const ok = { rpc: vi.fn().mockResolvedValue({ data: { exists: true, profile: { business_name: "HKD A" } }, error: null }) };
    expect((await loadShopInfo(ok, {})).name).toBe("HKD A");
    expect(ok.rpc).toHaveBeenCalledWith("get_business_profile");
    const bad = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }) };
    expect((await loadShopInfo(bad, { SHOP_NAME: "E" })).name).toBe("E");
    const thrown = { rpc: vi.fn().mockRejectedValue(new Error("net")) };
    expect((await loadShopInfo(thrown, {})).name).toBe("Shop Manager");
  });
});
