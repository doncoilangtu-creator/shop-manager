# Shop Manager

Hệ thống quản lý **cửa hàng máy tính** — Next.js 14 (App Router) + Supabase + Tailwind + shadcn/ui.

> Thiết kế tối giản cho **1 người dùng** (chủ shop). Mọi thao tác ghi/đọc đều đi qua service-role Supabase client, RLS chỉ siết các route public (ký online).

---

## Tech stack

| Layer       | Công nghệ                                        |
| ----------- | ------------------------------------------------ |
| Framework   | Next.js 14 (App Router) + TypeScript             |
| Styling     | Tailwind CSS + shadcn/ui (chỉ component cần)    |
| Database    | Supabase Postgres                                |
| Auth        | Supabase Auth (email + password) — `@supabase/ssr` |
| PDF         | `@react-pdf/renderer` (server-side)              |
| Form        | `react-hook-form` + `zod`                        |
| Date        | `date-fns`                                       |
| Không dùng  | Redux / Zustand / Prisma / NextAuth              |

---

## Folder structure

```
shop-manager/
├── app/
│   ├── (auth)/login/           # trang đăng nhập (public)
│   ├── (dashboard)/            # layout + sidebar/header yêu cầu đăng nhập
│   │   ├── page.tsx             # dashboard home
│   │   ├── inventory/           # kho
│   │   ├── customers/           # khách hàng
│   │   ├── suppliers/           # đối tác
│   │   ├── quotations/          # báo giá
│   │   ├── maintenance/         # bảo trì
│   │   └── reports/             # báo cáo
│   ├── sign/[token]/            # trang ký online (public)
│   ├── api/sign/[token]/        # POST lưu chữ ký
│   ├── globals.css
│   └── layout.tsx
├── components/
│   ├── ui/                      # shadcn (button, card, input, …)
│   ├── layout/                  # sidebar + header
│   └── signature-pad.tsx
├── lib/
│   ├── supabase/
│   │   ├── client.ts            # browser client
│   │   ├── server.ts            # RSC / route handler client
│   │   ├── admin.ts             # service-role client (server-only)
│   │   └── bootstrap.ts         # tạo admin user lần đầu
│   └── utils.ts
├── types/db.ts
├── supabase/
│   ├── migrations/0001_init.sql # schema 16 bảng
│   └── seed.sql                 # dữ liệu mẫu
├── middleware.ts                # bảo vệ route + refresh session
├── scripts/bootstrap-admin.ts   # chạy tay 1 lần: npm run bootstrap-admin
├── .env.example
└── README.md
```

---

## Hướng dẫn cài đặt (A → Z)

### 1. Tạo project Supabase

- Vào [supabase.com](https://supabase.com) → **New Project** → chọn region gần → đặt mật khẩu DB.
- Chờ project khởi tạo xong (~1 phút).

### 2. Lấy keys

Vào **Project Settings → API**, copy:

- `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
- `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role` key (chỉ hiện khi bấm "Reveal") → `SUPABASE_SERVICE_ROLE_KEY`

### 3. Tạo file `.env.local`

```bash
cp .env.example .env.local
```

Điền các giá trị:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
INITIAL_ADMIN_PASSWORD=mat-khau-manh-ban-muon
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 4. Chạy migrations

Vào **Supabase Dashboard → SQL Editor → New query**, copy nội dung `supabase/migrations/0001_init.sql` rồi **Run**.

Sau đó chạy tiếp `supabase/seed.sql` (tuỳ chọn — tạo vài record demo).

### 5. Cài dependency & chạy dev

```bash
npm install
npm run dev
```

Mở [http://localhost:3000](http://localhost:3000) → sẽ redirect sang `/login`.

### 6. Đăng nhập

- Email: `admin@shop.local`
- Mật khẩu: giá trị `INITIAL_ADMIN_PASSWORD` bạn đặt ở bước 3.

> Tạo user admin bằng lệnh chạy tay một lần: `npm run bootstrap-admin` (cần `SUPABASE_SERVICE_ROLE_KEY`, `INITIAL_ADMIN_PASSWORD` ≥12 ký tự, không phải mật khẩu mẫu; email tuỳ chọn qua `INITIAL_ADMIN_EMAIL`). Idempotent. (Không còn chạy mỗi lần server khởi động.)

---

## Schema — 16 bảng

| #  | Bảng                    | Mục đích                                  |
| -- | ----------------------- | ----------------------------------------- |
| 1  | `categories`            | Danh mục sản phẩm                         |
| 2  | `products`              | Sản phẩm + tồn kho                        |
| 3  | `customers`             | Khách lẻ / doanh nghiệp                   |
| 4  | `suppliers`             | Nhà cung cấp                              |
| 5  | `supplier_debts`        | Công nợ phải trả NCC                      |
| 6  | `customer_debts`        | Công nợ phải thu khách                    |
| 7  | `quotations`            | Báo giá (PDF)                             |
| 8  | `quotation_items`       | Dòng chi tiết báo giá                     |
| 9  | `stock_movements`       | Lịch sử nhập / xuất / điều chỉnh kho      |
| 10 | `maintenance_contracts` | Hợp đồng bảo trì                         |
| 11 | `maintenance_tickets`   | Phiếu bảo trì (ticket)                    |
| 12 | `maintenance_logs`      | Nhật ký công việc (định kỳ / sự cố / note)|
| 13 | `signatures`            | Chữ ký base64 PNG                          |
| 14 | `signature_tokens`      | Link ký online 1 lần                       |
| 15 | `bot_users`             | Mapping Telegram chat_id ↔ user            |
| 16 | `notifications`         | Hàng đợi thông báo (JSONB)                 |

Toàn bộ schema trong `supabase/migrations/0001_init.sql` (đầy đủ ENUM, FK, index, trigger `updated_at`, RLS policies cho public route `/sign/[token]`).

---

## Scripts

| Lệnh            | Mô tả                          |
| --------------- | ------------------------------ |
| `npm run dev`   | Dev server                     |
| `npm run build` | Build production               |
| `npm run start` | Chạy bản build                 |
| `npm run lint`  | ESLint                         |
| `npm run typecheck` | `tsc --noEmit`             |
| `npm test`      | Vitest (unit/smoke tests)      |

Bot (`cd bot`): `npm run typecheck`, `npm test`, `npm run build`.
Tests/CI chạy trên **Node 22** (vitest 5 yêu cầu Node ≥ 22.12; chỉ ảnh hưởng dev/CI, không ảnh hưởng runtime Vercel).

### CI & baseline (cụm C0, 2026-10-02)

GitHub Actions (`.github/workflows/ci.yml`) chạy cho mọi PR: web = `npm ci → typecheck → lint → test → build` (env Supabase giả), bot = `npm ci → typecheck → test → build`. Baseline "không được tệ hơn":

| Mục | Kết quả |
| --- | --- |
| `tsc --noEmit` (web, bot) | 0 lỗi |
| `next lint` | 0 lỗi, 13 warning (12 `no-explicit-any`, 1 `no-img-element`) |
| `npm test` | web 34 test, bot 30 test — pass |
| `next build` | OK (16 route) |
| `npm audit --omit=dev` | web: 1 critical (`next@14.2.35` — **không có bản 14.x đã vá**, cần `next >= 15.5.24`, làm ở PR riêng); bot: 0 |

---

## Tính năng

- **Kho hàng** — CRUD sản phẩm theo 6 nhóm (PC, Laptop, Camera, Máy in, Mực in, Thiết bị mạng), nhập kho nhanh, cảnh báo tồn thấp, lịch sử biến động.
- **Khách hàng** — CRM gọn: lẻ vs doanh nghiệp, tìm theo tên/SĐT/MST, ghi chú + tag.
- **Đối tác (NCC)** — Danh sách nhà cung cấp + quản lý công nợ phải trả.
- **Báo giá** — Tạo BG chọn SP từ kho, chiết khấu từng dòng + tổng, VAT 10%, **xuất PDF** qua `react-pdf`, gửi khách qua Telegram/email.
- **Bảo trì** — Hợp đồng bảo trì DN, ticket workflow (tiếp nhận → phân công → xử lý → chờ ký → ký → đóng), **ký online** trên web (canvas signature pad), báo cáo tháng.
- **Dashboard** — Tổng quan: tổng SP, sắp hết hàng, khách DN, ticket mở, BG chờ duyệt, doanh thu tháng, activity gần nhất.
- **Báo cáo** — Doanh thu 12 tháng (bar chart), top 10 SP, top 10 khách, công nợ phải thu.
- **Telegram Bot** — 8 lệnh chủ shop (`/ton`, `/nhap`, `/ban`, `/khach`, `/baotri`, `/doanhthu`, `/top`, `/start`) + 3 lệnh khách DN (`/hopdong`, `/yeucaubt`, `/ticket`).

---

## Cài đặt

### Yêu cầu
- Node.js 20+
- Tài khoản [Supabase](https://supabase.com) (free tier đủ)
- Tài khoản [Telegram](https://telegram.org) + tạo bot qua [@BotFather](https://t.me/BotFather) (cho phần bot)

### Bước 1 — Supabase
1. Tạo project mới trên Supabase.
2. Vào **SQL Editor** → paste nội dung `supabase/migrations/0001_init.sql` → Run.
3. (Tùy chọn) Paste `supabase/seed.sql` → Run để có data mẫu.
4. Vào **Settings → API** → copy `URL`, `anon key`, `service_role key`.

### Bước 2 — Web app
```bash
cd shop-manager
npm install
cp .env.example .env.local
```

Sửa `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJh...
SUPABASE_SERVICE_ROLE_KEY=eyJh...
INITIAL_ADMIN_PASSWORD=mat_khau_cua_ban
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Tùy chọn (hiển thị trên PDF báo giá)
SHOP_NAME=Cửa hàng Máy tính ABC
SHOP_TAX_CODE=0123456789
SHOP_ADDRESS=123 Nguyễn Văn A, Q1, TP.HCM
SHOP_PHONE=0901234567
SHOP_EMAIL=shop@example.vn
```

Chạy dev:
```bash
npm run dev
```
Mở http://localhost:3000, đăng nhập với `admin@shop.local` + password ở trên.

### Bước 3 — Telegram bot (tùy chọn)
1. Nhắn `/newbot` cho [@BotFather](https://t.me/BotFather), lấy **token**.
2. Trong Supabase SQL Editor, thêm bot user:
   ```sql
   insert into bot_users (telegram_chat_id, role, name)
   values ('YOUR_CHAT_ID', 'owner', 'Anh chủ');
   ```
   Lấy chat_id bằng cách nhắn `@userinfobot` trên Telegram.
3. Setup bot:
   ```bash
   cd bot
   npm install
   cp .env.example .env
   # Sửa .env: TELEGRAM_BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APP_URL
   npm run dev
   ```
4. Mở Telegram, nhắn `/start` cho bot của bạn.

---

## Deploy

### Web app → Vercel
1. Push repo lên GitHub.
2. Import vào [Vercel](https://vercel.com).
3. Thêm env vars giống `.env.local`.
4. `vercel.json` đã có sẵn `regions: ["sin1"]` (Singapore, gần VN).

### Bot → Railway / Render / VPS
Bot cần Node.js server chạy liên tục (polling) hoặc webhook. Hai cách:

**Cách A — Polling (đơn giản nhất):**
- Tạo service mới trên [Railway](https://railway.app) hoặc [Render](https://render.com).
- Connect repo, chỉ root directory = `bot`.
- Build: `npm install && npm run build`
- Start: `npm start`
- Env: copy từ `bot/.env.example`.

**Cách B — Webhook (production):**
- Đổi `BOT_MODE=webhook`, set `WEBHOOK_URL=https://your-bot.up.railway.app/telegram`.
- Telegram tự gọi webhook khi có update — không tốn kết nối persistent.

---

## Kiến trúc

```
shop-manager/
├── app/                          # Next.js App Router
│   ├── (auth)/login/             # Login page
│   ├── (dashboard)/              # Tất cả trang sau login
│   │   ├── inventory/            # Kho
│   │   ├── customers/            # Khách
│   │   ├── suppliers/            # NCC
│   │   ├── quotations/           # Báo giá + PDF API
│   │   ├── maintenance/          # Bảo trì (contracts + tickets + ký)
│   │   └── reports/              # Dashboard + Báo cáo
│   ├── sign/[token]/             # Trang ký online (public)
│   └── api/sign/[token]/         # API lưu chữ ký (public)
├── components/                   # UI components (shadcn + custom)
├── lib/                          # Supabase clients + utils
├── supabase/
│   ├── migrations/0001_init.sql  # Schema 16 bảng + RLS
│   └── seed.sql                  # Data mẫu
├── bot/                          # Telegram bot (Node.js + grammY)
│   ├── src/
│   │   ├── commands/             # /ton, /nhap, /ban, ...
│   │   ├── lib/                  # supabase, auth, notify
│   │   └── index.ts              # Entry
│   └── package.json
├── vercel.json                   # Deploy config
└── package.json
```

---

## Quyết định thiết kế

1. **Không dùng Redux/Zustand.** Toàn bộ state là server state (RSC + Supabase). Client state chỉ là form state (`react-hook-form`).
2. **Service-role cho mọi ghi/đọc từ dashboard.** Vì là 1 người dùng, không cần RLS phức tạp. RLS chỉ bật cho:
   - `signature_tokens` (anon đọc để resolve token).
   - `signatures` (anon insert khi khách ký).
3. **Public route `/sign/[token]`.** Middleware Next.js cho phép đi qua không cần đăng nhập; API `/api/sign/[token]` cũng vậy.
4. **shadcn/ui cài thủ công.** Chỉ 8 component (button, card, input, label, separator, badge, table, dropdown-menu, avatar, skeleton) — không dùng `shadcn-ui` CLI để giữ repo gọn.
5. **Bootstrap admin chạy tay.** `npm run bootstrap-admin` (idempotent), không chạy ở cold start.
6. **Signature pad không dùng lib ngoài.** HTML `<canvas>` + Pointer Events — đủ dùng cho ký chữ, gọn, không cần thêm dependency.

---

## Roadmap (sau khi foundation xong)

- CRUD cho 7 module (Kho / Khách / NCC / Báo giá / Bảo trì / Báo cáo)
- Xuất PDF báo giá & biên bản bảo trì (`@react-pdf/renderer`)
- Telegram bot webhook → đẩy `notifications` + cập nhật `bot_users`
- Cron jobs: cảnh báo tồn thấp, nhắc công nợ
