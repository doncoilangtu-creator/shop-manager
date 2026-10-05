-- Per-session helpers for the DB harness (temp objects; nothing persists in shop_test).
-- Result lines are accumulated in GUC harness.out and printed by the runner.
--   kind 'weakness': verdict CONFIRMED | NOT_REPRODUCIBLE
--   kind 'control' : verdict OK | FAIL   (sanity checks proving the harness is not rigged)
--   kind 'info'    : verdict INFO
create or replace function pg_temp.rec(id text, kind text, verdict text, detail text)
returns void language plpgsql as $f$
begin
  perform set_config('harness.out',
    coalesce(nullif(current_setting('harness.out', true), ''), '') ||
    'RESULT|' || id || '|' || kind || '|' || verdict || '|' || replace(detail, E'\n', ' ') || E'\n', true);
end $f$;

-- Impersonate like PostgREST does: SET ROLE + request.jwt.claims (transaction-local).
create or replace function pg_temp.act_as(r text, sub uuid default null)
returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    case when r in ('anon','service_role') then json_build_object('role', r)::text
         else json_build_object('role', r, 'sub', coalesce(sub, gen_random_uuid()))::text end, true);
  execute 'set local role ' || quote_ident(r);
end $f$;

-- Fixtures (run as superuser, i.e. before act_as / after reset role)
create or replace function pg_temp.mk_customer() returns uuid language sql as $f$
  insert into public.customers(name, phone) values ('Test KH ' || gen_random_uuid(), '0900000000') returning id $f$;
create or replace function pg_temp.mk_ticket(cust uuid default null) returns uuid language sql as $f$
  insert into public.maintenance_tickets(code, customer_id, title)
  values ('TK-' || substr(gen_random_uuid()::text,1,8), coalesce(cust, pg_temp.mk_customer()), 'Test ticket') returning id $f$;
create or replace function pg_temp.mk_token(tid uuid, exp interval, used boolean default false) returns text language sql as $f$
  insert into public.signature_tokens(ticket_id, token, expires_at, used_at)
  values (tid, 'tok_' || gen_random_uuid(), now() + exp, case when used then now() end) returning token $f$;

-- A shop staff account: auth user (+ app_users row once migration 0003 exists).
create or replace function pg_temp.mk_staff(p_role text default 'owner') returns uuid language plpgsql as $f$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users(id, email) values (u, 'staff_' || u || '@test.local');
  if to_regclass('public.app_users') is not null then
    execute format('insert into public.app_users(user_id, role) values (%L, %L)', u, p_role);
  end if;
  return u;
end $f$;

-- Run a statement, return 'OK' or the error message (keeps the surrounding txn alive)
create or replace function pg_temp.try(stmt text) returns text language plpgsql as $f$
begin execute stmt; return 'OK'; exception when others then return sqlerrm; end $f$;
-- Walk a fresh ticket to a given status (fixture, superuser)
create or replace function pg_temp.ticket_in(st text) returns uuid language plpgsql as $f$
declare t uuid := pg_temp.mk_ticket();
begin
  if st in ('in_progress','completed','awaiting_signature') then update public.maintenance_tickets set status = 'in_progress' where id = t; end if;
  if st in ('completed','awaiting_signature') then update public.maintenance_tickets set status = 'completed' where id = t; end if;
  if st = 'awaiting_signature' then update public.maintenance_tickets set status = 'awaiting_signature' where id = t; end if;
  return t;
end $f$;

create or replace function pg_temp.mk_supplier() returns uuid language sql as $f$
  insert into public.suppliers(name) values ('NCC ' || gen_random_uuid()) returning id $f$;
create or replace function pg_temp.mk_product(p_cost numeric default 0, p_qty int default 0) returns uuid language sql as $f$
  insert into public.products(sku, name, cost_price, stock_qty) values ('P-' || substr(gen_random_uuid()::text,1,8), 'Prod', p_cost, p_qty) returning id $f$;
create or replace function pg_temp.bal(code text) returns numeric language sql as $f$ select public.account_balance(code) $f$;
create or replace function pg_temp.ok(b boolean) returns text language sql as $f$ select case when b then 'OK' else 'FAIL' end $f$;

-- Accounting mode (0014+): 'hkd' is the default; cases that exercise the legacy VAT paths (3331/133) switch to 'enterprise' inside their transaction.
create or replace function pg_temp.set_mode(m text) returns void language plpgsql security definer as $f$
begin
  if to_regclass('public.app_settings') is not null then
    insert into public.app_settings(key, value) values ('accounting_mode', m) on conflict (key) do update set value = excluded.value;
  end if;
end $f$;
