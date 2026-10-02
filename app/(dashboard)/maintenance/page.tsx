import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default async function MaintenancePage() {
  const supabase = await createClient();
  const [contracts, openTickets, signedTickets] = await Promise.all([
    supabase
      .from("maintenance_contracts")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),
    supabase
      .from("maintenance_tickets")
      .select("id", { count: "exact", head: true })
      .not("status", "in", "(signed,closed)"),
    supabase
      .from("maintenance_tickets")
      .select("id", { count: "exact", head: true })
      .in("status", ["signed", "closed"]),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Bảo trì</h1>
        <p className="text-sm text-muted-foreground">
          Quản lý hợp đồng, ticket, log công việc, ký online.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Hợp đồng hiệu lực
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {contracts.count ?? 0}
            </div>
            <Button asChild variant="link" size="sm" className="px-0">
              <Link href="/maintenance/contracts">Xem hợp đồng →</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Ticket đang mở
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{openTickets.count ?? 0}</div>
            <Button asChild variant="link" size="sm" className="px-0">
              <Link href="/maintenance/tickets">Xem ticket →</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Đã ký / đóng</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {signedTickets.count ?? 0}
            </div>
            <Button asChild variant="link" size="sm" className="px-0">
              <Link href="/maintenance/reports">Xem báo cáo →</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Lối tắt</CardTitle>
            <CardDescription>Truy cập nhanh các chức năng</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Button asChild variant="outline" className="justify-start">
              <Link href="/maintenance/contracts/new">+ Tạo hợp đồng bảo trì</Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link href="/maintenance/tickets/new">+ Tiếp nhận ticket mới</Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link href="/maintenance/calendar">📅 Lịch bảo trì tháng</Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link href="/maintenance/reports">📊 Báo cáo tháng</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Quy trình ticket</CardTitle>
            <CardDescription>8 trạng thái, có thể chuyển tiếp theo workflow</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {(
              [
                "received",
                "assigned",
                "in_progress",
                "waiting_parts",
                "completed",
                "awaiting_signature",
                "signed",
                "closed",
              ] as const
            ).map((s) => (
              <Badge key={s} variant="outline">
                {s}
              </Badge>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}