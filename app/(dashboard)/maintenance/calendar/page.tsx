import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { statusVariant, priorityVariant } from "@/lib/maintenance";
import { vnDate, vnMonthRange, vnParts } from "@/lib/time";
import { formatDate } from "@/lib/utils";
import type { TicketStatus, TicketPriority } from "@/types/db";

interface SearchParams {
  month?: string; // "YYYY-MM"
}

const MONTH_NAMES_VN = [
  "Tháng 1",
  "Tháng 2",
  "Tháng 3",
  "Tháng 4",
  "Tháng 5",
  "Tháng 6",
  "Tháng 7",
  "Tháng 8",
  "Tháng 9",
  "Tháng 10",
  "Tháng 11",
  "Tháng 12",
];

const WEEKDAY_NAMES_VN = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

function parseMonth(s?: string): { year: number; month: number } {
  if (s && /^\d{4}-\d{2}$/.test(s)) {
    const [y, m] = s.split("-").map(Number);
    return { year: y, month: m };
  }
  const now = vnParts();
  return { year: now.year, month: now.month };
}

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

export default async function CalendarPage(
  props: {
    searchParams: Promise<SearchParams>;
  }
) {
  const searchParams = await props.searchParams;
  const { year, month } = parseMonth(searchParams.month);
  const first = new Date(year, month - 1, 1);
  const startWeekday = first.getDay(); // 0=Sun
  const daysInMonth = new Date(year, month, 0).getDate();

  const range = vnMonthRange(year, month);

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("maintenance_tickets")
    .select(
      "id, code, title, status, priority, started_at, customers(name)",
    )
    .not("started_at", "is", null)
    .gte("started_at", range.from)
    .lt("started_at", range.to)
    .order("started_at", { ascending: true })
    .limit(500);

  // Bucket by yyyy-mm-dd (local)
  const byDay = new Map<string, NonNullable<typeof rows>>();
  for (const t of rows ?? []) {
    if (!t.started_at) continue;
    const key = vnDate(t.started_at);
    const list = byDay.get(key) ?? [];
    list.push(t);
    byDay.set(key, list);
  }

  // Navigation
  const prevMonth = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const nextMonth = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };

  // Build grid: 6 weeks * 7 days = 42 cells
  const cells: Array<{ date: Date; inMonth: boolean }> = [];
  for (let i = 0; i < 42; i++) {
    const dayIndex = i - startWeekday + 1; // 1-based day of month
    const d = new Date(year, month - 1, dayIndex);
    cells.push({ date: d, inMonth: d.getMonth() === month - 1 });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Lịch bảo trì
          </h1>
          <p className="text-sm text-muted-foreground">
            Các ticket có ngày bắt đầu (started_at) trong tháng.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link
              href={`/maintenance/calendar?month=${prevMonth.year}-${pad(prevMonth.month)}`}
            >
              <ChevronLeft className="mr-1 h-4 w-4" /> Trước
            </Link>
          </Button>
          <div className="rounded-md border bg-card px-3 py-1 text-sm font-medium">
            {MONTH_NAMES_VN[month - 1]} {year}
          </div>
          <Button asChild variant="outline" size="sm">
            <Link
              href={`/maintenance/calendar?month=${nextMonth.year}-${pad(nextMonth.month)}`}
            >
              Sau <ChevronRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Tổng: {rows?.length ?? 0} ticket trong tháng
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 text-center text-xs font-medium text-muted-foreground">
            {WEEKDAY_NAMES_VN.map((d) => (
              <div key={d} className="border-b py-2">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map(({ date, inMonth }, i) => {
              const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
              const items = byDay.get(key) ?? [];
              const isToday =
                key === vnDate();
              return (
                <div
                  key={i}
                  className={
                    "min-h-[110px] border-b border-r p-1 text-xs " +
                    (inMonth ? "" : "bg-muted/30 text-muted-foreground")
                  }
                >
                  <div
                    className={
                      "mb-1 inline-flex h-5 w-5 items-center justify-center rounded-full " +
                      (isToday
                        ? "bg-primary text-primary-foreground"
                        : "text-foreground")
                    }
                  >
                    {date.getDate()}
                  </div>
                  <ul className="space-y-1">
                    {items.slice(0, 3).map((t) => {
                      const cust = (
                        t as unknown as { customers: { name: string } | null }
                      ).customers;
                      return (
                        <li key={t.id} className="truncate">
                          <Link
                            href={`/maintenance/tickets/${t.id}`}
                            className="block rounded bg-primary/10 px-1 py-0.5 text-[11px] hover:bg-primary/20"
                            title={`${t.code} · ${t.title} · ${cust?.name ?? ""}`}
                          >
                            <span className="font-medium">{t.code}</span>{" "}
                            <span className="text-muted-foreground">
                              {t.title}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                    {items.length > 3 && (
                      <li className="text-[10px] text-muted-foreground">
                        +{items.length - 3} khác
                      </li>
                    )}
                  </ul>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Chi tiết tháng {month}/{year}</CardTitle>
        </CardHeader>
        <CardContent>
          {(rows?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">
              Không có ticket nào trong tháng này.
            </p>
          ) : (
            <ul className="space-y-2">
              {(rows ?? []).map((t) => {
                const cust = (
                  t as unknown as { customers: { name: string } | null }
                ).customers;
                return (
                  <li
                    key={t.id}
                    className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm"
                  >
                    <Link
                      className="font-medium text-primary hover:underline"
                      href={`/maintenance/tickets/${t.id}`}
                    >
                      {t.code}
                    </Link>
                    <span className="flex-1 truncate">{t.title}</span>
                    <Badge variant={priorityVariant(t.priority as TicketPriority)}>
                      {t.priority}
                    </Badge>
                    <Badge variant={statusVariant(t.status as TicketStatus)}>
                      {t.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {cust?.name ?? "—"} ·{" "}
                      {t.started_at
                        ? formatDate(t.started_at)
                        : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}