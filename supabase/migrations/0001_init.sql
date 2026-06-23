-- ============================================================================
-- Shop Manager — Initial Schema (16 tables, 9 ENUMs)
-- Run in Supabase SQL editor (or via supabase-cli db push).
-- Idempotent: safe to re-run.
-- ============================================================================

-- Extensions
create extension if not exists "pgcrypto";

-- ============================================================================
-- 1. categories
-- ============================================================================
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  created_at  timestamptz not null default now()
);
create unique index if not exists idx_categories_slug on public.categories(slug);

-- ============================================================================
-- 2. products
-- ============================================================================
create table if not exists public.products (
  id               uuid primary key default gen_random_uuid(),
  sku              text not null unique,
  name             text not null,
  category_id      uuid references public.categories(id) on delete set null,
  brand            text,
  model            text,
  description      text,
  unit             text not null default 'cái',
  cost_price       numeric(14,2) not null default 0,
  sell_price       numeric(14,2) not null default 0,
  stock_qty        integer not null default 0,
  min_stock        integer not null default 0,
  location         text,
  warranty_months  integer not null default 0,
  image_urls       text[] not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists idx_products_sku on public.products(sku);
create index if not exists idx_products_category_id on public.products(category_id);
create index if not exists idx_products_name_search on public.products using gin (to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(sku,'')));

-- ============================================================================
-- 3. customers
-- ============================================================================
do $$ begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname='customer_type' and n.nspname='public') then
    create type public.customer_type as enum ('retail','business');
  end if;
end $$;

create table if not exists public.customers (
  id              uuid primary key default gen_random_uuid(),
  type            public.customer_type not null default 'retail',
  name            text not null,
  phone           text,
  email           text,
  address         text,
  tax_code        text,
  contact_person  text,
  contact_phone   text,
  debt_limit      numeric(14,2) not null default 0,
  notes           text,
  tags            text[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_customers_phone on public.customers(phone);
create index if not exists idx_customers_name_search on public.customers using gin (to_tsvector('simple', coalesce(name,'')));

-- ============================================================================
-- 4. suppliers
-- ============================================================================
create table if not exists public.suppliers (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  tax_code         text,
  phone            text,
  email            text,
  address          text,
  contact_person   text,
  bank_account     text,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ============================================================================
-- 5. supplier_debts
-- ============================================================================
create table if not exists public.supplier_debts (
  id           uuid primary key default gen_random_uuid(),
  supplier_id  uuid not null references public.suppliers(id) on delete cascade,
  amount       numeric(14,2) not null default 0,
  due_date     date,
  paid         boolean not null default false,
  paid_at      timestamptz,
  notes        text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_supplier_debts_supplier_id on public.supplier_debts(supplier_id);

-- ============================================================================
-- 6. customer_debts
-- ============================================================================
create table if not exists public.customer_debts (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.customers(id) on delete cascade,
  amount       numeric(14,2) not null default 0,
  due_date     date,
  paid         boolean not null default false,
  paid_at      timestamptz,
  notes        text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_customer_debts_customer_id on public.customer_debts(customer_id);

-- ============================================================================
-- 7. quotations
-- ============================================================================
do $$ begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname='quotation_status' and n.nspname='public') then
    create type public.quotation_status as enum ('draft','sent','approved','rejected');
  end if;
end $$;

create table if not exists public.quotations (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  customer_id  uuid references public.customers(id) on delete set null,
  status       public.quotation_status not null default 'draft',
  valid_until  date,
  notes        text,
  subtotal     numeric(14,2) not null default 0,
  discount     numeric(14,2) not null default 0,
  vat          numeric(14,2) not null default 0,
  total        numeric(14,2) not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists idx_quotations_code on public.quotations(code);
create index if not exists idx_quotations_customer_id on public.quotations(customer_id);
create index if not exists idx_quotations_status on public.quotations(status);

-- ============================================================================
-- 8. quotation_items
-- ============================================================================
create table if not exists public.quotation_items (
  id            uuid primary key default gen_random_uuid(),
  quotation_id  uuid not null references public.quotations(id) on delete cascade,
  product_id    uuid references public.products(id) on delete set null,
  qty           numeric(12,2) not null default 1,
  unit_price    numeric(14,2) not null default 0,
  discount      numeric(14,2) not null default 0,
  line_total    numeric(14,2) not null default 0,
  notes         text
);
create index if not exists idx_quotation_items_quotation_id on public.quotation_items(quotation_id);
create index if not exists idx_quotation_items_product_id on public.quotation_items(product_id);

-- ============================================================================
-- 9. stock_movements
-- ============================================================================
do $$ begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname='stock_movement_type' and n.nspname='public') then
    create type public.stock_movement_type as enum ('in','out','adjust');
  end if;
end $$;

create table if not exists public.stock_movements (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id) on delete cascade,
  type        public.stock_movement_type not null,
  qty         numeric(12,2) not null,
  unit_cost   numeric(14,2),
  ref_type    text,
  ref_id      uuid,
  notes       text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_stock_movements_product_id on public.stock_movements(product_id);
create index if not exists idx_stock_movements_created_at on public.stock_movements(created_at desc);

-- ============================================================================
-- 10. maintenance_contracts
-- ============================================================================
do $$ begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname='contract_status' and n.nspname='public') then
    create type public.contract_status as enum ('active','expired','cancelled');
  end if;
end $$;

create table if not exists public.maintenance_contracts (
  id                   uuid primary key default gen_random_uuid(),
  customer_id          uuid not null references public.customers(id) on delete cascade,
  code                 text not null unique,
  start_date           date not null,
  end_date             date not null,
  scope                text,
  devices_description  text,
  monthly_fee          numeric(14,2) not null default 0,
  sla_hours            integer not null default 24,
  signed_pdf_url       text,
  status               public.contract_status not null default 'active',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index if not exists idx_contracts_code on public.maintenance_contracts(code);
create index if not exists idx_contracts_customer_id on public.maintenance_contracts(customer_id);

-- ============================================================================
-- 11. maintenance_tickets
-- ============================================================================
do $$ begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname='ticket_priority' and n.nspname='public') then
    create type public.ticket_priority as enum ('low','medium','high');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname='ticket_status' and n.nspname='public') then
    create type public.ticket_status as enum (
      'received','assigned','in_progress','waiting_parts',
      'completed','awaiting_signature','signed','closed'
    );
  end if;
end $$;

create table if not exists public.maintenance_tickets (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  contract_id     uuid references public.maintenance_contracts(id) on delete set null,
  customer_id     uuid not null references public.customers(id) on delete cascade,
  title           text not null,
  description     text,
  priority        public.ticket_priority not null default 'medium',
  status          public.ticket_status not null default 'received',
  assigned_to     uuid references auth.users(id) on delete set null,
  device_info     text,
  started_at      timestamptz,
  completed_at    timestamptz,
  sla_due_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists idx_tickets_code on public.maintenance_tickets(code);
create index if not exists idx_tickets_contract_id on public.maintenance_tickets(contract_id);
create index if not exists idx_tickets_customer_id on public.maintenance_tickets(customer_id);
create index if not exists idx_tickets_status on public.maintenance_tickets(status);
create index if not exists idx_tickets_created_at on public.maintenance_tickets(created_at desc);

-- ============================================================================
-- 12. maintenance_logs
-- ============================================================================
do $$ begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname='maintenance_log_type' and n.nspname='public') then
    create type public.maintenance_log_type as enum ('periodic','incident','note');
  end if;
end $$;

create table if not exists public.maintenance_logs (
  id            uuid primary key default gen_random_uuid(),
  ticket_id     uuid not null references public.maintenance_tickets(id) on delete cascade,
  log_type      public.maintenance_log_type not null,
  description   text,
  work_done     text,
  parts_used    text[] not null default '{}',
  performed_by  uuid references auth.users(id) on delete set null,
  performed_at  timestamptz not null default now()
);
create index if not exists idx_logs_ticket_id on public.maintenance_logs(ticket_id);

-- ============================================================================
-- 13. signatures
-- ============================================================================
do $$ begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname='signer_role' and n.nspname='public') then
    create type public.signer_role as enum ('customer','technician');
  end if;
end $$;

create table if not exists public.signatures (
  id             uuid primary key default gen_random_uuid(),
  ticket_id      uuid not null references public.maintenance_tickets(id) on delete cascade,
  signer_name    text not null,
  signer_role    public.signer_role not null,
  signature_png  text not null,
  ip_address     text,
  user_agent     text,
  signed_at      timestamptz not null default now()
);
create index if not exists idx_signatures_ticket_id on public.signatures(ticket_id);

-- ============================================================================
-- 14. signature_tokens
-- ============================================================================
create table if not exists public.signature_tokens (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.maintenance_tickets(id) on delete cascade,
  token       text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create unique index if not exists idx_sig_tokens_token on public.signature_tokens(token);
create index if not exists idx_sig_tokens_ticket_id on public.signature_tokens(ticket_id);

-- ============================================================================
-- 15. bot_users  (Telegram bot linkage)
-- ============================================================================
do $$ begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname='bot_role' and n.nspname='public') then
    create type public.bot_role as enum ('owner','customer');
  end if;
end $$;

create table if not exists public.bot_users (
  id                 uuid primary key default gen_random_uuid(),
  telegram_chat_id   text not null unique,
  role               public.bot_role not null default 'customer',
  customer_id        uuid references public.customers(id) on delete set null,
  name               text,
  active             boolean not null default true,
  created_at         timestamptz not null default now()
);
create unique index if not exists idx_bot_users_telegram_chat_id on public.bot_users(telegram_chat_id);
create index if not exists idx_bot_users_customer_id on public.bot_users(customer_id);
create index if not exists idx_bot_users_role on public.bot_users(role);
create index if not exists idx_bot_users_created_at on public.bot_users(created_at desc);

-- ============================================================================
-- 16. notifications
-- ============================================================================
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  type        text not null,
  payload     jsonb not null default '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists idx_notifications_unread on public.notifications(read_at) where read_at is null;
create index if not exists idx_notifications_created_at on public.notifications(created_at desc);

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.categories            enable row level security;
alter table public.products              enable row level security;
alter table public.customers             enable row level security;
alter table public.suppliers             enable row level security;
alter table public.supplier_debts        enable row level security;
alter table public.customer_debts        enable row level security;
alter table public.quotations            enable row level security;
alter table public.quotation_items       enable row level security;
alter table public.stock_movements       enable row level security;
alter table public.maintenance_contracts enable row level security;
alter table public.maintenance_tickets   enable row level security;
alter table public.maintenance_logs      enable row level security;
alter table public.signatures            enable row level security;
alter table public.signature_tokens      enable row level security;
alter table public.bot_users             enable row level security;
alter table public.notifications         enable row level security;

-- auth read for everything (single-user app)
do $$
declare t text;
begin
  for t in select unnest(array[
    'categories','products','customers','suppliers',
    'supplier_debts','customer_debts','quotations','quotation_items',
    'stock_movements','maintenance_contracts','maintenance_tickets',
    'maintenance_logs','signatures','signature_tokens','bot_users','notifications'
  ]) loop
    execute format('drop policy if exists "auth_read_%I" on public.%I', t, t);
    execute format('create policy "auth_read_%I" on public.%I for select to authenticated using (true)', t, t);
  end loop;
end$$;

-- public read for unused, unexpired signature tokens
drop policy if exists "anon_read_signature_tokens" on public.signature_tokens;
create policy "anon_read_signature_tokens"
  on public.signature_tokens for select to anon
  using (used_at is null and expires_at > now());

-- public insert for signatures (customer signs from /sign/[token])
drop policy if exists "anon_insert_signatures" on public.signatures;
create policy "anon_insert_signatures"
  on public.signatures for insert to anon
  with check (true);

-- ============================================================================
-- updated_at trigger
-- ============================================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end$$;

do $$
declare t text;
begin
  for t in select unnest(array[
    'products','customers','suppliers','quotations',
    'maintenance_contracts','maintenance_tickets'
  ]) loop
    execute format('drop trigger if exists trg_%I_updated_at on public.%I', t, t);
    execute format(
      'create trigger trg_%I_updated_at before update on public.%I
       for each row execute function public.set_updated_at()', t, t);
  end loop;
end$$;

-- ============================================================================
-- Bootstrap admin user (handled in app code via lib/supabase/bootstrap.ts)
-- ============================================================================