-- ============================================================================
-- 0012_hkd_profile_tax.sql — A1: hồ sơ hộ kinh doanh, nhóm ngành thuế, ngưỡng doanh thu 1 tỷ
--
-- * business_profile  : 1 dòng duy nhất (tên HKD, chủ hộ, MST / CCCD, địa chỉ, ngành nghề, nhóm ngành chính,
--                       phương pháp thuế, ngày bắt đầu, người ký sổ). CCCD chỉ owner đọc/sửa được.
-- * business_locations: địa điểm kinh doanh (trụ sở + các điểm khác), trạng thái hoạt động / tạm ngừng / đóng.
-- * tax_groups, tax_rates, legal_thresholds: cấu hình pháp lý theo ngày hiệu lực — KHÔNG hard-code ngưỡng 1 tỷ.
-- * v_revenue_events + revenue_ytd / revenue_by_month / threshold_status: doanh thu năm (tổng tiền ghi trên hóa đơn,
--   đã gồm thuế, trừ hóa đơn hủy) so với ngưỡng, cảnh báo ở 80 % (warning) và 100 % (exceeded).
--
-- Mọi ghi đi qua RPC SECURITY DEFINER (chỉ owner); staff chỉ đọc. Idempotent. Cần 0003, 0004, 0006.
-- ============================================================================

-- ---------------------------------------------------------------- nhóm ngành & tỷ lệ
create table if not exists public.tax_groups (
  code        text primary key check (code ~ '^[a-z_]{2,40}$'),
  name_vi     text not null,
  sort_order  integer not null default 0
);

create table if not exists public.tax_rates (
  tax_group      text not null references public.tax_groups(code) on delete restrict,
  vat_pct        numeric(5,2) check (vat_pct is null or vat_pct between 0 and 100),
  pit_pct        numeric(5,2) check (pit_pct is null or pit_pct between 0 and 100),
  effective_from date not null,
  source         text not null,
  primary key (tax_group, effective_from)
);

create table if not exists public.legal_thresholds (
  key            text not null check (key ~ '^[a-z_]{2,60}$'),
  value          numeric(20,2) not null check (value >= 0),
  effective_from date not null,
  source         text not null,
  primary key (key, effective_from)
);

insert into public.tax_groups(code, name_vi, sort_order) values
  ('goods',              'Phân phối, cung cấp hàng hóa',                                                           10),
  ('service',            'Dịch vụ, xây dựng không bao thầu nguyên vật liệu',                                       20),
  ('production_service', 'Sản xuất, vận tải, dịch vụ gắn với hàng hóa, xây dựng có bao thầu nguyên vật liệu',     30),
  ('other',              'Hoạt động kinh doanh khác',                                                              90)
on conflict (code) do nothing;

insert into public.tax_rates(tax_group, vat_pct, pit_pct, effective_from, source) values
  ('goods',              1, 0.5, date '2026-01-01', 'Luật GTGT 48/2024 Đ12.2 (VBHN 114/2026); mẫu 01/CNKD — chủ hộ/kế toán thuế xác nhận'),
  ('service',            5, 2,   date '2026-01-01', 'Luật GTGT 48/2024 Đ12.2 (VBHN 114/2026); mẫu 01/CNKD — phân loại sửa chữa/cài đặt cần xác nhận'),
  ('production_service', 3, 1.5, date '2026-01-01', 'Luật GTGT 48/2024 Đ12.2 (VBHN 114/2026); mẫu 01/CNKD — áp cho lắp ráp theo yêu cầu cần xác nhận'),
  ('other',              2, 1,   date '2026-01-01', 'Luật GTGT 48/2024 Đ12.2 (VBHN 114/2026); mẫu 01/CNKD')
on conflict (tax_group, effective_from) do nothing;

insert into public.legal_thresholds(key, value, effective_from, source) values
  ('exempt_revenue',         1000000000,   date '2026-01-01', 'ND68/2026/NĐ-CP sửa bởi ND141/2026/NĐ-CP (500 triệu -> 1 tỷ, hồi tố 01/01/2026)'),
  ('pit_income_mandatory',   3000000000,   date '2026-01-01', 'Phụ lục E kế hoạch HKD — chỉ dùng khi chuyển kịch bản B/C'),
  ('monthly_filing_over',    50000000000,  date '2026-01-01', 'Phụ lục E kế hoạch HKD — chỉ dùng khi chuyển kịch bản B/C'),
  ('tax_waive_amount',       50000,        date '2026-01-01', 'Mẫu 01/TKN-CNKD, 02/CNKD-TNCN-QTT: thuế phải nộp <= 50.000đ được miễn'),
  ('cash_limit_per_payment', 5000000,      date '2026-01-01', 'Phụ lục E kế hoạch HKD — ghi cờ tiền mặt từ 5 triệu'),
  ('revenue_warn_pct',       80,           date '2026-01-01', 'Cấu hình ứng dụng: cảnh báo khi doanh thu năm đạt tỷ lệ % này của ngưỡng miễn thuế')
on conflict (key, effective_from) do nothing;

-- giá trị hiệu lực của một ngưỡng tại một ngày (null nếu chưa có cấu hình)
create or replace function public.legal_threshold(p_key text, p_on date default current_date)
returns numeric language sql stable security invoker set search_path = public, pg_temp as $$
  select value from public.legal_thresholds where key = p_key and effective_from <= p_on order by effective_from desc limit 1
$$;

-- ---------------------------------------------------------------- hồ sơ HKD
create table if not exists public.business_profile (
  id                 boolean primary key default true check (id),     -- đúng 1 dòng
  business_name      text not null check (btrim(business_name) <> ''),
  owner_name         text,
  tax_code           text check (tax_code is null or tax_code ~ '^([0-9]{10}(-[0-9]{3})?|[0-9]{12})$'),
  citizen_id         text check (citizen_id is null or citizen_id ~ '^([0-9]{9}|[0-9]{12})$'),
  residence_address  text,
  phone              text,
  email              text check (email is null or email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  industries         text,
  main_tax_group     text references public.tax_groups(code) on delete restrict,
  tax_method         text not null default 'exempt_notice' check (tax_method in ('exempt_notice', 'revenue_pct', 'profit')),
  start_date         date,
  ledger_signer      text,
  updated_at         timestamptz not null default now(),
  updated_by         uuid
);

create table if not exists public.business_locations (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (btrim(name) <> ''),
  address            text not null check (btrim(address) <> ''),
  main_tax_group     text references public.tax_groups(code) on delete restrict,
  is_hq              boolean not null default false,
  status             text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  opened_on          date,
  closed_on          date,
  tax_location_code  text,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (closed_on is null or opened_on is null or closed_on >= opened_on)
);
-- tối đa 1 trụ sở đang còn hoạt động / tạm ngừng
create unique index if not exists uq_business_locations_hq on public.business_locations((true)) where is_hq and status <> 'closed';

-- ---------------------------------------------------------------- RPC ghi (chỉ owner)
create or replace function public._clean_text(p text) returns text
language sql immutable set search_path = public, pg_temp as $$ select nullif(btrim(p), '') $$;

create or replace function public.set_business_profile(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_name text := public._clean_text(p->>'business_name');
  v_tax text := public._clean_text(p->>'tax_code');
  v_cccd text := public._clean_text(p->>'citizen_id');
  v_email text := public._clean_text(p->>'email');
  v_method text := coalesce(public._clean_text(p->>'tax_method'), 'exempt_notice');
  v_group text := public._clean_text(p->>'main_tax_group');
  v_start date;
begin
  if not public.is_owner() then raise exception 'forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'profile_invalid'; end if;
  if v_name is null then raise exception 'business_name_required'; end if;
  if v_tax is not null and v_tax !~ '^([0-9]{10}(-[0-9]{3})?|[0-9]{12})$' then raise exception 'tax_code_invalid'; end if;
  if v_cccd is not null and v_cccd !~ '^([0-9]{9}|[0-9]{12})$' then raise exception 'citizen_id_invalid'; end if;
  if v_email is not null and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'email_invalid'; end if;
  if v_method not in ('exempt_notice', 'revenue_pct', 'profit') then raise exception 'tax_method_invalid'; end if;
  if v_group is not null and not exists (select 1 from public.tax_groups where code = v_group) then raise exception 'tax_group_unknown'; end if;
  begin v_start := nullif(btrim(p->>'start_date'), '')::date;
  exception when others then raise exception 'start_date_invalid'; end;

  insert into public.business_profile(id, business_name, owner_name, tax_code, citizen_id, residence_address, phone, email,
                                      industries, main_tax_group, tax_method, start_date, ledger_signer, updated_at, updated_by)
  values (true, v_name, public._clean_text(p->>'owner_name'), v_tax, v_cccd, public._clean_text(p->>'residence_address'),
          public._clean_text(p->>'phone'), v_email, public._clean_text(p->>'industries'), v_group, v_method, v_start,
          public._clean_text(p->>'ledger_signer'), now(), (select auth.uid()))
  on conflict (id) do update set
    business_name = excluded.business_name, owner_name = excluded.owner_name, tax_code = excluded.tax_code,
    citizen_id = excluded.citizen_id, residence_address = excluded.residence_address, phone = excluded.phone,
    email = excluded.email, industries = excluded.industries, main_tax_group = excluded.main_tax_group,
    tax_method = excluded.tax_method, start_date = excluded.start_date, ledger_signer = excluded.ledger_signer,
    updated_at = now(), updated_by = excluded.updated_by;
  -- nhật ký: không ghi giá trị CCCD
  insert into public.accounting_audit(actor, action, detail)
  values ((select auth.uid()), 'set_business_profile', jsonb_build_object('business_name', v_name, 'tax_method', v_method, 'has_citizen_id', v_cccd is not null));
  return public.get_business_profile();
end $$;

create or replace function public.upsert_business_location(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_name text := public._clean_text(p->>'name');
  v_addr text := public._clean_text(p->>'address');
  v_group text := public._clean_text(p->>'main_tax_group');
  v_status text := coalesce(public._clean_text(p->>'status'), 'active');
  v_hq boolean := coalesce((p->>'is_hq')::boolean, false);
  v_opened date; v_closed date;
begin
  if not public.is_owner() then raise exception 'forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'location_invalid'; end if;
  if v_name is null then raise exception 'location_name_required'; end if;
  if v_addr is null then raise exception 'location_address_required'; end if;
  if v_status not in ('active', 'suspended', 'closed') then raise exception 'location_status_invalid'; end if;
  if v_group is not null and not exists (select 1 from public.tax_groups where code = v_group) then raise exception 'tax_group_unknown'; end if;
  begin
    v_opened := nullif(btrim(p->>'opened_on'), '')::date; v_closed := nullif(btrim(p->>'closed_on'), '')::date;
    v_id := nullif(btrim(p->>'id'), '')::uuid;
  exception when others then raise exception 'location_invalid'; end;
  if v_status = 'closed' and v_closed is null then v_closed := current_date; end if;
  if v_status <> 'closed' then v_closed := null; end if;
  if v_status = 'closed' then v_hq := false; end if;
  if v_closed is not null and v_opened is not null and v_closed < v_opened then raise exception 'location_dates_invalid'; end if;

  if v_id is not null then perform 1 from public.business_locations where id = v_id for update; if not found then raise exception 'location_not_found'; end if; end if;
  -- chuyển trụ sở: hạ trụ sở cũ trước (một giao dịch)
  if v_hq then update public.business_locations set is_hq = false, updated_at = now() where is_hq and id is distinct from v_id; end if;

  if v_id is null then
    insert into public.business_locations(name, address, main_tax_group, is_hq, status, opened_on, closed_on, tax_location_code, notes)
    values (v_name, v_addr, v_group, v_hq, v_status, v_opened, v_closed, public._clean_text(p->>'tax_location_code'), public._clean_text(p->>'notes'))
    returning id into v_id;
  else
    update public.business_locations set name = v_name, address = v_addr, main_tax_group = v_group, is_hq = v_hq, status = v_status,
           opened_on = v_opened, closed_on = v_closed, tax_location_code = public._clean_text(p->>'tax_location_code'),
           notes = public._clean_text(p->>'notes'), updated_at = now()
     where id = v_id;
  end if;
  insert into public.accounting_audit(actor, action, detail)
  values ((select auth.uid()), 'upsert_business_location', jsonb_build_object('id', v_id, 'status', v_status, 'is_hq', v_hq));
  return (select to_jsonb(l) from public.business_locations l where l.id = v_id);
end $$;

create or replace function public.set_legal_threshold(p_key text, p_value numeric, p_effective_from date, p_source text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_owner() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_key is null or p_key !~ '^[a-z_]{2,60}$' then raise exception 'threshold_key_invalid'; end if;
  if p_value is null or p_value < 0 then raise exception 'threshold_value_invalid'; end if;
  if p_effective_from is null then raise exception 'date_required'; end if;
  if public._clean_text(p_source) is null then raise exception 'source_required'; end if;
  insert into public.legal_thresholds(key, value, effective_from, source) values (p_key, p_value, p_effective_from, btrim(p_source))
  on conflict (key, effective_from) do update set value = excluded.value, source = excluded.source;
  insert into public.accounting_audit(actor, action, detail)
  values ((select auth.uid()), 'set_legal_threshold', jsonb_build_object('key', p_key, 'value', p_value, 'effective_from', p_effective_from, 'source', btrim(p_source)));
  return jsonb_build_object('key', p_key, 'value', p_value, 'effective_from', p_effective_from);
end $$;

-- ---------------------------------------------------------------- RPC đọc
-- staff đọc được hồ sơ (cho báo giá, tiêu đề sổ); CCCD chỉ trả cho owner.
create or replace function public.get_business_profile()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare b public.business_profile%rowtype; v_owner boolean := public.is_owner(); j jsonb;
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into b from public.business_profile where id;
  if not found then return jsonb_build_object('exists', false, 'is_owner', v_owner, 'profile', null); end if;
  j := to_jsonb(b) - 'id' - 'updated_by';
  if not v_owner then j := j - 'citizen_id'; end if;
  return jsonb_build_object('exists', true, 'is_owner', v_owner, 'profile', j);
end $$;

-- ---------------------------------------------------------------- doanh thu năm vs ngưỡng
-- Doanh thu tính thuế = tổng tiền ghi trên hóa đơn bán (đã gồm thuế), không trừ hóa đơn đã hủy.
-- 0013 (A2) thêm dòng 'return' (hàng bán trả lại) bằng create or replace view cùng cột.
create or replace view public.v_revenue_events with (security_invoker = true) as
  select i.invoice_date as event_date, 'sale'::text as kind, i.id as doc_id, i.total as amount
    from public.sales_invoices i
   where i.voided_at is null;

create or replace function public.revenue_ytd(p_year int default null)
returns numeric language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_year int := coalesce(p_year, extract(year from (now() at time zone 'Asia/Ho_Chi_Minh'))::int);
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((select sum(amount) from public.v_revenue_events
                    where event_date >= make_date(v_year, 1, 1) and event_date <= make_date(v_year, 12, 31)), 0);
end $$;

create or replace function public.revenue_by_month(p_year int default null)
returns table(month date, revenue numeric, cumulative numeric)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_year int := coalesce(p_year, extract(year from (now() at time zone 'Asia/Ho_Chi_Minh'))::int);
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  with m as (select make_date(v_year, g, 1) as d from generate_series(1, 12) g),
       s as (select date_trunc('month', event_date)::date as d, sum(amount) as amt from public.v_revenue_events
              where event_date >= make_date(v_year, 1, 1) and event_date <= make_date(v_year, 12, 31) group by 1)
  select m.d, coalesce(s.amt, 0)::numeric, (sum(coalesce(s.amt, 0)) over (order by m.d))::numeric from m left join s on s.d = m.d order by m.d;
end $$;

-- level: none (chưa cấu hình ngưỡng) | ok | warning (>= revenue_warn_pct) | exceeded (>= 100 %)
-- Luật chỉ coi là "vượt" khi doanh thu > ngưỡng; ứng dụng cảnh báo sớm ngay khi chạm 100 %.
create or replace function public.threshold_status(p_year int default null)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_year int := coalesce(p_year, extract(year from (now() at time zone 'Asia/Ho_Chi_Minh'))::int);
  v_rev numeric; v_thr numeric; v_warn numeric; v_pct numeric; v_level text; v_src text;
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  v_rev := public.revenue_ytd(v_year);
  v_thr := public.legal_threshold('exempt_revenue', make_date(v_year, 12, 31));
  v_warn := coalesce(public.legal_threshold('revenue_warn_pct', make_date(v_year, 12, 31)), 80);
  select source into v_src from public.legal_thresholds where key = 'exempt_revenue' and effective_from <= make_date(v_year, 12, 31) order by effective_from desc limit 1;
  if v_thr is null or v_thr <= 0 then
    return jsonb_build_object('year', v_year, 'revenue', v_rev, 'threshold', null, 'pct', null, 'remaining', null, 'level', 'none', 'warn_pct', v_warn, 'source', null);
  end if;
  v_pct := trunc(v_rev * 100 / v_thr, 2);   -- cắt (không làm tròn lên): 999.999.999 đ không hiện 100 %
  v_level := case when v_rev >= v_thr then 'exceeded' when v_pct >= v_warn then 'warning' else 'ok' end;
  return jsonb_build_object('year', v_year, 'revenue', v_rev, 'threshold', v_thr, 'pct', v_pct, 'remaining', greatest(v_thr - v_rev, 0),
                            'level', v_level, 'warn_pct', v_warn, 'source', v_src);
end $$;

-- ---------------------------------------------------------------- RLS / grants
do $$
declare t text;
begin
  foreach t in array array['tax_groups', 'tax_rates', 'legal_thresholds', 'business_locations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "staff_read_%I" on public.%I', t, t);
    execute format('create policy "staff_read_%I" on public.%I for select to authenticated using ((select public.is_staff()))', t, t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
  end loop;
end $$;
-- hồ sơ chứa CCCD: chỉ owner đọc bảng trực tiếp; staff dùng get_business_profile()
alter table public.business_profile enable row level security;
drop policy if exists "owner_read_business_profile" on public.business_profile;
create policy "owner_read_business_profile" on public.business_profile for select to authenticated using ((select public.is_owner()));
revoke all on public.business_profile from anon;
revoke insert, update, delete, truncate on public.business_profile from authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.legal_threshold(text, date)', 'public.set_business_profile(jsonb)', 'public.upsert_business_location(jsonb)',
    'public.set_legal_threshold(text, numeric, date, text)', 'public.get_business_profile()',
    'public.revenue_ytd(integer)', 'public.revenue_by_month(integer)', 'public.threshold_status(integer)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  -- tiện ích nội bộ: không gọi được qua /rest/v1/rpc
  revoke all on function public._clean_text(text) from public, anon, authenticated;
end $$;
grant select on public.v_revenue_events to authenticated;
