import { describe, expect, it, vi } from "vitest";
import { bootstrapAdmin, validateAdminPassword } from "@/lib/supabase/bootstrap";

const mk = (error: { message: string } | null) => ({
  auth: { admin: { createUser: vi.fn().mockResolvedValue({ data: {}, error }) } },
});

describe("bootstrapAdmin", () => {
  it("rejects missing, sample and short passwords without calling Supabase", async () => {
    for (const password of [undefined, "", "ChangeMeToAStrongPassword123!", "short1!"]) {
      const c = mk(null);
      const r = await bootstrapAdmin(c as never, { password });
      expect(r.ok).toBe(false);
      expect(c.auth.admin.createUser).not.toHaveBeenCalled();
    }
    expect(validateAdminPassword("a-long-enough-pass-1")).toBeNull();
  });
  it("creates the user (email configurable, normalised)", async () => {
    const c = mk(null);
    const r = await bootstrapAdmin(c as never, { email: " Boss@Shop.vn ", password: "a-long-enough-pass-1" });
    expect(r).toEqual({ ok: true, status: "created", email: "boss@shop.vn" });
    expect(c.auth.admin.createUser).toHaveBeenCalledWith({ email: "boss@shop.vn", password: "a-long-enough-pass-1", email_confirm: true });
  });
  it("is idempotent when the user already exists", async () => {
    const r = await bootstrapAdmin(mk({ message: "A user with this email address has already been registered" }) as never, { password: "a-long-enough-pass-1" });
    expect(r).toMatchObject({ ok: true, status: "exists", email: "admin@shop.local" });
  });
  it("surfaces other errors", async () => {
    const r = await bootstrapAdmin(mk({ message: "boom" }) as never, { password: "a-long-enough-pass-1" });
    expect(r).toEqual({ ok: false, error: "boom" });
  });
});
