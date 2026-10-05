import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { buildBkStkFile } from "@/lib/books/tax-forms-export";
import { exportError, sendRecordedFile } from "@/lib/books/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/books/bk-stk?scope=pending|all&format=xlsx|pdf — bảng kê tài khoản 01/BK-STK (số tài khoản đầy đủ: chỉ chủ hộ; RPC tự chặn nhân viên). */
export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  const q = req.nextUrl.searchParams;
  const scope = q.get("scope") === "all" ? "all" : "pending";
  const format = q.get("format") === "pdf" ? "pdf" : "xlsx";
  try {
    const f = await buildBkStkFile(auth.supabase, scope, format);
    const d = f.header.createdOn;
    return await sendRecordedFile(auth.supabase, f, { kind: "bk_stk", period_from: d, period_to: d, options: { scope } }, format);
  } catch (e) {
    return exportError("books/bk-stk", e);
  }
}
