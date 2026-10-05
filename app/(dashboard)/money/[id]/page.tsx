import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";
import { rpcOrThrow } from "@/lib/reports";
import { formatDate, formatVND } from "@/lib/utils";
import { MONEY_KIND_LABEL, accountLabel, parseMoneyBalances, type MoneyKind } from "@/lib/money/schema";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sổ tiền | Shop Manager" };

type BookRow = { entry_date: string; entry_no: string; memo: string | null; source_type: string | null; debit: number; credit: number; running: number };
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const parseBook = (raw: unknown): BookRow[] =>
  (Array.isArray(raw) ? raw : []).map((o: Record<string, unknown>) => ({
    entry_date: String(o.entry_date), entry_no: String(o.entry_no ?? ""), memo: typeof o.memo === "string" ? o.memo : null,
    source_type: typeof o.source_type === "string" ? o.source_type : null, debit: num(o.debit), credit: num(o.credit), running: num(o.running),
  }));
const dateOrNull = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export default async function MoneyBookPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const un = /^unassigned-(111|112)$/.exec(id);
  if (!un && !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sb = await createClient();
  const balances = await rpcOrThrow(sb, "money_balances", undefined, parseMoneyBalances);
  const acct = un ? balances.find((b) => b.unassigned && b.gl_account === un[1]) : balances.find((b) => b.account_id === id);
  if (!acct) notFound();
  const from = dateOrNull(sp.from), to = dateOrNull(sp.to);
  const book = await rpcOrThrow(sb, "money_book", { p_account_id: un ? null : id, p_from: from, p_to: to, p_gl: un ? un[1] : null }, parseBook);
  const totalDebit = book.reduce((a, r) => a + r.debit, 0), totalCredit = book.reduce((a, r) => a + r.credit, 0);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="Quay lại"><Link href="/money"><ArrowLeft className="h-4 w-4" /></Link></Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{acct.unassigned ? acct.label : accountLabel(acct)}</h1>
          <p className="text-sm text-muted-foreground">{acct.unassigned ? "Tiền phát sinh chưa gắn tài khoản" : MONEY_KIND_LABEL[acct.kind as MoneyKind]} · TK {acct.gl_account} · Số dư hiện tại <strong>{formatVND(acct.balance)}</strong></p>
        </div>
      </div>
      <form className="flex flex-wrap items-end gap-3" method="get">
        <div className="space-y-1"><label htmlFor="bk-from" className="text-sm font-medium">Từ ngày</label><input id="bk-from" name="from" type="date" defaultValue={from ?? ""} className="h-9 rounded-md border bg-background px-3 text-sm" /></div>
        <div className="space-y-1"><label htmlFor="bk-to" className="text-sm font-medium">Đến ngày</label><input id="bk-to" name="to" type="date" defaultValue={to ?? ""} className="h-9 rounded-md border bg-background px-3 text-sm" /></div>
        <Button type="submit" size="sm" variant="outline">Lọc</Button>
      </form>
      <Card>
        <CardHeader><CardTitle>Sổ tiền</CardTitle><CardDescription>Thu = tăng quỹ (Nợ), chi = giảm quỹ (Có). Số dư lũy kế tính từ đầu kỳ dữ liệu, không phụ thuộc bộ lọc ngày.</CardDescription></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Ngày</TableHead><TableHead>Số bút toán</TableHead><TableHead>Diễn giải</TableHead><TableHead className="text-right">Thu</TableHead><TableHead className="text-right">Chi</TableHead><TableHead className="text-right">Tồn</TableHead></TableRow></TableHeader>
            <TableBody>
              {book.length === 0 && <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">Chưa có phát sinh.</TableCell></TableRow>}
              {book.map((r, i) => (
                <TableRow key={`${r.entry_no}-${i}`}>
                  <TableCell>{formatDate(r.entry_date)}</TableCell>
                  <TableCell className="font-mono text-xs">{r.entry_no}</TableCell>
                  <TableCell>{r.memo ?? "—"}</TableCell>
                  <TableCell className="text-right">{r.debit ? formatVND(r.debit) : ""}</TableCell>
                  <TableCell className="text-right">{r.credit ? formatVND(r.credit) : ""}</TableCell>
                  <TableCell className="text-right font-medium">{formatVND(r.running)}</TableCell>
                </TableRow>
              ))}
              {book.length > 0 && (
                <TableRow className="font-medium"><TableCell colSpan={3}>Cộng phát sinh</TableCell><TableCell className="text-right">{formatVND(totalDebit)}</TableCell><TableCell className="text-right">{formatVND(totalCredit)}</TableCell><TableCell /></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
