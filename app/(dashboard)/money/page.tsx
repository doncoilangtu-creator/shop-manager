import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";
import { rpcOrThrow } from "@/lib/reports";
import { typed, unwrap } from "@/lib/actions/_shared";
import { vnDate } from "@/lib/time";
import { formatDate, formatVND } from "@/lib/utils";
import { MONEY_KIND_LABEL, parseMoneyBalances, summarizeMoney } from "@/lib/money/schema";
import { AccountDialog, OpeningDialog, ReverseTransferButton, TransferDialog, type AccountRow } from "./money-forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tiền & Quỹ | Shop Manager" };

type Transfer = {
  id: string; transfer_no: string; transfer_date: string; amount: number; memo: string | null; voided_at: string | null;
  from: { label: string } | null; to: { label: string } | null;
};

export default async function MoneyPage() {
  const sb = await createClient();
  const [rows, accRes, trRes, ownerRes, locRes] = await Promise.all([
    rpcOrThrow(sb, "money_balances", undefined, parseMoneyBalances),
    sb.from("money_accounts").select("id, kind, label, provider, account_no_masked, holder, tax_notified, tax_notified_at, is_default, active, location_id").order("gl_account").order("label"),
    sb.from("money_transfers")
      .select("id, transfer_no, transfer_date, amount, memo, voided_at, from:money_accounts!money_transfers_from_account_fkey(label), to:money_accounts!money_transfers_to_account_fkey(label)")
      .order("transfer_date", { ascending: false }).order("created_at", { ascending: false }).limit(20),
    sb.rpc("is_owner"),
    sb.from("business_locations").select("id, name, status").order("is_hq", { ascending: false }).order("created_at"),
  ]);
  const locations = ((locRes.data ?? []) as Array<{ id: string; name: string; status: string }>).filter((l) => l.status !== "closed").map((l) => ({ id: l.id, name: l.name }));
  const accounts = unwrap<AccountRow[]>(typed<AccountRow[]>(accRes), "money_accounts");
  const transfers = unwrap<Transfer[]>(typed<Transfer[]>(trRes), "money_transfers");
  const isOwner = ownerRes.data === true;
  const s = summarizeMoney(rows);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const active = accounts.filter((a) => a.active);
  const today = vnDate();

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tiền & Quỹ</h1>
          <p className="text-sm text-muted-foreground">Số dư từng tài khoản tiền mặt, ngân hàng, ví điện tử — lấy từ sổ cái (TK 111, 112), đối chiếu được với sổ quỹ / sổ tiền gửi.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <TransferDialog accounts={active} today={today} />
          {isOwner && <OpeningDialog accounts={active} today={today} />}
          {isOwner && <AccountDialog trigger="new" locations={locations} />}
        </div>
      </div>

      {s.notNotified.length > 0 && (
        <Card className="border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              Tài khoản ngân hàng/ví dùng cho hoạt động kinh doanh cần được thông báo cho cơ quan thuế (mẫu 01/BK-STK). Chưa đánh dấu đã thông báo:{" "}
              <strong>{s.notNotified.map((a) => a.label).join(", ")}</strong>. Hãy kiểm tra với kế toán/cơ quan thuế rồi cập nhật ở nút sửa tài khoản.
            </div>
          </div>
        </Card>
      )}
      {rows.some((r) => r.unassigned && r.balance !== 0) && (
        <Card className="border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>Có số tiền phát sinh trước khi tạo tài khoản mặc định (dòng “Chưa gán tài khoản”). Tạo tài khoản ngân hàng/ví và đặt làm mặc định để số dư cũ được tính vào tài khoản đó.</div>
          </div>
        </Card>
      )}
      {s.negative.length > 0 && (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>Số dư âm: <strong>{s.negative.map((a) => `${a.label} (${formatVND(a.balance)})`).join(", ")}</strong>. Thường do chưa nhập số dư đầu kỳ hoặc ghi nhầm tài khoản khi thu/chi.</div>
          </div>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardHeader className="pb-2"><CardDescription>Tổng tiền</CardDescription><CardTitle>{formatVND(s.total)}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Tiền mặt (TK 111)</CardDescription><CardTitle>{formatVND(s.cash)}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Ngân hàng & ví (TK 112)</CardDescription><CardTitle>{formatVND(s.bank)}</CardTitle></CardHeader></Card>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tài khoản</TableHead><TableHead>Loại</TableHead><TableHead>Số tài khoản</TableHead><TableHead>Thông báo thuế</TableHead>
              <TableHead className="text-right">Số dư</TableHead><TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Chưa có tài khoản tiền.</TableCell></TableRow>}
            {rows.map((r) => {
              const acc = r.account_id ? byId.get(r.account_id) : undefined;
              const href = `/money/${r.account_id ?? `unassigned-${r.gl_account}`}`;
              return (
                <TableRow key={r.account_id ?? `u-${r.gl_account}`} className={r.active ? "" : "opacity-60"}>
                  <TableCell>
                    <Link className="font-medium hover:underline" href={href}>{r.label}</Link>
                    {r.provider ? <span className="ml-2 text-xs text-muted-foreground">{r.provider}</span> : null}
                    {r.is_default && <Badge variant="secondary" className="ml-2">Mặc định</Badge>}
                    {!r.active && <Badge variant="outline" className="ml-2">Ngừng dùng</Badge>}
                  </TableCell>
                  <TableCell>{r.unassigned ? "—" : MONEY_KIND_LABEL[r.kind]}</TableCell>
                  <TableCell className="font-mono text-xs">{r.account_no_masked ?? "—"}</TableCell>
                  <TableCell>
                    {r.unassigned || r.kind === "cash" ? "—" : r.tax_notified ? <Badge>Đã thông báo{r.tax_notified_at ? ` ${formatDate(r.tax_notified_at)}` : ""}</Badge> : <Badge variant="outline">Chưa</Badge>}
                  </TableCell>
                  <TableCell className={`text-right font-medium ${r.balance < 0 ? "text-destructive" : ""}`}>{formatVND(r.balance)}</TableCell>
                  <TableCell className="text-right">{isOwner && acc ? <AccountDialog trigger="edit" account={acc} locations={locations} /> : null}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <CardHeader><CardTitle>Chuyển tiền nội bộ gần đây</CardTitle><CardDescription>Nộp/rút tiền mặt, chuyển giữa ngân hàng và ví. Hủy bằng bút toán đảo.</CardDescription></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Số phiếu</TableHead><TableHead>Ngày</TableHead><TableHead>Từ</TableHead><TableHead>Đến</TableHead><TableHead className="text-right">Số tiền</TableHead><TableHead>Trạng thái</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {transfers.length === 0 && <TableRow><TableCell colSpan={7} className="py-6 text-center text-muted-foreground">Chưa có phiếu chuyển tiền.</TableCell></TableRow>}
              {transfers.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono text-xs">{t.transfer_no}</TableCell>
                  <TableCell>{formatDate(t.transfer_date)}</TableCell>
                  <TableCell>{t.from?.label ?? "—"}</TableCell>
                  <TableCell>{t.to?.label ?? "—"}</TableCell>
                  <TableCell className="text-right">{formatVND(t.amount)}</TableCell>
                  <TableCell>{t.voided_at ? <Badge variant="destructive">Đã hủy</Badge> : <Badge>Hiệu lực</Badge>}</TableCell>
                  <TableCell>{t.voided_at ? null : <ReverseTransferButton transferId={t.id} />}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
