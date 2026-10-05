import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { validatePeriod } from "@/lib/books/period";
import { buildS1aFile } from "@/lib/books/s1a-export";
import { sha256Hex } from "@/lib/books/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/** GET /api/books/s1a?from=YYYY-MM-DD&to=YYYY-MM-DD&location=<uuid|>&mode=detail|daily&format=xlsx|pdf — xuất sổ S1a-HKD, ghi nhật ký xuất (SHA-256). */
export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  const q = req.nextUrl.searchParams;
  const p = validatePeriod({ from: q.get("from"), to: q.get("to") });
  if (typeof p === "string") return NextResponse.json({ error: p }, { status: 400 });
  const loc = q.get("location") || null;
  if (loc && !UUID.test(loc)) return NextResponse.json({ error: "Địa điểm không hợp lệ" }, { status: 400 });
  const mode = q.get("mode") === "daily" ? "daily" : "detail";
  const format = q.get("format") === "pdf" ? "pdf" : "xlsx";
  try {
    const f = await buildS1aFile(auth.supabase, p, loc, mode, format);
    const sha = sha256Hex(f.bytes);
    const { error } = await auth.supabase.rpc("record_book_export", {
      p: { kind: "s1a", period_from: p.from, period_to: p.to, location_id: loc ?? "", format, file_name: f.fileName, sha256: sha, row_count: f.rowCount, total: f.total, template_version: f.templateVersion, options: { mode } },
    });
    if (error) return NextResponse.json({ error: "Không ghi được nhật ký xuất sổ: " + error.message }, { status: 500 });
    return new NextResponse(Buffer.from(f.bytes), {
      status: 200,
      headers: {
        "Content-Type": f.contentType,
        "Content-Disposition": `attachment; filename="${f.fileName}"`,
        "X-Content-SHA256": sha,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("location_not_found")) return NextResponse.json({ error: "Không tìm thấy địa điểm" }, { status: 404 });
    if (msg.includes("forbidden")) return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
    console.error("[books/s1a]", msg);
    return NextResponse.json({ error: "Không xuất được sổ" }, { status: 500 });
  }
}
