import { beforeEach, describe, expect, it, vi } from "vitest";

// C1: every exported server action must reject an unauthenticated caller
// BEFORE touching the service-role client.
const getUser = vi.fn();
const adminFrom = vi.fn(() => {
  throw new Error("admin client must not be used when unauthenticated");
});
const createAdminClient = vi.fn(() => ({ from: adminFrom, storage: { from: adminFrom }, auth: {} }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser }, from: adminFrom }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (u: string) => {
    throw new Error("NEXT_REDIRECT:" + u);
  },
}));

const MODULES = {
  customers: () => import("@/lib/actions/customers"),
  inventory: () => import("@/lib/actions/inventory"),
  suppliers: () => import("@/lib/actions/suppliers"),
  maintenance: () => import("@/app/(dashboard)/maintenance/actions"),
  quotations: () => import("@/lib/quotations/actions"),
};
const EXPECTED_ACTIONS = { customers: 3, inventory: 5, suppliers: 5, maintenance: 7, quotations: 8 };

const UUID = "11111111-1111-4111-8111-111111111111";
const fd = () => new FormData();

beforeEach(() => {
  getUser.mockReset();
  createAdminClient.mockClear();
  adminFrom.mockClear();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co";
});

describe.each(Object.entries(MODULES))("unauthenticated → denied: %s", (name, load) => {
  it("exports the expected number of actions (guard against unguarded additions)", async () => {
    const mod = await load();
    const fns = Object.entries(mod).filter(([, v]) => typeof v === "function");
    expect(fns.length).toBe(EXPECTED_ACTIONS[name as keyof typeof EXPECTED_ACTIONS]);
  });

  it.each([
    ["no session", { data: { user: null }, error: null }],
    ["auth error", { data: { user: null }, error: { message: "jwt expired" } }],
  ])("every action denies (%s) and never builds the admin client", async (_label, resp) => {
    getUser.mockResolvedValue(resp);
    const mod = await load();
    for (const [fn, action] of Object.entries(mod)) {
      if (typeof action !== "function") continue;
      const call = (action as (...a: unknown[]) => Promise<unknown>)(UUID, fd(), "x");
      // first arg may need to be FormData or an object depending on action; try variants
      let result: unknown;
      try {
        result = await call;
      } catch (e) {
        // form actions without a result object throw Unauthorized
        expect((e as Error).message, fn).toBe("Unauthorized");
        continue;
      }
      expect(result, fn).toEqual({ ok: false, error: "Unauthorized" });
    }
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(adminFrom).not.toHaveBeenCalled();
  });
});

describe("authenticated callers pass the guard", () => {
  it("createCustomer proceeds to validation (not Unauthorized)", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    const { createCustomer } = await MODULES.customers();
    const r = await createCustomer(fd());
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).not.toBe("Unauthorized");
  });

  it("saveQuotationPdfUrlAction rejects URLs outside our storage bucket", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    const { saveQuotationPdfUrlAction } = await MODULES.quotations();
    for (const bad of [
      "https://evil.example/storage/v1/object/public/quotations/a.pdf",
      "https://dummy.supabase.co/storage/v1/object/public/other/a.pdf",
      "javascript:alert(1)",
      "https://dummy.supabase.co@evil.example/storage/v1/object/public/quotations/a.pdf",
    ]) {
      const r = await saveQuotationPdfUrlAction(UUID, bad);
      expect(r, bad).toEqual({ ok: false, error: "URL PDF không hợp lệ" });
    }
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
