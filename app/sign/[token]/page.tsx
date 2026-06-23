import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignForm } from "./sign-form";

interface PageProps {
  params: { token: string };
}

export default async function SignPage({ params }: PageProps) {
  const { token } = params;
  const supabase = createClient();

  const { data: row, error } = await supabase
    .from("signature_tokens")
    .select(
      "id, ticket_id, expires_at, used_at, maintenance_tickets(id, code, title, description, customer_id, customers(name))",
    )
    .eq("token", token)
    .maybeSingle();

  if (error || !row) notFound();
  if (row.used_at) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="max-w-md rounded-lg border bg-card p-6 text-center shadow-sm">
          <h1 className="text-xl font-semibold">Link đã được sử dụng</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Link ký online này đã được dùng. Vui lòng liên hệ cửa hàng để được
            cấp link mới.
          </p>
        </div>
      </main>
    );
  }
  if (new Date(row.expires_at) < new Date()) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="max-w-md rounded-lg border bg-card p-6 text-center shadow-sm">
          <h1 className="text-xl font-semibold">Link đã hết hạn</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Link ký online này đã hết hạn. Vui lòng liên hệ cửa hàng.
          </p>
        </div>
      </main>
    );
  }

  const ticket = Array.isArray(row.maintenance_tickets)
    ? row.maintenance_tickets[0]
    : row.maintenance_tickets;

  const customer = ticket
    ? (ticket as unknown as { customers: { name: string }[] | { name: string } | null }).customers
      ? Array.isArray((ticket as unknown as { customers: unknown }).customers)
        ? ((ticket as unknown as { customers: { name: string }[] }).customers[0] ?? null)
        : ((ticket as unknown as { customers: { name: string } | null }).customers ?? null)
      : null
    : null;

  // Already-signed check: if both customer + technician already exist,
  // don't let the user re-sign.
  const { data: existingSigs } = await supabase
    .from("signatures")
    .select("signer_role")
    .eq("ticket_id", row.ticket_id);
  const rolesSigned = new Set(
    (existingSigs ?? []).map((s) => s.signer_role as string),
  );

  return (
    <main className="min-h-screen bg-muted/30 p-4">
      <div className="mx-auto max-w-xl space-y-4">
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <h1 className="text-xl font-semibold">Xác nhận nghiệm thu</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Vui lòng ký tên dưới đây để xác nhận công việc bảo trì đã hoàn tất.
          </p>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Mã phiếu</dt>
              <dd className="font-medium">{ticket?.code}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Tiêu đề</dt>
              <dd className="font-medium">{ticket?.title}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Khách hàng</dt>
              <dd className="font-medium">{customer?.name ?? "—"}</dd>
            </div>
            {ticket?.description && (
              <div>
                <dt className="text-muted-foreground">Mô tả</dt>
                <dd className="mt-1 whitespace-pre-line rounded bg-muted/40 p-2 text-sm">
                  {ticket.description}
                </dd>
              </div>
            )}
          </dl>
        </div>
        <SignForm
          token={token}
          ticketId={row.ticket_id}
          alreadySignedRoles={Array.from(rolesSigned)}
        />
      </div>
    </main>
  );
}