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
    case when r = 'anon' then json_build_object('role','anon')::text
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
