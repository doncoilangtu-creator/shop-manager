import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatVND } from "@/lib/utils";
import { vnDate } from "@/lib/time";
import { PaymentDialog } from "./payment-dialog";

export type OpenItem = { id: string; no: string; date: string; due: string | null; total: number; outstanding: number };

/** Sổ phụ công nợ (phải thu / phải trả) lấy từ sổ kế toán — số liệu đối chiếu được với TK 131 / 331. */
export function OpenItemsCard(props: {
  kind: "receipt" | "disbursement";
  partnerId: string;
  balance: number;
  glBalance: number | null;
  items: OpenItem[];
}) {
  const isAr = props.kind === "receipt";
  const today = vnDate();
  const mismatch = props.glBalance !== null && Math.abs(props.glBalance - props.balance) > 0.005;
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>{isAr ? "Công nợ phải thu (sổ kế toán)" : "Công nợ phải trả (sổ kế toán)"}</CardTitle>
          <CardDescription>
            Số dư: <span className={props.balance > 0 ? "font-semibold text-destructive" : "font-medium"}>{formatVND(props.balance)}</span>
            {props.balance < 0 && " (khách trả dư / ứng trước)"}
            {mismatch && <span className="ml-2 text-destructive">⚠ lệch sổ cái {formatVND(props.glBalance)}</span>}
          </CardDescription>
        </div>
        <PaymentDialog kind={props.kind} partnerId={props.partnerId} outstanding={Math.max(props.balance, 0)} />
      </CardHeader>
      <CardContent>
        {props.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Không có chứng từ còn nợ.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Số</TableHead>
                <TableHead>Ngày</TableHead>
                <TableHead>Hạn</TableHead>
                <TableHead className="text-right">Tổng</TableHead>
                <TableHead className="text-right">Còn nợ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.items.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-mono text-xs">{i.no}</TableCell>
                  <TableCell>{formatDate(i.date)}</TableCell>
                  <TableCell className={i.due && i.due < today ? "font-medium text-destructive" : ""}>{formatDate(i.due)}</TableCell>
                  <TableCell className="text-right">{formatVND(i.total)}</TableCell>
                  <TableCell className="text-right font-medium">{formatVND(i.outstanding)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
