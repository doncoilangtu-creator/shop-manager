-- ============================================================================
-- 0004_accounting_ledger.sql — double-entry, append-only general ledger
--
-- * chart of accounts (Vietnamese TT133 subset, extendable)
-- * fiscal periods (monthly) with close / reopen (owner only, audited)
-- * journal_entries / journal_lines: append-only (UPDATE/DELETE/TRUNCATE are blocked),
--   balanced (sum debit = sum credit) enforced by a DEFERRED constraint trigger,
--   no posting into a closed period, AR (131) lines need customer_id, AP (331) lines need supplier_id
-- * corrections are made with REVERSAL entries (reverse_journal), never by editing
-- * all writes go through SECURITY DEFINER RPCs; authenticated users can only SELECT (staff)
--
-- Idempotent. Requires 0003 (is_staff / is_owner / has_app_access).
-- ============================================================================

-- ---------------------------------------------------------------- accounts
create table if not exists public.accounts (
  code         text primary key check (code ~ '^[0-9]{3,6}$'),
  name         text not null,
  type         text not null check (type in ('asset','liability','equity','revenue','expense')),
  normal_side  text not null check (normal_side in ('debit','credit')),
  parent_code  text references public.accounts(code),
  is_postable  boolean not null default true,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

insert into public.accounts(code, name, type, normal_side, parent_code) values
  ('111', 'Tiền mặt',                                   'asset',     'debit',  null),
  ('112', 'Tiền gửi ngân hàng',                         'asset',     'debit',  null),
  ('131', 'Phải thu của khách hàng',                    'asset',     'debit',  null),
  ('133', 'Thuế GTGT được khấu trừ',                    'asset',     'debit',  null),
  ('156', 'Hàng hóa',                                   'asset',     'debit',  null),
  ('331', 'Phải trả cho người bán',                     'liability', 'credit', null),
  ('3331','Thuế GTGT phải nộp',                         'liability', 'credit', null),
  ('411', 'Vốn đầu tư của chủ sở hữu',                  'equity',    'credit', null),
  ('421', 'Lợi nhuận sau thuế chưa phân phối',          'equity',    'credit', null),
  ('511', 'Doanh thu bán hàng và cung cấp dịch vụ',     'revenue',   'credit', null),
  ('521', 'Các khoản giảm trừ doanh thu',               'revenue',   'debit',  null),
  ('632', 'Giá vốn hàng bán',                           'expense',   'debit',  null),
  ('642', 'Chi phí quản lý kinh doanh',                 'expense',   'debit',  null),
  ('711', 'Thu nhập khác',                              'revenue',   'credit', null),
  ('811', 'Chi phí khác',                               'expense',   'debit',  null)
on conflict (code) do nothing;

-- ---------------------------------------------------------------- periods
create table if not exists public.fiscal_periods (
  id          uuid primary key default gen_random_uuid(),
  year        integer not null check (year between 2000 and 2100),
  month       integer not null check (month between 1 and 12),
  start_date  date not null,
  end_date    date not null,
  status      text not null default 'open' check (status in ('open','closed')),
  closed_at   timestamptz,
  closed_by   uuid,
  unique (year, month)
);

create table if not exists public.period_balances (          -- cumulative trial-balance snapshot taken at each close
  period_id     uuid not null references public.fiscal_periods(id) on delete restrict,
  snapshot_no   integer not null default 1,                   -- 2nd, 3rd... snapshot after a reopen + re-close
  account_code  text not null references public.accounts(code),
  debit         numeric(16,2) not null,
  credit        numeric(16,2) not null,
  primary key (period_id, snapshot_no, account_code)
);

create table if not exists public.accounting_audit (
  id      uuid primary key default gen_random_uuid(),
  at      timestamptz not null default now(),
  actor   uuid,
  action  text not null,
  detail  jsonb not null default '{}'::jsonb
);

-- gapless document numbers (consecutive numbering is a VN invoice requirement).
-- Increment happens in the caller's transaction: a rollback also rolls the number back.
create table if not exists public.doc_counters (
  prefix  text not null,
  year    integer not null,
  last    bigint not null default 0,
  primary key (prefix, year)
);

create or replace function public.next_doc_no(p_prefix text, p_date date)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_year int := extract(year from p_date)::int; v_n bigint;
begin
  insert into public.doc_counters(prefix, year, last) values (p_prefix, v_year, 1)
  on conflict (prefix, year) do update set last = public.doc_counters.last + 1
  returning last into v_n;
  return format('%s-%s-%s', p_prefix, v_year, lpad(v_n::text, 6, '0'));
end $$;

create or replace function public.ensure_period(p_date date)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; y int := extract(year from p_date)::int; m int := extract(month from p_date)::int;
begin
  select id into v_id from public.fiscal_periods where year = y and month = m;
  if v_id is null then
    insert into public.fiscal_periods(year, month, start_date, end_date)
    values (y, m, make_date(y, m, 1), (make_date(y, m, 1) + interval '1 month - 1 day')::date)
    on conflict (year, month) do nothing;
    select id into v_id from public.fiscal_periods where year = y and month = m;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------- journal
create table if not exists public.journal_entries (
  id           uuid primary key default gen_random_uuid(),
  entry_no     text not null unique,
  entry_date   date not null,
  period_id    uuid not null references public.fiscal_periods(id) on delete restrict,
  memo         text,
  source_type  text,
  source_id    uuid,
  reverses_id  uuid unique references public.journal_entries(id) on delete restrict,
  created_by   uuid,
  created_at   timestamptz not null default now()
);
create index if not exists idx_je_date on public.journal_entries(entry_date);
create index if not exists idx_je_source on public.journal_entries(source_type, source_id);

create table if not exists public.journal_lines (
  id            uuid primary key default gen_random_uuid(),
  entry_id      uuid not null references public.journal_entries(id) on delete restrict,
  line_no       integer not null,
  account_code  text not null references public.accounts(code),
  debit         numeric(16,2) not null default 0 check (debit >= 0),
  credit        numeric(16,2) not null default 0 check (credit >= 0),
  customer_id   uuid references public.customers(id) on delete restrict,
  supplier_id   uuid references public.suppliers(id) on delete restrict,
  memo          text,
  unique (entry_id, line_no),
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);
create index if not exists idx_jl_account on public.journal_lines(account_code);
create index if not exists idx_jl_customer on public.journal_lines(customer_id) where customer_id is not null;
create index if not exists idx_jl_supplier on public.journal_lines(supplier_id) where supplier_id is not null;

-- append-only
create or replace function public.trg_ledger_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'ledger is append-only: % on % is not allowed (post a reversal entry instead)', tg_op, tg_table_name
    using errcode = '42501';
end $$;
do $$
declare t text;
begin
  foreach t in array array['journal_entries','journal_lines','period_balances','accounting_audit'] loop
    execute format('drop trigger if exists trg_%I_immutable on public.%I', t, t);
    execute format('create trigger trg_%I_immutable before update or delete on public.%I for each row execute function public.trg_ledger_immutable()', t, t);
    execute format('drop trigger if exists trg_%I_notruncate on public.%I', t, t);
    execute format('create trigger trg_%I_notruncate before truncate on public.%I for each statement execute function public.trg_ledger_immutable()', t, t);
  end loop;
end $$;

-- period handling on entry insert
create or replace function public.trg_je_period()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_status text;
begin
  new.period_id := public.ensure_period(new.entry_date);
  select status into v_status from public.fiscal_periods where id = new.period_id;
  if v_status <> 'open' then
    raise exception 'period_closed' using detail = format('period of %s is closed', new.entry_date), errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_je_period on public.journal_entries;
create trigger trg_je_period before insert on public.journal_entries
  for each row execute function public.trg_je_period();

-- line rules: postable active account, partner dimension on control accounts, parent period open
create or replace function public.trg_jl_rules()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.accounts%rowtype; v_status text;
begin
  select * into a from public.accounts where code = new.account_code;
  if not a.is_postable or not a.active then raise exception 'account_not_postable: %', new.account_code; end if;
  if new.account_code = '131' and new.customer_id is null then raise exception 'customer_required_for_131'; end if;
  if new.account_code = '331' and new.supplier_id is null then raise exception 'supplier_required_for_331'; end if;
  if new.account_code not in ('131') and new.customer_id is not null then raise exception 'customer_only_on_131'; end if;
  if new.account_code not in ('331') and new.supplier_id is not null then raise exception 'supplier_only_on_331'; end if;
  select p.status into v_status from public.journal_entries e join public.fiscal_periods p on p.id = e.period_id where e.id = new.entry_id;
  if v_status <> 'open' then raise exception 'period_closed'; end if;
  return new;
end $$;
drop trigger if exists trg_jl_rules on public.journal_lines;
create trigger trg_jl_rules before insert on public.journal_lines
  for each row execute function public.trg_jl_rules();

-- balanced + at least two lines, checked at COMMIT (deferred) so even direct inserts cannot persist an unbalanced entry
create or replace function public.trg_je_balanced()
returns trigger language plpgsql as $$
declare v_id uuid; d numeric; c numeric; n int;
begin
  if tg_table_name = 'journal_entries' then v_id := new.id; else v_id := new.entry_id; end if;
  select coalesce(sum(debit),0), coalesce(sum(credit),0), count(*) into d, c, n from public.journal_lines where entry_id = v_id;
  if n < 2 then raise exception 'journal entry % needs at least 2 lines', v_id; end if;
  if d <> c then raise exception 'unbalanced journal entry %: debit % <> credit %', v_id, d, c; end if;
  return null;
end $$;
drop trigger if exists trg_jl_balanced on public.journal_lines;
create constraint trigger trg_jl_balanced after insert on public.journal_lines
  deferrable initially deferred for each row execute function public.trg_je_balanced();
drop trigger if exists trg_je_balanced on public.journal_entries;
create constraint trigger trg_je_balanced after insert on public.journal_entries
  deferrable initially deferred for each row execute function public.trg_je_balanced();

-- ---------------------------------------------------------------- posting RPCs
-- p_lines: [{"account":"131","debit":100,"credit":0,"customer_id":"..","supplier_id":"..","memo":".."}]
create or replace function public.post_journal(
  p_date date, p_memo text, p_lines jsonb,
  p_source_type text default 'manual', p_source_id uuid default null, p_reverses uuid default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; l jsonb; i int := 0; d numeric := 0; c numeric := 0; v_d numeric; v_c numeric;
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_date is null then raise exception 'date_required'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) < 2 then raise exception 'lines_required'; end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    v_d := coalesce((l->>'debit')::numeric, 0); v_c := coalesce((l->>'credit')::numeric, 0);
    if v_d < 0 or v_c < 0 or (v_d > 0) = (v_c > 0) then raise exception 'line_invalid: exactly one of debit/credit must be > 0'; end if;
    d := d + v_d; c := c + v_c;
  end loop;
  if d <> c then raise exception 'unbalanced: debit % <> credit %', d, c; end if;

  insert into public.journal_entries(entry_no, entry_date, period_id, memo, source_type, source_id, reverses_id, created_by)
  values (public.next_doc_no('JE', p_date), p_date, public.ensure_period(p_date), p_memo, p_source_type, p_source_id, p_reverses, auth.uid())
  returning id into v_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    insert into public.journal_lines(entry_id, line_no, account_code, debit, credit, customer_id, supplier_id, memo)
    values (v_id, i, l->>'account', coalesce((l->>'debit')::numeric, 0), coalesce((l->>'credit')::numeric, 0),
            nullif(l->>'customer_id','')::uuid, nullif(l->>'supplier_id','')::uuid, l->>'memo');
  end loop;
  return v_id;
end $$;

create or replace function public.reverse_journal(p_entry_id uuid, p_date date default current_date, p_memo text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare e public.journal_entries%rowtype; v_new uuid; v_lines jsonb;
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into e from public.journal_entries where id = p_entry_id;
  if not found then raise exception 'entry_not_found'; end if;
  if e.reverses_id is not null then raise exception 'cannot_reverse_a_reversal'; end if;
  if exists (select 1 from public.journal_entries where reverses_id = p_entry_id) then raise exception 'already_reversed'; end if;
  select jsonb_agg(jsonb_build_object('account', account_code, 'debit', credit, 'credit', debit,
                                      'customer_id', customer_id, 'supplier_id', supplier_id, 'memo', memo) order by line_no)
    into v_lines from public.journal_lines where entry_id = p_entry_id;
  v_new := public.post_journal(p_date, coalesce(p_memo, 'Bút toán đảo của ' || e.entry_no), v_lines,
                               'reversal', p_entry_id, p_entry_id);
  return v_new;
end $$;

-- ---------------------------------------------------------------- reports
create or replace function public.trial_balance(p_from date default null, p_to date default null)
returns table(account_code text, name text, debit numeric, credit numeric, balance numeric)
language sql stable security invoker set search_path = public, pg_temp as $$
  select a.code, a.name,
         coalesce(sum(l.debit), 0)::numeric, coalesce(sum(l.credit), 0)::numeric,
         case a.normal_side when 'debit' then coalesce(sum(l.debit - l.credit), 0) else coalesce(sum(l.credit - l.debit), 0) end::numeric
    from public.accounts a
    left join public.journal_lines l on l.account_code = a.code
    left join public.journal_entries e on e.id = l.entry_id
   where (l.id is null or ((p_from is null or e.entry_date >= p_from) and (p_to is null or e.entry_date <= p_to)))
   group by a.code, a.name, a.normal_side
  having coalesce(sum(l.debit), 0) <> 0 or coalesce(sum(l.credit), 0) <> 0
   order by a.code
$$;

create or replace function public.account_balance(p_code text, p_as_of date default null)
returns numeric language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(sum(case a.normal_side when 'debit' then l.debit - l.credit else l.credit - l.debit end), 0)
    from public.accounts a
    join public.journal_lines l on l.account_code = a.code
    join public.journal_entries e on e.id = l.entry_id
   where a.code = p_code and (p_as_of is null or e.entry_date <= p_as_of)
$$;

create or replace view public.v_general_ledger with (security_invoker = true) as
  select e.entry_date, e.entry_no, e.id as entry_id, l.line_no, l.account_code, a.name as account_name,
         l.debit, l.credit, l.customer_id, l.supplier_id, coalesce(l.memo, e.memo) as memo,
         e.source_type, e.source_id, e.reverses_id
    from public.journal_lines l
    join public.journal_entries e on e.id = l.entry_id
    join public.accounts a on a.code = l.account_code;

-- ---------------------------------------------------------------- period close
create or replace function public.close_period(p_year int, p_month int)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.fiscal_periods%rowtype; d numeric; c numeric;
begin
  if not (public.is_owner() or coalesce(auth.role(), '') = 'service_role') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform public.ensure_period(make_date(p_year, p_month, 1));
  select * into p from public.fiscal_periods where year = p_year and month = p_month for update;
  if p.status = 'closed' then raise exception 'already_closed'; end if;
  if exists (select 1 from public.fiscal_periods q where q.status = 'open' and q.end_date < p.start_date
               and exists (select 1 from public.journal_entries e where e.period_id = q.id)) then
    raise exception 'earlier_period_open';
  end if;
  select coalesce(sum(l.debit),0), coalesce(sum(l.credit),0) into d, c
    from public.journal_lines l join public.journal_entries e on e.id = l.entry_id where e.period_id = p.id;
  if d <> c then raise exception 'period_unbalanced: % vs %', d, c; end if;
  -- cumulative trial balance up to the end of the period, frozen
  insert into public.period_balances(period_id, snapshot_no, account_code, debit, credit)
  select p.id, (select coalesce(max(snapshot_no), 0) + 1 from public.period_balances b where b.period_id = p.id),
         t.account_code, t.debit, t.credit from public.trial_balance(null, p.end_date) t;
  update public.fiscal_periods set status = 'closed', closed_at = now(), closed_by = auth.uid() where id = p.id;
  insert into public.accounting_audit(actor, action, detail) values (auth.uid(), 'close_period', jsonb_build_object('year', p_year, 'month', p_month, 'debit', d, 'credit', c));
  return jsonb_build_object('year', p_year, 'month', p_month, 'status', 'closed', 'period_debit', d, 'period_credit', c);
end $$;

-- Reopen is allowed only for the LATEST closed period, needs a reason and is audited; old snapshots are kept
-- (append-only) and a later re-close writes snapshot_no + 1.
create or replace function public.reopen_period(p_year int, p_month int, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.fiscal_periods%rowtype;
begin
  if not (public.is_owner() or coalesce(auth.role(), '') = 'service_role') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_reason is null or length(btrim(p_reason)) < 5 then raise exception 'reason_required'; end if;
  select * into p from public.fiscal_periods where year = p_year and month = p_month for update;
  if not found then raise exception 'period_not_found'; end if;
  if p.status <> 'closed' then raise exception 'not_closed'; end if;
  if exists (select 1 from public.fiscal_periods q where q.status = 'closed' and q.start_date > p.start_date) then
    raise exception 'later_period_closed';
  end if;
  update public.fiscal_periods set status = 'open', closed_at = null, closed_by = null where id = p.id;
  insert into public.accounting_audit(actor, action, detail) values (auth.uid(), 'reopen_period', jsonb_build_object('year', p_year, 'month', p_month, 'reason', p_reason));
  return jsonb_build_object('year', p_year, 'month', p_month, 'status', 'open');
end $$;

-- ---------------------------------------------------------------- RLS / grants
do $$
declare t text;
begin
  foreach t in array array['accounts','fiscal_periods','period_balances','accounting_audit','doc_counters','journal_entries','journal_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "staff_read_%I" on public.%I', t, t);
    execute format('create policy "staff_read_%I" on public.%I for select to authenticated using (public.is_staff())', t, t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
  end loop;
end $$;
-- the ledger is written by SECURITY DEFINER functions only
do $$
declare f text;
begin
  foreach f in array array[
    'public.next_doc_no(text, date)', 'public.ensure_period(date)',
    'public.post_journal(date, text, jsonb, text, uuid, uuid)', 'public.reverse_journal(uuid, date, text)',
    'public.close_period(integer, integer)', 'public.reopen_period(integer, integer, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  -- internal helpers: not callable by API roles
  revoke all on function public.next_doc_no(text, date) from authenticated;
  revoke all on function public.ensure_period(date) from authenticated;
end $$;
grant select on public.v_general_ledger to authenticated;
