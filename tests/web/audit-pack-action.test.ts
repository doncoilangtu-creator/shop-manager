import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUDIT_PACK_MAX_BYTES, auditPackErrorMessage, auditPackSizeError, parseAuditPackRequest } from "@/lib/books/audit-pack";

const rpc = vi.fn();
const auth = { ok: true as const, user: { id: "u1", email: "owner@example.com" }, supabase: { rpc } };
const requireUser = vi.fn();
const buildAuditPackZip = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/books/audit-pack-export", () => ({ buildAuditPackZip: (...a: unknown[]) => buildAuditPackZip(...a) }));
vi.mock("@/lib/time", async (orig) => ({ ...(await orig<typeof import("@/lib/time")>()), vnDate: () => "2026-10-05" }));

const { exportAuditPackAction } = await import("@/lib/actions/audit-pack");

function pack(size = 1000, isOwner = true) {
  return {
    bytes: new Uint8Array(size),
    sha256: "a".repeat(64),
    fileName: "HoSoKiemTra_8012345678_2026-H1.zip",
    templateVersion: "audit_pack/1",
    files: [{ path: "01-so-S1a/S1a.xlsx" }, { path: "05-tien/Tien.xlsx" }],
    input: { isOwner, period: { from: "2026-01-01", to: "2026-06-30" }, s1aCheck: { diff: 0 }, sales: [{ total: 100 }, { total: 50.5 }] },
  };
}

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: "id-1", error: null });
  requireUser.mockReset().mockResolvedValue(auth);
  buildAuditPackZip.mockReset().mockResolvedValue(pack());
});

describe("parseAuditPackRequest / helpers", () => {
  it("accepts valid year+kind (string year coerced)", () => {
    expect(parseAuditPackRequest({ year: "2026", kind: "h1" }, "2026-10-05")).toEqual({ success: true, data: { year: 2026, kind: "h1" } });
  });
  it("rejects bad kind, bad year, future year with Vietnamese messages", () => {
    const k = parseAuditPackRequest({ year: 2026, kind: "q3" }, "2026-10-05");
    expect(k.success).toBe(false);
    expect(!k.success && k.error).toMatch(/Kỳ không hợp lệ/);
    const y = parseAuditPackRequest({ year: 2019, kind: "year" }, "2026-10-05");
    expect(!y.success && y.error).toMatch(/Năm không hợp lệ/);
    const f = parseAuditPackRequest({ year: 2027, kind: "year" }, "2026-10-05");
    expect(!f.success && f.error).toMatch(/năm chưa tới/);
    expect(parseAuditPackRequest({ year: 2026.5, kind: "year" }, "2026-10-05").success).toBe(false);
    expect(parseAuditPackRequest(null, "2026-10-05").success).toBe(false);
  });
  it("size guard: limit keeps base64 under Vercel 4.5 MB", () => {
    expect(Math.ceil(AUDIT_PACK_MAX_BYTES / 3) * 4).toBeLessThan(4.5 * 1024 * 1024);
    expect(auditPackSizeError(AUDIT_PACK_MAX_BYTES)).toBeNull();
    expect(auditPackSizeError(AUDIT_PACK_MAX_BYTES + 1)).toMatch(/quá lớn/);
  });
  it("maps errors to Vietnamese", () => {
    expect(auditPackErrorMessage("forbidden")).toMatch(/Không có quyền/);
    expect(auditPackErrorMessage("record_book_export: boom")).toMatch(/nhật ký/);
    expect(auditPackErrorMessage("weird")).toMatch(/Không xuất được/);
  });
});

describe("exportAuditPackAction", () => {
  it("unauthenticated → returns auth failure, builds nothing", async () => {
    requireUser.mockResolvedValue({ ok: false, error: "Unauthorized" });
    expect(await exportAuditPackAction({ year: 2026, kind: "h1" })).toEqual({ ok: false, error: "Unauthorized" });
    expect(buildAuditPackZip).not.toHaveBeenCalled();
  });

  it("invalid payload → validation error, builds nothing", async () => {
    const r = await exportAuditPackAction({ year: 2026, kind: "bad" });
    expect(r.ok).toBe(false);
    expect(buildAuditPackZip).not.toHaveBeenCalled();
    const f = await exportAuditPackAction({ year: 2030, kind: "year" });
    expect(!f.ok && f.error).toMatch(/năm chưa tới/);
  });

  it("success → records audit_pack/zip with sha256 + period, returns base64", async () => {
    const r = await exportAuditPackAction({ year: 2026, kind: "h1" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.filename).toBe("HoSoKiemTra_8012345678_2026-H1.zip");
    expect(r.data.bytes).toBe(1000);
    expect(Buffer.from(r.data.base64, "base64").byteLength).toBe(1000);
    expect(buildAuditPackZip).toHaveBeenCalledWith(auth.supabase, { year: 2026, kind: "h1", generatedBy: "owner@example.com" });
    expect(rpc).toHaveBeenCalledTimes(1);
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe("record_book_export");
    expect(args.p).toMatchObject({ kind: "audit_pack", format: "zip", sha256: "a".repeat(64), period_from: "2026-01-01", period_to: "2026-06-30", row_count: 2, total: 150.5 });
    expect(args.p.options).toMatchObject({ year: 2026, kind: "h1", bk_stk_included: true });
  });

  it("zip too large → refuses with Vietnamese message and does not record", async () => {
    buildAuditPackZip.mockResolvedValue(pack(AUDIT_PACK_MAX_BYTES + 1));
    const r = await exportAuditPackAction({ year: 2026, kind: "year" });
    expect(!r.ok && r.error).toMatch(/quá lớn/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("record_book_export error → no file returned", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "export_invalid" } });
    const r = await exportAuditPackAction({ year: 2026, kind: "h1" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/nhật ký/);
  });

  it("builder throws forbidden → Vietnamese permission message", async () => {
    buildAuditPackZip.mockRejectedValue(new Error("book_s1a_check: forbidden"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await exportAuditPackAction({ year: 2026, kind: "h1" });
    expect(!r.ok && r.error).toMatch(/Không có quyền/);
    spy.mockRestore();
  });
});
