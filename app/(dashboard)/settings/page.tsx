import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: "Cài đặt | Shop Manager",
};

export default function SettingsPage() {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cài đặt</h1>
        <p className="text-sm text-muted-foreground">
          Thông tin shop hiển thị trên báo giá & tài liệu
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Thông tin shop</CardTitle>
          <CardDescription>
            Hiện tại đang dùng biến môi trường. Cập nhật trong file .env.local:
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="rounded bg-muted p-4 font-mono text-xs">
            <div>SHOP_NAME=&quot;Tên shop của anh&quot;</div>
            <div>SHOP_TAX_CODE=&quot;MST&quot;</div>
            <div>SHOP_ADDRESS=&quot;Địa chỉ&quot;</div>
            <div>SHOP_PHONE=&quot;SĐT&quot;</div>
            <div>SHOP_EMAIL=&quot;email@shop.vn&quot;</div>
          </div>
          <p className="mt-3 text-muted-foreground">
            Restart server (<code className="rounded bg-muted px-1">npm run dev</code>) sau khi đổi env để áp dụng.
          </p>
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
            Schema 16 bảng + RLS policies được lưu trong <code>supabase/migrations/0001_init.sql</code>.
            Chạy file này trong Supabase SQL Editor để setup lần đầu.
          </p>
          <p className="text-muted-foreground">
            Seed data mẫu: <code>supabase/seed.sql</code>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}