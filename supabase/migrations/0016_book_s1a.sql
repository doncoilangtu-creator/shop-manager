-- 0016 (A5): Sổ doanh thu bán hàng hóa, dịch vụ — mẫu S1a-HKD (TT152/2025/TT-BTC Điều 4)
--  * book_s1a(từ ngày, đến ngày, địa điểm, chế độ): dòng sổ sinh từ chứng từ đã ghi (một nguồn dữ liệu, ADR D1):
--      + đơn bán (ngày đơn) theo từng nhóm ngành; số tiền = tổng tiền đã gồm thuế (giá đã gồm VAT; đơn legacy cộng VAT);
--      − hàng bán bị trả lại / giảm giá (ngày phiếu);
--      đơn/phiếu bị hủy: nếu bút toán hủy cùng tháng với chứng từ gốc thì bỏ cả hai (coi như không phát sinh);
--      nếu hủy ở tháng sau (tháng gốc có thể đã khóa sổ) thì ghi một dòng điều chỉnh ngược dấu vào ngày hủy — sổ của kỳ đã khóa không đổi.
--    Chế độ 'detail' = từng nghiệp vụ; 'daily' = tổng hợp theo ngày (TT152 Đ4.2.b cho phép ghi theo nghiệp vụ hoặc định kỳ).
--    Địa điểm: đơn chưa gắn địa điểm được tính cho trụ sở (is_hq).
--  * book_s1a_check: tổng S1a so với sổ cái (511 − 521 + 3331 legacy) cùng kỳ — chỉ có nghĩa khi kỳ trọn tháng.
--  * book_exports: nhật ký xuất sổ/tờ khai/gói hồ sơ (loại, kỳ, định dạng, SHA-256, số dòng, tổng tiền, phiên bản mẫu), chỉ thêm, không sửa/xóa.
-- Forward-only, chỉ thêm bảng/hàm; không đụng dữ liệu cũ.

-- ---------------------------------------------------------------- sổ S1a
create or replace function public.book_s1a(p_from date, p_to date, p_location_id uuid default null, p_mode text default 'detail')
returns table(line_date date, doc_no text, description text, amount numeric, tax_group text, location_id uuid, doc_type text, doc_id uuid)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_hq uuid;
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'period_invalid'; end if;
  if p_to - p_from > 1830 then raise exception 'period_invalid: tối đa 5 năm'; end if;
  if coalesce(p_mode, 'detail') not in ('detail', 'daily') then raise exception 'mode_invalid'; end if;
  select b.id into v_hq from public.business_locations b where b.is_hq order by (b.status = 'closed'), b.created_at limit 1;
  return query
  with sale_grp as (
    select i.id, i.invoice_no, i.invoice_date, i.voided_at, coalesce(i.location_id, v_hq) as loc, l.tax_group as grp,
           sum(l.line_net + l.vat_amount) as amt,
           count(*) over (partition by i.id) as n_grp,
           (select e.entry_date from public.journal_entries e where e.id = i.void_entry_id) as void_date,
           coalesce(c.is_walkin, false) as walkin, c.name as cust
      from public.sales_invoices i
      join public.sales_invoice_lines l on l.invoice_id = i.id
      left join public.customers c on c.id = i.customer_id
     group by i.id, i.invoice_no, i.invoice_date, i.voided_at, i.location_id, i.void_entry_id, l.tax_group, c.is_walkin, c.name
  ), ret_grp as (
    select r.id, r.return_no, r.return_date, r.voided_at, i.invoice_no, coalesce(i.location_id, v_hq) as loc, sl.tax_group as grp,
           sum(rl.amount) as amt,
           count(*) over (partition by r.id) as n_grp,
           (select e.entry_date from public.journal_entries e where e.id = r.void_entry_id) as void_date
      from public.sales_returns r
      join public.sales_invoices i on i.id = r.sale_id
      join public.sales_return_lines rl on rl.return_id = r.id
      join public.sales_invoice_lines sl on sl.id = rl.sale_line_id
     group by r.id, r.return_no, r.return_date, r.voided_at, r.void_entry_id, i.invoice_no, i.location_id, sl.tax_group
  ), einv as (
    select distinct on (e.sale_id) e.sale_id, nullif(concat_ws('-', e.symbol, e.number), '') as ref
      from public.einvoices e where e.status = 'issued' and e.kind in ('original', 'replace')
     order by e.sale_id, e.created_at desc
  ), ev as (
    -- đơn bán (bỏ nếu bị hủy cùng tháng)
    select s.invoice_date as d, s.invoice_no as no, 'sale'::text as typ, s.id as did, s.grp, s.loc, s.amt,
           'Bán hàng ' || coalesce('HĐ ' || ei.ref || ' (đơn ' || s.invoice_no || ')', 'đơn ' || s.invoice_no)
             || case when s.walkin or s.cust is null then ' — khách lẻ' else ' — ' || s.cust end
             || case when s.n_grp > 1 then ' — ' || coalesce(g.name_vi, s.grp) else '' end as txt
      from sale_grp s left join einv ei on ei.sale_id = s.id left join public.tax_groups g on g.code = s.grp
     where not (s.voided_at is not null and date_trunc('month', s.void_date) = date_trunc('month', s.invoice_date))
    union all
    -- hủy đơn ở tháng sau: dòng điều chỉnh giảm vào ngày hủy
    select s.void_date, s.invoice_no, 'sale_void', s.id, s.grp, s.loc, -s.amt,
           'Hủy đơn bán ' || s.invoice_no || ' ngày ' || to_char(s.invoice_date, 'DD/MM/YYYY') || ' (điều chỉnh giảm doanh thu)'
             || case when s.n_grp > 1 then ' — ' || coalesce(g.name_vi, s.grp) else '' end
      from sale_grp s left join public.tax_groups g on g.code = s.grp
     where s.voided_at is not null and date_trunc('month', s.void_date) <> date_trunc('month', s.invoice_date)
    union all
    select r.return_date, r.return_no, 'return', r.id, r.grp, r.loc, -r.amt,
           'Hàng bán bị trả lại / giảm giá — phiếu ' || r.return_no || ' (đơn ' || r.invoice_no || ')'
             || case when r.n_grp > 1 then ' — ' || coalesce(g.name_vi, r.grp) else '' end
      from ret_grp r left join public.tax_groups g on g.code = r.grp
     where not (r.voided_at is not null and date_trunc('month', r.void_date) = date_trunc('month', r.return_date))
    union all
    select r.void_date, r.return_no, 'return_void', r.id, r.grp, r.loc, r.amt,
           'Hủy phiếu trả hàng ' || r.return_no || ' ngày ' || to_char(r.return_date, 'DD/MM/YYYY')
             || case when r.n_grp > 1 then ' — ' || coalesce(g.name_vi, r.grp) else '' end
      from ret_grp r left join public.tax_groups g on g.code = r.grp
     where r.voided_at is not null and date_trunc('month', r.void_date) <> date_trunc('month', r.return_date)
  ), f as (
    select * from ev
     where ev.d between p_from and p_to and ev.amt <> 0
       and (p_location_id is null or ev.loc is not distinct from p_location_id)
  )
  select x.d, x.no, x.txt, x.amt, x.grp, x.loc, x.typ, x.did from (
    select f.d, f.no, f.txt, f.amt, f.grp, f.loc, f.typ, f.did, 0 as k from f where coalesce(p_mode, 'detail') = 'detail'
    union all
    select f.d, null::text,
           case when sum(f.amt) >= 0 then 'Doanh thu bán hàng hóa, dịch vụ ngày ' else 'Điều chỉnh giảm doanh thu (trả hàng/hủy đơn) ngày ' end
             || to_char(f.d, 'DD/MM/YYYY') || ' — ' || coalesce(max(g.name_vi), f.grp) || ' (' || count(*) || ' chứng từ)',
           sum(f.amt), f.grp, case when p_location_id is null then null else p_location_id end,
           case when sum(f.amt) >= 0 then 'daily' else 'daily_adjust' end, null::uuid, case when sum(f.amt) >= 0 then 0 else 1 end
      from f left join public.tax_groups g on g.code = f.grp
     where p_mode = 'daily'
     group by f.d, f.grp, (f.amt >= 0)
  ) x
  order by x.d, x.k, x.no nulls last, x.grp;
end $$;

-- tổng S1a so với sổ cái cùng kỳ (doanh thu thuần: 511 − 521, cộng 3331 của đơn legacy có VAT)
create or replace function public.book_s1a_check(p_from date, p_to date)
returns table(s1a_total numeric, gl_total numeric, diff numeric)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_s numeric; v_g numeric;
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(sum(b.amount), 0) into v_s from public.book_s1a(p_from, p_to, null, 'detail') b;
  select coalesce(sum(l.credit - l.debit), 0) into v_g
    from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
   where l.account_code in ('511', '521', '3331') and e.entry_date between p_from and p_to;
  return query select v_s, v_g, v_s - v_g;
end $$;

-- ---------------------------------------------------------------- nhật ký xuất sổ / tờ khai / gói hồ sơ
create table if not exists public.book_exports (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null check (kind in ('s1a', 'tkn_cnkd', 'bk_stk', 'audit_pack')),
  period_from      date not null,
  period_to        date not null check (period_to >= period_from),
  location_id      uuid references public.business_locations(id) on delete restrict,
  format           text not null check (format in ('xlsx', 'pdf', 'zip')),
  file_name        text not null check (char_length(file_name) between 1 and 200),
  sha256           text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  row_count        integer not null default 0 check (row_count >= 0),
  total            numeric(18,2),
  template_version text not null,
  options          jsonb not null default '{}'::jsonb,
  exported_by      uuid,
  exported_at      timestamptz not null default now()
);
create index if not exists idx_book_exports_kind on public.book_exports(kind, exported_at desc);

create or replace function public.trg_book_exports_immutable()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'immutable: book_exports';
end $$;
drop trigger if exists trg_book_exports_immutable on public.book_exports;
create trigger trg_book_exports_immutable before update or delete on public.book_exports
  for each row execute function public.trg_book_exports_immutable();
revoke execute on function public.trg_book_exports_immutable() from public, anon, authenticated;

alter table public.book_exports enable row level security;
drop policy if exists "staff_read_book_exports" on public.book_exports;
create policy "staff_read_book_exports" on public.book_exports for select to authenticated using ((select public.is_staff()));
revoke all on public.book_exports from anon;
revoke insert, update, delete, truncate on public.book_exports from authenticated;

create or replace function public.record_book_export(p jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := gen_random_uuid();
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'export_invalid'; end if;
  insert into public.book_exports(id, kind, period_from, period_to, location_id, format, file_name, sha256, row_count, total, template_version, options, exported_by)
  values (v_id, p->>'kind', (p->>'period_from')::date, (p->>'period_to')::date, nullif(p->>'location_id', '')::uuid, p->>'format',
          left(p->>'file_name', 200), lower(p->>'sha256'), coalesce((p->>'row_count')::int, 0), nullif(p->>'total', '')::numeric,
          coalesce(nullif(p->>'template_version', ''), 'unknown'), coalesce(p->'options', '{}'::jsonb), (select auth.uid()));
  return v_id;
exception when check_violation or not_null_violation or invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
  raise exception 'export_invalid';
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.book_s1a(date, date, uuid, text)', 'public.book_s1a_check(date, date)', 'public.record_book_export(jsonb)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
