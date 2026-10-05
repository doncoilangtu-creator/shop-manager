import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { buildTknFile } from "@/lib/books/tax-forms-export";
import { tknPeriod, type TknPeriodKind } from "@/lib/books/tax-forms";
import { exportError, sendRecordedFile } from "@/lib/books/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/books/tkn-cnkd?year=YYYY&kind=year|h1|h2&format=xlsx|pdf — số liệu thông báo doanh thu 01/TKN-CNKD (HKD ≤ 1 tỷ). */
export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  const q = req.nextUrl.searchParams;
  const year = Number(q.get("year"));
  if (!Number.isInteger(year) || year < 2020 || year > 2100) return NextResponse.json({ error: "Năm không hợp lệ" }, { status: 400 });
  const k = q.get("kind");
  const kind: TknPeriodKind = k === "h1" || k === "h2" ? k : "year";
  const format = q.get("format") === "pdf" ? "pdf" : "xlsx";
  try {
    const f = await buildTknFile(auth.supabase, year, kind, format);
    const p = tknPeriod(year, kind).period;
    return await sendRecordedFile(auth.supabase, f, { kind: "tkn_cnkd", period_from: p.from, period_to: p.to, options: { period: kind } }, format);
  } catch (e) {
    return exportError("books/tkn-cnkd", e);
  }
}
