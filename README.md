# Shop Manager

Hệ thống quản lý **cửa hàng máy tính** — Next.js 15 (App Router, React 19) + Supabase + Tailwind + shadcn/ui.

> Thiết kế cho cửa hàng nhỏ: **chỉ tài khoản có trong danh sách `app_users` (owner/staff) mới truy cập được**. Mọi server action đều gọi `requireUser()` và đi qua client của người dùng (RLS); service-role chỉ dùng ở server cho việc thật sự cần (ký online, bootstrap) và ở bot. Sổ kế toán kép (append-only) là nguồn số liệu cho báo cáo.

---

## Tech stack

| Layer       | Công nghệ                                        |
| ----------- | ------------------------------------------------ |
| Framework   | Next.js 15 (App Router) + React 19 + TypeScript  |
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

Chạy **theo thứ tự tên file** các migration trong `supabase/migrations/` (SQL Editor, hoặc `supabase db push` trên project **staging** trước): `0001_init` → `0002_quotation_pdf_url` → `0003_c2_hardening` → `0004_accounting_ledger` → `0005_inventory_costing` → `0006_sales_purchases_ar_ap` → `0007_c4_stock_count` → `0008_c5_fifo_allocation` → `0009_c6_quotations` → `0010_c8_reports` → `0011_security_hardening` → `0012_hkd_profile_tax` → `0013_hkd_sales` → `0014_hkd_vat_removal`. Đọc `supabase/README-migrations.md` trước khi chạy trên dữ liệu thật (0003 siết RLS, thu hồi quyền anon, backfill danh sách nhân viên từ `auth.users`; 0004–0006 tạo sổ kế toán — **chưa kiểm thử trên Supabase thật**, chỉ trên Postgres cục bộ).

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

### Kiểm thử & CI (cập nhật sau cụm C10, 2026-10-03)

| Lệnh | Việc kiểm tra |
| --- | --- |
| `npm run typecheck` / `npm run lint` / `npm test` / `npm run build` | web: 0 lỗi tsc, 0 cảnh báo lint, vitest, build |
| `cd bot && npm run typecheck && npm test && npm run build` | bot (grammY) |
| `npm audit --omit=dev` (web và bot) | 0 lỗ hổng |
| `bash scripts/local-db.sh up && bash tests/db/run.sh --strict` | bộ test DB trên **Postgres cục bộ** (không phải Supabase): mọi điểm yếu phải ở trạng thái NOT_REPRODUCIBLE, mọi control OK |
| `bash scripts/e2e-scenario.sh` | kịch bản cuối-đến-cuối qua RPC: nhập, bán, giá vốn, thu tiền, đối chiếu công nợ, khóa kỳ, bút toán đảo, đường đi của bot |
| `node scripts/check-env-example.mjs . .env.example` | `.env.example` khớp với biến môi trường code đọc |

CI (`.github/workflows/ci.yml`): job `web`, `bot` (chặn khi audit lỗi), job `db` (Postgres cục bộ, **chưa từng chạy trên GitHub Actions** nên đang `continue-on-error` cho tới khi xanh một lần). Tất cả dùng Supabase giả/không dùng Supabase thật.

--- | --- |
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
- **Báo giá** — Tạo/sửa BG (lưu nguyên tử bằng RPC), chiết khấu, VAT, máy trạng thái draft→sent→approved/rejected, PDF lưu bucket **private** (link ký 1 giờ), BG đã duyệt → **hóa đơn bán** (một BG một hóa đơn).
- **Kế toán** — Sổ cái kép append-only (sửa = bút toán đảo), khóa/mở kỳ (chỉ owner), giá vốn bình quân, hóa đơn bán/mua, thu/chi tiền phân bổ FIFO, công nợ phải thu/trả, tuổi nợ, báo cáo VAT, bảng cân đối phát sinh, đối chiếu sổ phụ ↔ sổ cái.
- **Bảo trì** — Hợp đồng bảo trì DN, ticket workflow (tiếp nhận → phân công → xử lý → chờ ký → ký → đóng), **ký online** trên web (canvas signature pad), báo cáo tháng.
- **Dashboard** — Tổng quan: tổng SP, sắp hết hàng, khách DN, ticket mở, BG chờ duyệt, doanh thu tháng, activity gần nhất.
- **Hộ kinh doanh (A1)** — `/settings`: hồ sơ HKD (tên, chủ hộ, MST/CCCD, địa chỉ, ngành nghề, nhóm ngành thuế, phương pháp thuế, ngày bắt đầu), địa điểm kinh doanh; chỉ **owner** sửa, CCCD chỉ owner xem. Theo dõi **doanh thu năm so với ngưỡng 1 tỷ** (cảnh báo 80 %/100 % bằng banner + `/reports/revenue`). Ngưỡng/tỷ lệ là dữ liệu có ngày hiệu lực, không hard-code. Xem `docs/hkd-compliance.md`.
- **Bán hàng HKD (A2)** — `/sales`: đơn bán nguyên tử (`post_sale_hkd`) với **Khách lẻ**, nhiều phương thức thanh toán (tiền mặt/chuyển khoản), nhóm ngành thuế theo dòng, giá đã gồm thuế (không tách VAT, không TK 3331); **hàng bán trả lại/giảm giá** (TK 521, nhập lại kho theo giá vốn gốc); lưu **số hóa đơn điện tử/mã tra cứu** do phần mềm HĐĐT bên ngoài cấp (không tích hợp API); doanh thu thuần theo nhóm ngành ở `/reports/revenue`.
- **Mua hàng & gỡ VAT (A3)** — `/purchases`: phiếu mua có chứng từ (`post_purchase_bill`: kho + công nợ NCC + sổ cái trong một giao dịch), hủy phiếu hoàn kho đúng giá trị. Chế độ kế toán mặc định `hkd`: **không dùng TK 3331/133**, báo giá/đơn bán không tách VAT, VAT trên hóa đơn mua cộng vào giá vốn, không nhập kho tay (kho chỉ nhận hàng qua phiếu mua; kiểm kê thừa/thiếu vẫn ghi 711/811). Báo cáo “Thuế GTGT” chỉ còn ở chế độ legacy `enterprise` (owner đổi bằng RPC `set_accounting_mode`). Chi tiết và quyết định cần xác nhận: `docs/hkd-compliance.md`.
- **Báo cáo** — Doanh thu + lãi gộp 12 tháng (từ sổ cái, giờ Việt Nam), top 10 SP/khách (gộp trong SQL), báo cáo kế toán (`/reports/accounting`), báo cáo bảo trì tháng (`/maintenance/reports`).
- **Telegram Bot** — 8 lệnh chủ shop (`/ton`, `/nhap`, `/ban`, `/khach`, `/baotri`, `/doanhthu`, `/top`, `/start`) + 3 lệnh khách DN (`/hopdong`, `/yeucaubt`, `/ticket`). `/nhap <NCC> <SKU> <SL> <giá nhập> [số chứng từ]` lập **phiếu mua có chứng từ** (một lệnh gọi RPC nguyên tử `post_purchase_bill`: kho + công nợ NCC + sổ cái; không còn nhập kho tay, VAT trên hóa đơn mua nằm trong giá vốn), `/doanhthu` và `/top` đọc từ sổ cái. `/ban [khách] <SKU> <SL> [<SKU> <SL> …] [tm|ck]` (hộ kinh doanh, **giá đã gồm thuế, không tách VAT**): MỘT lệnh gọi RPC nguyên tử `post_sale_hkd` (kho + thu tiền + sổ cái cùng một giao dịch), thu đủ ngay bằng tiền mặt (TK 111, mặc định) hoặc chuyển khoản (`ck`, TK 112); bỏ tên khách = **Khách lẻ**; nhiều dòng hàng được. Tên khách trùng nhiều người → bot hỏi lại, chưa ghi gì. Ví dụ: `/ban HP-1234 2`, `/ban "Nguyen Van A" HP-1234 2 KB-1 1 ck`. Số hóa đơn điện tử nhập sau trên web (`/sales/<id>`).

---

## Cài đặt

### Yêu cầu
- Node.js 20+
- Tài khoản [Supabase](https://supabase.com) (free tier đủ)
- Tài khoản [Telegram](https://telegram.org) + tạo bot qua [@BotFather](https://t.me/BotFather) (cho phần bot)

### Bước 1 — Supabase
1. Tạo project mới trên Supabase.
2. Chạy lần lượt các file trong `supabase/migrations/` theo thứ tự tên (xem mục *Chạy migrations* ở trên).
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

# Tùy chọn — chỉ là dự phòng khi chưa nhập Hồ sơ hộ kinh doanh ở Cài đặt (hiển thị trên PDF báo giá)
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
   npm run dev   # polling (local)
   ```
4. Mở Telegram, nhắn `/start` cho bot của bạn.

---

## Deploy

### Web app → Vercel
1. Push repo lên GitHub, import vào [Vercel](https://vercel.com).
2. Thêm env vars giống `.env.example` (đặt `NEXT_PUBLIC_APP_URL` = URL production; `vercel.json` không còn tham chiếu secret `@app_url`).
3. `vercel.json` có `regions: ["sin1"]` (Singapore, gần VN).
4. **Thứ tự triển khai:** migration (staging → production) **cùng lúc** với bản bot mới; bot cũ ghi thẳng `products.stock_qty` sẽ bị migration 0003 từ chối.

### Bot → Docker (Railway / Render / Fly / VPS)
`bot/Dockerfile` (Node 22 alpine, chạy bằng user `node`, healthcheck `GET /healthz` ở chế độ webhook). `bot/railway.json` và `render.yaml` (blueprint) đã có sẵn; **chưa build thử bằng Docker/Railway/Render trong môi trường này**.

**Polling (đơn giản):** `BOT_MODE=polling` (mặc định); cần 1 process chạy liên tục.

**Webhook (production):**
- `BOT_MODE=webhook`, `WEBHOOK_URL=https://<bot-host>` (không kèm path), `WEBHOOK_SECRET` ≥16 ký tự (`openssl rand -hex 24`).
- Bot tự gọi `setWebhook(WEBHOOK_URL + WEBHOOK_PATH, secret_token=WEBHOOK_SECRET)` khi khởi động; request không có header `X-Telegram-Bot-Api-Secret-Token` đúng bị trả 401, body > 1 MiB bị 413. Thiếu `WEBHOOK_SECRET` bot từ chối khởi động.

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
│   ├── migrations/               # 0001…0012 (xem supabase/README-migrations.md)
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

1. **Không dùng Redux/Zustand.** State là server state (RSC + Supabase); client state chỉ là form.
2. **Truy cập theo danh sách `app_users` + RLS.** Anon không đọc/ghi gì ngoài `sign_ticket()`; tài khoản Supabase Auth không nằm trong danh sách không vào được dù đăng ký được. **Tắt đăng ký công khai** trong Supabase Auth.
3. **Số tiền/tồn kho chỉ đổi qua RPC** (`stock_adjust`, `stock_count`, `post_*`): sổ kho và sổ cái append-only, sửa sai bằng bút toán đảo, kỳ đã khóa không ghi được.
4. **Public route `/sign/[token]`**: token dùng 1 lần, hết hạn, giới hạn tốc độ theo IP/token; chữ ký ghi qua `sign_ticket()`.
5. **Giờ Việt Nam** (`Asia/Ho_Chi_Minh`) cho mọi mã chứng từ, ngày hiển thị và biên tháng báo cáo.
6. **shadcn/ui cài thủ công**, **bootstrap admin chạy tay** (`npm run bootstrap-admin`), **signature pad** bằng canvas thuần.

---

## Chưa làm / chưa kiểm chứng

- Chưa chạy trên Supabase thật: Auth/GoTrue, RLS qua PostgREST, Storage (quyền bucket), Realtime. Bộ test DB dùng Postgres thuần + lớp tương thích (`SET ROLE` + `request.jwt.claims`).
- Chưa kiểm thử với Telegram thật và chưa deploy Vercel/Railway/Render.
- `post_stock_adjustments` phải được chạy (nút ở `/reports/accounting`) để phiếu kho không chứng từ (nhập tay, kiểm kê, bot) vào sổ cái.
- Cron nhắc công nợ / cảnh báo tồn thấp, gửi báo giá qua email/Telegram: chưa có.
