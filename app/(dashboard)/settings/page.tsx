import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { rpcOrThrow } from "@/lib/reports";
import { unwrap } from "@/lib/actions/_shared";
import { formatVND } from "@/lib/utils";
import { parseThresholdStatus } from "@/lib/hkd/threshold";
import { parseProfileState, type BusinessLocation, type TaxGroup } from "@/lib/hkd/profile";
import { ThresholdProgress } from "@/components/threshold-progress";
import { BusinessProfileForm } from "./business-profile-form";
import { LocationsCard } from "./locations-card";

export const metadata = {
  title: "Cài đặt | Shop Manager",
};

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const sb = await createClient();
  const [profileRes, locRes, groupRes, threshold] = await Promise.all([
    sb.rpc("get_business_profile"),
    sb.from("business_locations").select("id, name, address, main_tax_group, is_hq, status, opened_on, closed_on, tax_location_code, notes").order("is_hq", { ascending: false }).order("created_at"),
    sb.from("tax_groups").select("code, name_vi").order("sort_order"),
    rpcOrThrow(sb, "threshold_status", undefined, parseThresholdStatus),
  ]);
  if (profileRes.error) throw new Error("get_business_profile: " + profileRes.error.message);
  const state = parseProfileState(profileRes.data);
  const locations = unwrap<BusinessLocation[]>(locRes, "business_locations");
  const groups = unwrap<TaxGroup[]>(groupRes, "tax_groups");

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cài đặt</h1>
        <p className="text-sm text-muted-foreground">
          Hồ sơ hộ kinh doanh, địa điểm và thông tin hiển thị trên báo giá, sổ sách & tờ khai
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Hồ sơ hộ kinh doanh</CardTitle>
          <CardDescription>
            Dùng làm tiêu đề sổ S1a, tờ khai và báo giá (thay cho biến môi trường SHOP_*).
            {!state.exists && " Chưa có hồ sơ — hiện báo giá đang dùng biến môi trường SHOP_* nếu có."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BusinessProfileForm profile={state.profile} groups={groups} canEdit={state.is_owner} showCitizenId={state.is_owner} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Địa điểm kinh doanh</CardTitle>
          <CardDescription>Trụ sở và các địa điểm khác (kho, cửa hàng phụ). Mỗi hộ có tối đa một trụ sở đang hoạt động.</CardDescription>
        </CardHeader>
        <CardContent>
          <LocationsCard locations={locations} groups={groups} canEdit={state.is_owner} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Doanh thu năm {threshold.year} so với ngưỡng miễn thuế</CardTitle>
          <CardDescription>
            Ngưỡng nằm trong bảng cấu hình pháp lý (hiện {threshold.threshold === null ? "chưa cấu hình" : formatVND(threshold.threshold)}
            {threshold.source ? ` — ${threshold.source}` : ""}). Cảnh báo ở {threshold.warn_pct}% và 100%.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <ThresholdProgress status={threshold} />
          <Link href="/reports/revenue" className="text-primary hover:underline">Xem doanh thu theo tháng →</Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Telegram Bot</CardTitle>
          <CardDescription>Kết nối Telegram để điều khiển từ xa</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Trong file <code className="rounded bg-muted px-1">bot/.env</code>:
          </p>
          <div className="rounded bg-muted p-4 font-mono text-xs">
            <div>TELEGRAM_BOT_TOKEN=...</div>
            <div>SUPABASE_URL=...</div>
            <div>SUPABASE_SERVICE_ROLE_KEY=...</div>
            <div>APP_URL=https://your-app.vercel.app</div>
          </div>
          <p className="text-muted-foreground">
            Sau đó: <code className="rounded bg-muted px-1">cd bot &amp;&amp; npm install &amp;&amp; npm run dev</code>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Thông tin database</CardTitle>
          <CardDescription>Supabase project</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Schema và RLS nằm trong <code>supabase/migrations/*.sql</code> (áp dụng theo thứ tự số, xem <code>supabase/README-migrations.md</code>). Luôn sao lưu trước khi áp dụng migration lên production.
          </p>
          <p className="text-muted-foreground">
            Seed data mẫu: <code>supabase/seed.sql</code>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}