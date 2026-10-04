-- ============================================================================
-- 0003_c2_hardening.sql  (cluster C2: RLS, constraints, atomic RPCs)
--
-- Fixes (see refactor plan F3, F7, F12, F13, F14 and tests/db/cases/*):
--   * staff allow-list (app_users + is_staff()) replaces `using (true)` RLS, so a
--     self-registered Supabase Auth account can no longer read/write business data
--   * anon can no longer read signature_tokens nor insert signatures; signing goes
--     through RPC sign_ticket() (service_role only, atomic, single use)
--   * unique(ticket_id, signer_role), signature size CHECK, signatures immutable
--   * stock ledger: integer qty, append-only stock_movements, products.stock_qty is
--     a cache maintained ONLY by triggers; stock_adjust() RPC (row lock, no negative stock)
--   * save_quotation() RPC (header + items in one transaction, totals computed in SQL)
--   * CHECK constraints (quotations/items, contracts), ticket status transition trigger
--   * FKs that silently cascade-deleted signed records / ledger rows -> RESTRICT
--   * view low_stock_products (correct column-vs-column comparison)
--
-- Idempotent: safe to re-run on a DB that already has 0001 + 0002 (+ 0003).
-- Guards raise an exception (whole file is one transaction -> nothing applied) when
-- existing production data would violate a new rule that must not be auto-fixed:
--   - duplicate (ticket_id, signer_role) signatures
--   - fractional stock_movements.qty
--
-- ROLLBACK: this migration is not reversible by a single `down` file because it
-- converts stock_movements.qty to integer. Take a backup first (supabase db dump
-- or pg_dump) and restore it if you need to undo. See supabase/README-migrations.md.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Staff allow-list
-- ----------------------------------------------------------------------------
create table if not exists public.app_users (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  role        text not null default 'staff' check (role in ('owner','staff')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table public.app_users enable row level security;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.app_users u where u.user_id = auth.uid() and u.active)
$$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.app_users u where u.user_id = auth.uid() and u.active and u.role = 'owner')
$$;

-- true for the service-role JWT (server-side admin client / bot) or an active staff user
create or replace function public.has_app_access()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(auth.role(), '') = 'service_role' or public.is_staff()
$$;

-- Existing Auth users at migration time are the shop's own accounts (single-user app):
-- grant them access so nothing breaks. REVIEW `select * from app_users` afterwards and
-- disable public sign-ups in Supabase Auth settings.
insert into public.app_users (user_id, role)
select id, 'owner' from auth.users
on conflict (user_id) do nothing;

drop policy if exists "app_users_self_read" on public.app_users;
create policy "app_users_self_read" on public.app_users for select to authenticated
  using (user_id = auth.uid());

-- Grant staff access by e-mail (used by scripts/bootstrap-admin.ts with the service role)
create or replace function public.grant_staff(p_email text, p_role text default 'owner')
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select id into v_id from auth.users where lower(email) = lower(p_email);
  if v_id is null then raise exception 'user_not_found'; end if;
  insert into public.app_users(user_id, role, active) values (v_id, p_role, true)
  on conflict (user_id) do update set role = excluded.role, active = true;
  return v_id;
end $$;

-- ----------------------------------------------------------------------------
-- 1. RLS: staff-only instead of "any authenticated"
-- ----------------------------------------------------------------------------
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
    execute format('create policy "auth_read_%I" on public.%I for select to authenticated using (public.is_staff())', t, t);
  end loop;

  for t in select unnest(array['products','customers','suppliers','quotations','quotation_items']) loop
    execute format('drop policy if exists "auth_insert_%I" on public.%I', t, t);
    execute format('drop policy if exists "auth_update_%I" on public.%I', t, t);
    execute format('drop policy if exists "auth_delete_%I" on public.%I', t, t);
    execute format('create policy "auth_insert_%I" on public.%I for insert to authenticated with check (public.is_staff())', t, t);
    execute format('create policy "auth_update_%I" on public.%I for update to authenticated using (public.is_staff()) with check (public.is_staff())', t, t);
    execute format('create policy "auth_delete_%I" on public.%I for delete to authenticated using (public.is_staff())', t, t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Signing flow: nothing for anon any more
-- ----------------------------------------------------------------------------
drop policy if exists "anon_read_signature_tokens" on public.signature_tokens;
drop policy if exists "anon_insert_signatures" on public.signatures;
revoke all on public.signature_tokens, public.signatures from anon;
-- defense in depth: anon needs no table privilege on business tables at all
revoke all on all tables in schema public from anon;

-- one signature per (ticket, role)
do $$
begin
  if exists (select 1 from public.signatures group by ticket_id, signer_role having count(*) > 1) then
    raise exception 'duplicate (ticket_id, signer_role) rows exist in public.signatures: resolve manually (keep the earliest) before applying 0003';
  end if;
end $$;
create unique index if not exists uq_signatures_ticket_role on public.signatures(ticket_id, signer_role);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'signatures_png_size') then
    alter table public.signatures add constraint signatures_png_size
      check (length(signature_png) <= 300000) not valid;   -- ~220 KB binary as base64
  end if;
end $$;

-- evidence is immutable
create or replace function public.trg_signatures_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'signatures are immutable (append-only evidence)' using errcode = '42501';
end $$;
drop trigger if exists trg_signatures_no_update on public.signatures;
create trigger trg_signatures_no_update before update on public.signatures
  for each row execute function public.trg_signatures_immutable();
drop trigger if exists trg_signatures_no_delete on public.signatures;
create trigger trg_signatures_no_delete before delete on public.signatures
  for each row execute function public.trg_signatures_immutable();

-- deleting a customer/ticket must not silently destroy signed maintenance records
alter table public.maintenance_tickets drop constraint if exists maintenance_tickets_customer_id_fkey;
alter table public.maintenance_tickets add constraint maintenance_tickets_customer_id_fkey
  foreign key (customer_id) references public.customers(id) on delete restrict;
alter table public.maintenance_contracts drop constraint if exists maintenance_contracts_customer_id_fkey;
alter table public.maintenance_contracts add constraint maintenance_contracts_customer_id_fkey
  foreign key (customer_id) references public.customers(id) on delete restrict;
alter table public.customer_debts drop constraint if exists customer_debts_customer_id_fkey;
alter table public.customer_debts add constraint customer_debts_customer_id_fkey
  foreign key (customer_id) references public.customers(id) on delete restrict;
alter table public.signatures drop constraint if exists signatures_ticket_id_fkey;
alter table public.signatures add constraint signatures_ticket_id_fkey
  foreign key (ticket_id) references public.maintenance_tickets(id) on delete restrict;

-- ticket status machine (same table as lib/maintenance.ts TICKET_TRANSITIONS)
create or replace function public.ticket_transition_allowed(p_from public.ticket_status, p_to public.ticket_status)
returns boolean language sql immutable as $$
  select p_from = p_to or (p_from, p_to) in (
    ('received','assigned'), ('received','in_progress'), ('received','closed'),
    ('assigned','in_progress'), ('assigned','waiting_parts'), ('assigned','received'),
    ('in_progress','waiting_parts'), ('in_progress','completed'), ('in_progress','assigned'),
    ('waiting_parts','in_progress'), ('waiting_parts','completed'),
    ('completed','awaiting_signature'), ('completed','in_progress'),
    ('awaiting_signature','signed'), ('awaiting_signature','in_progress'),
    ('signed','closed')
  )
$$;

create or replace function public.trg_ticket_status_guard()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status and not public.ticket_transition_allowed(old.status, new.status) then
    raise exception 'invalid ticket status transition % -> %', old.status, new.status using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists trg_tickets_status_guard on public.maintenance_tickets;
create trigger trg_tickets_status_guard before update of status on public.maintenance_tickets
  for each row execute function public.trg_ticket_status_guard();

-- contracts sanity (NOT VALID: enforced for new/updated rows, legacy rows untouched)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'contracts_dates_ok') then
    alter table public.maintenance_contracts add constraint contracts_dates_ok check (end_date >= start_date) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contracts_amounts_ok') then
    alter table public.maintenance_contracts add constraint contracts_amounts_ok check (monthly_fee >= 0 and sla_hours > 0) not valid;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 3. sign_ticket(): atomic, single-use token, server-side only
-- ----------------------------------------------------------------------------
create or replace function public.sign_ticket(
  p_token text, p_ticket_id uuid, p_signer_name text, p_role public.signer_role,
  p_png text, p_ip text default null, p_ua text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tok public.signature_tokens%rowtype;
  v_tid uuid;
  v_status public.ticket_status;
  v_roles text[];
  v_both boolean;
  v_new public.ticket_status;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_png is null or length(p_png) < 20 then raise exception 'signature_invalid'; end if;
  if length(p_png) > 300000 then raise exception 'signature_too_large'; end if;
  if p_signer_name is null or length(btrim(p_signer_name)) = 0 or length(p_signer_name) > 200 then
    raise exception 'signer_name_invalid';
  end if;

  -- Lock order is always ticket -> token (two sessions with different tokens of the same
  -- ticket used to deadlock when the token row was locked first).
  select ticket_id into v_tid from public.signature_tokens where token = p_token;
  if not found then raise exception 'token_not_found'; end if;
  if v_tid <> p_ticket_id then raise exception 'token_ticket_mismatch'; end if;

  select status into v_status from public.maintenance_tickets where id = p_ticket_id for update;
  if not found then raise exception 'ticket_not_found'; end if;

  select * into v_tok from public.signature_tokens where token = p_token for update;
  if v_tok.used_at is not null then raise exception 'token_used'; end if;
  if v_tok.expires_at <= now() then raise exception 'token_expired'; end if;
  if v_status not in ('completed','awaiting_signature') then raise exception 'ticket_not_signable'; end if;

  begin
    insert into public.signatures(ticket_id, signer_name, signer_role, signature_png, ip_address, user_agent)
    values (p_ticket_id, btrim(p_signer_name), p_role, p_png, left(p_ip, 100), left(p_ua, 500));
  exception when unique_violation then
    raise exception 'already_signed';
  end;

  update public.signature_tokens set used_at = now() where id = v_tok.id;
  update public.signature_tokens set used_at = now()
   where ticket_id = p_ticket_id and used_at is null and id <> v_tok.id;

  select array_agg(signer_role::text) into v_roles from public.signatures where ticket_id = p_ticket_id;
  v_both := v_roles @> array['customer','technician'];
  v_new := case when v_both then 'signed' else 'awaiting_signature' end;
  if v_status = 'completed' and v_new = 'signed' then v_new := 'awaiting_signature'; end if;  -- never skip a step
  if v_new is distinct from v_status then
    update public.maintenance_tickets set status = v_new where id = p_ticket_id;
  end if;
  return jsonb_build_object('ok', true, 'status', v_new, 'both_signed', v_both);
end $$;
revoke all on function public.sign_ticket(text, uuid, text, public.signer_role, text, text, text) from public, anon, authenticated;
grant execute on function public.sign_ticket(text, uuid, text, public.signer_role, text, text, text) to service_role;

-- ----------------------------------------------------------------------------
-- 4. Stock ledger
-- ----------------------------------------------------------------------------
-- 4a. integer quantities everywhere (guard against silent rounding of legacy data)
do $$
begin
  if exists (select 1 from public.stock_movements where qty <> round(qty)) then
    raise exception 'fractional stock_movements.qty exist: fix them manually before applying 0003';
  end if;
  if (select data_type from information_schema.columns
       where table_schema='public' and table_name='stock_movements' and column_name='qty') <> 'integer' then
    alter table public.stock_movements alter column qty type integer using round(qty)::integer;
  end if;
end $$;

alter table public.stock_movements add column if not exists qty_delta integer
  generated always as (case when type = 'out' then -qty else qty end) stored;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'stock_movements_qty_ok') then
    alter table public.stock_movements add constraint stock_movements_qty_ok
      check ((type in ('in','out') and qty > 0) or (type = 'adjust' and qty <> 0)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_stock_nonneg') then
    alter table public.products add constraint products_stock_nonneg check (stock_qty >= 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_min_stock_nonneg') then
    alter table public.products add constraint products_min_stock_nonneg check (min_stock >= 0) not valid;
  end if;
end $$;

-- the ledger must not vanish with the product
alter table public.stock_movements drop constraint if exists stock_movements_product_id_fkey;
alter table public.stock_movements add constraint stock_movements_product_id_fkey
  foreign key (product_id) references public.products(id) on delete restrict;

-- 4b. one-off reconciliation: make stock_qty == sum(movements) with explicit adjust rows
do $$
declare r record;
begin
  perform set_config('app.skip_stock_apply', '1', true);
  for r in
    select p.id, p.stock_qty - coalesce(sum(m.qty_delta), 0)::integer as diff
      from public.products p left join public.stock_movements m on m.product_id = p.id
     group by p.id having p.stock_qty <> coalesce(sum(m.qty_delta), 0)
  loop
    insert into public.stock_movements(product_id, type, qty, ref_type, notes)
    values (r.id, 'adjust', r.diff, 'opening', 'Đối soát tồn kho khi áp dụng migration 0003');
  end loop;
  perform set_config('app.skip_stock_apply', '0', true);
end $$;

-- 4c. triggers: ledger append-only, stock_qty maintained only by the ledger
create or replace function public.trg_stock_ledger_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'stock_movements is append-only (use a compensating "adjust" movement)' using errcode = '42501';
end $$;
drop trigger if exists trg_stock_movements_no_update on public.stock_movements;
create trigger trg_stock_movements_no_update before update on public.stock_movements
  for each row execute function public.trg_stock_ledger_append_only();
drop trigger if exists trg_stock_movements_no_delete on public.stock_movements;
create trigger trg_stock_movements_no_delete before delete on public.stock_movements
  for each row execute function public.trg_stock_ledger_append_only();

create or replace function public.trg_stock_movement_apply()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(current_setting('app.skip_stock_apply', true), '') = '1' then return new; end if;
  perform set_config('app.stock_internal', '1', true);
  update public.products set stock_qty = stock_qty + new.qty_delta where id = new.product_id;
  perform set_config('app.stock_internal', '0', true);
  return new;
end $$;
drop trigger if exists trg_stock_movement_apply on public.stock_movements;
create trigger trg_stock_movement_apply after insert on public.stock_movements
  for each row execute function public.trg_stock_movement_apply();

create or replace function public.trg_products_stock_guard()
returns trigger language plpgsql as $$
begin
  if new.stock_qty is distinct from old.stock_qty
     and coalesce(current_setting('app.stock_internal', true), '') <> '1' then
    raise exception 'products.stock_qty can only change through stock_movements (use stock_adjust())' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_products_stock_guard on public.products;
create trigger trg_products_stock_guard before update of stock_qty on public.products
  for each row execute function public.trg_products_stock_guard();

-- a product created with an initial stock gets an explicit opening movement
create or replace function public.trg_products_opening_stock()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.stock_qty <> 0 then
    perform set_config('app.stock_internal', '1', true);
    update public.products set stock_qty = 0 where id = new.id;
    perform set_config('app.stock_internal', '0', true);
    insert into public.stock_movements(product_id, type, qty, unit_cost, ref_type, notes)
    values (new.id, 'adjust', new.stock_qty, new.cost_price, 'opening', 'Tồn đầu khi tạo sản phẩm');
  end if;
  return new;
end $$;
drop trigger if exists trg_products_opening_stock on public.products;
create trigger trg_products_opening_stock after insert on public.products
  for each row execute function public.trg_products_opening_stock();

-- 4d. stock_adjust(): atomic, row-locked, never negative
create or replace function public.stock_adjust(
  p_product_id uuid, p_type public.stock_movement_type, p_qty integer,
  p_unit_cost numeric default null, p_ref_type text default null, p_ref_id uuid default null,
  p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cur integer; v_delta integer; v_id uuid;
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_qty is null or p_qty = 0 or (p_type in ('in','out') and p_qty < 0) then raise exception 'qty_invalid'; end if;
  select stock_qty into v_cur from public.products where id = p_product_id for update;
  if not found then raise exception 'product_not_found'; end if;
  v_delta := case when p_type = 'out' then -p_qty else p_qty end;
  if v_cur + v_delta < 0 then
    raise exception 'insufficient_stock' using detail = format('have %s, need %s', v_cur, -v_delta);
  end if;
  insert into public.stock_movements(product_id, type, qty, unit_cost, ref_type, ref_id, notes, created_by)
  values (p_product_id, p_type, p_qty, p_unit_cost, p_ref_type, p_ref_id, p_notes, auth.uid())
  returning id into v_id;
  return jsonb_build_object('movement_id', v_id, 'stock_qty', v_cur + v_delta);
end $$;
revoke all on function public.stock_adjust(uuid, public.stock_movement_type, integer, numeric, text, uuid, text) from public, anon;
grant execute on function public.stock_adjust(uuid, public.stock_movement_type, integer, numeric, text, uuid, text) to authenticated, service_role;

-- consistency view: must always be empty
create or replace view public.v_stock_mismatch with (security_invoker = true) as
  select p.id as product_id, p.sku, p.stock_qty, coalesce(sum(m.qty_delta), 0)::integer as ledger_qty
    from public.products p left join public.stock_movements m on m.product_id = p.id
   group by p.id, p.sku, p.stock_qty
  having p.stock_qty <> coalesce(sum(m.qty_delta), 0);

-- correct "low stock" comparison (column vs column) for PostgREST
create or replace view public.low_stock_products with (security_invoker = true) as
  select * from public.products where stock_qty <= min_stock;

-- ----------------------------------------------------------------------------
-- 5. Quotations: constraints + atomic save_quotation()
-- ----------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'quotation_items_values_ok') then
    alter table public.quotation_items add constraint quotation_items_values_ok check (
      qty > 0 and unit_price >= 0 and discount >= 0 and discount <= 100
      and abs(line_total - round(qty * unit_price * (1 - discount / 100), 2)) <= 0.01) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quotations_totals_ok') then
    alter table public.quotations add constraint quotations_totals_ok check (
      subtotal >= 0 and discount >= 0 and discount <= subtotal and vat >= 0
      and abs(total - (subtotal - discount + vat)) <= 0.01) not valid;
  end if;
end $$;

-- p_items: [{product_id, qty, unit_price, discount(%), notes}] ; totals computed here.
-- p_id null => create (p_code required); otherwise replace items of a DRAFT quotation.
create or replace function public.save_quotation(
  p_id uuid, p_code text, p_customer_id uuid, p_status public.quotation_status,
  p_valid_until date, p_notes text, p_discount numeric, p_vat_rate numeric, p_items jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_id uuid := p_id; v_cur public.quotation_status;
  v_sub numeric := 0; v_disc numeric; v_vat numeric; v_total numeric;
  it jsonb; v_qty numeric; v_price numeric; v_d numeric; v_line numeric; n int := 0;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'items_required';
  end if;
  if p_vat_rate < 0 or p_vat_rate > 100 or p_discount < 0 then raise exception 'amounts_invalid'; end if;

  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := (it->>'qty')::numeric; v_price := (it->>'unit_price')::numeric; v_d := coalesce((it->>'discount')::numeric, 0);
    if v_qty is null or v_qty <= 0 or v_price is null or v_price < 0 or v_d < 0 or v_d > 100 then
      raise exception 'item_invalid';
    end if;
    v_sub := v_sub + round(v_qty * v_price * (1 - v_d / 100), 2);
  end loop;
  v_disc := round(least(p_discount, v_sub), 2);
  v_vat := round((v_sub - v_disc) * p_vat_rate / 100, 2);
  v_total := v_sub - v_disc + v_vat;

  if v_id is null then
    if p_code is null then raise exception 'code_required'; end if;
    insert into public.quotations(code, customer_id, status, valid_until, notes, subtotal, discount, vat, total)
    values (p_code, p_customer_id, p_status, p_valid_until, p_notes, v_sub, v_disc, v_vat, v_total)
    returning id into v_id;
  else
    select status into v_cur from public.quotations where id = v_id for update;
    if not found then raise exception 'quotation_not_found'; end if;
    if v_cur <> 'draft' then raise exception 'quotation_not_draft'; end if;
    update public.quotations set customer_id = p_customer_id, valid_until = p_valid_until, notes = p_notes,
           subtotal = v_sub, discount = v_disc, vat = v_vat, total = v_total
     where id = v_id;
    delete from public.quotation_items where quotation_id = v_id;
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := (it->>'qty')::numeric; v_price := (it->>'unit_price')::numeric; v_d := coalesce((it->>'discount')::numeric, 0);
    v_line := round(v_qty * v_price * (1 - v_d / 100), 2);
    insert into public.quotation_items(quotation_id, product_id, qty, unit_price, discount, line_total, notes)
    values (v_id, nullif(it->>'product_id', '')::uuid, v_qty, v_price, v_d, v_line, nullif(it->>'notes', ''));
    n := n + 1;
  end loop;
  return jsonb_build_object('id', v_id, 'subtotal', v_sub, 'discount', v_disc, 'vat', v_vat, 'total', v_total, 'items', n);
end $$;
revoke all on function public.save_quotation(uuid, text, uuid, public.quotation_status, date, text, numeric, numeric, jsonb) from public, anon;
grant execute on function public.save_quotation(uuid, text, uuid, public.quotation_status, date, text, numeric, numeric, jsonb) to authenticated, service_role;

-- keep RPC EXECUTE away from anon for functions created by default (PUBLIC grant)
revoke execute on function public.is_staff(), public.is_owner(), public.has_app_access() from public, anon;
grant execute on function public.is_staff(), public.is_owner(), public.has_app_access() to authenticated, service_role;
revoke all on function public.grant_staff(text, text) from public, anon, authenticated;
grant execute on function public.grant_staff(text, text) to service_role;
