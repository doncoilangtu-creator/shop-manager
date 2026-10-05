-- 0017 (A6): Dữ liệu tờ khai cho HKD doanh thu ≤ 1 tỷ
--  * tkn_cnkd_data(năm, nửa năm): số liệu phần A mẫu 01/TKN-CNKD (TT50/2026/TT-BTC) — doanh thu theo chỉ tiêu
--    [08a..08g] (địa điểm cố định) / [09a..09g] (sàn TMĐT, nền tảng số), [10], [11] tổng cộng. Lấy từ book_s1a (cùng một nguồn
--    với sổ S1a nên tổng tờ khai = tổng sổ). HKD ≤ 1 tỷ chỉ thông báo doanh thu, không khai số thuế.
--  * Số tài khoản ĐẦY ĐỦ cho mẫu 01/BK-STK (TT18/2026): bảng riêng money_account_numbers, RLS chỉ chủ hộ đọc; nhân viên vẫn chỉ thấy
--    money_accounts.account_no_masked (****1234). upsert_money_account lưu số đầy đủ + bản che.
--  * money_accounts thêm: location_id (địa điểm KD dùng tài khoản), info_changed_at (đổi thông tin sau khi đã thông báo),
--    bk_closed_reported (đã khai “đóng”). bk_stk_data(): danh sách kê khai với trạng thái [09] khai lần đầu / thay đổi / đóng;
--    mark_bk_stk_filed(): đánh dấu đã nộp bảng kê.
-- Forward-only; chỉ ADD COLUMN nullable/default + bảng/hàm mới. Không đụng sổ cái.

-- ---------------------------------------------------------------- số tài khoản đầy đủ (chỉ owner)
create table if not exists public.money_account_numbers (
  account_id  uuid primary key references public.money_accounts(id) on delete cascade,
  account_no  text not null check (account_no ~ '^[0-9A-Za-z]{4,30}$'),
  updated_by  uuid,
  updated_at  timestamptz not null default now()
);
alter table public.money_account_numbers enable row level security;
drop policy if exists "owner_read_money_account_numbers" on public.money_account_numbers;
create policy "owner_read_money_account_numbers" on public.money_account_numbers for select to authenticated using ((select public.is_owner()));
revoke all on public.money_account_numbers from anon;
revoke insert, update, delete, truncate on public.money_account_numbers from authenticated;

alter table public.money_accounts add column if not exists location_id uuid references public.business_locations(id) on delete restrict;
alter table public.money_accounts add column if not exists info_changed_at timestamptz;
alter table public.money_accounts add column if not exists bk_closed_reported boolean not null default false;

-- p: {"kind","label","provider","account_no","holder","tax_notified","tax_notified_at","active","is_default","location_id"}
-- số tài khoản: lưu đầy đủ ở money_account_numbers (owner đọc) + bản che ****1234 ở money_accounts (nhân viên đọc)
create or replace function public.upsert_money_account(p_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare m public.money_accounts%rowtype; v_new boolean := p_id is null; v_kind text; v_label text; v_prov text; v_hold text; v_mask text; v_digits text;
        v_tn boolean; v_tna date; v_act boolean; v_def boolean; v_id uuid; v_loc uuid; v_old_no text; v_no_changed boolean := false;
        v_changed timestamptz; v_closed_rep boolean;
begin
  if not (select public.is_owner()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'money_account_invalid'; end if;
  if v_new then
    v_kind := p->>'kind';
    if v_kind is null or v_kind not in ('cash', 'bank', 'ewallet') then raise exception 'money_account_kind_invalid'; end if;
    m.kind := v_kind;
  else
    select * into m from public.money_accounts where id = p_id for update;
    if not found then raise exception 'money_account_not_found'; end if;
    if p ? 'kind' and p->>'kind' is distinct from m.kind then raise exception 'money_account_kind_immutable'; end if;
    select n.account_no into v_old_no from public.money_account_numbers n where n.account_id = m.id;
  end if;
  v_label := coalesce(public._clean_text(p->>'label'), case when v_new then null else m.label end);
  if v_label is null or char_length(v_label) > 80 then raise exception 'money_account_label_required'; end if;
  v_prov := case when p ? 'provider' then public._clean_text(p->>'provider') else m.provider end;
  v_hold := case when p ? 'holder' then public._clean_text(p->>'holder') else m.holder end;
  if char_length(coalesce(v_prov, '')) > 80 or char_length(coalesce(v_hold, '')) > 120 then raise exception 'money_account_invalid'; end if;
  v_mask := m.account_no_masked;
  if p ? 'account_no' then
    v_digits := regexp_replace(coalesce(p->>'account_no', ''), '[^0-9A-Za-z]', '', 'g');
    if v_digits = '' then v_mask := null; v_digits := null;
    elsif char_length(v_digits) < 4 or char_length(v_digits) > 30 then raise exception 'money_account_no_invalid';
    else v_mask := '****' || right(v_digits, 4); end if;
    v_no_changed := v_digits is distinct from v_old_no;
  end if;
  if m.kind = 'cash' and v_digits is not null then raise exception 'money_account_invalid: tiền mặt không có số tài khoản'; end if;
  v_loc := case when p ? 'location_id' then nullif(p->>'location_id', '')::uuid else m.location_id end;
  if v_loc is not null and not exists (select 1 from public.business_locations b where b.id = v_loc) then raise exception 'location_not_found'; end if;
  v_tn := case when p ? 'tax_notified' then coalesce((p->>'tax_notified')::boolean, false) else coalesce(m.tax_notified, false) end;
  v_tna := case when p ? 'tax_notified_at' then nullif(p->>'tax_notified_at', '')::date else m.tax_notified_at end;
  if m.kind = 'cash' then v_tn := false; end if;
  if not v_tn then v_tna := null; end if;
  if v_tna is not null and v_tna > current_date + 1 then raise exception 'money_account_invalid: tax_notified_at in the future'; end if;
  v_act := case when p ? 'active' then coalesce((p->>'active')::boolean, true) else coalesce(m.active, true) end;
  v_def := case when p ? 'is_default' then coalesce((p->>'is_default')::boolean, false) else coalesce(m.is_default, false) end;
  if v_def and not v_act then raise exception 'money_account_is_default'; end if;
  if not v_new and m.active and not v_act and public._money_balance(m.id) <> 0 then raise exception 'money_account_has_balance'; end if;
  if not v_new and m.active and not v_act and m.is_default then raise exception 'money_account_is_default'; end if;

  -- 01/BK-STK: đổi số TK / ngân hàng / chủ TK / địa điểm sau khi đã thông báo → cần khai "thay đổi thông tin"
  v_changed := m.info_changed_at;
  v_closed_rep := coalesce(m.bk_closed_reported, false);
  if not v_new and m.tax_notified and v_tn and (v_no_changed or v_prov is distinct from m.provider or v_hold is distinct from m.holder
                                               or v_loc is distinct from m.location_id) then
    v_changed := now();
  end if;
  if not v_tn then v_changed := null; end if;
  -- mở lại tài khoản đã khai đóng: coi như khai lần đầu
  if not v_new and not m.active and v_act and v_closed_rep then v_closed_rep := false; v_tn := false; v_tna := null; v_changed := null; end if;

  if v_new then
    v_id := gen_random_uuid();
    if v_def then update public.money_accounts set is_default = false, updated_at = now() where gl_account = case when m.kind = 'cash' then '111' else '112' end and is_default; end if;
    insert into public.money_accounts(id, kind, label, provider, account_no_masked, holder, gl_account, tax_notified, tax_notified_at, is_default, active, created_by, location_id)
    values (v_id, m.kind, v_label, v_prov, v_mask, v_hold, case when m.kind = 'cash' then '111' else '112' end, v_tn, v_tna, v_def, v_act, (select auth.uid()), v_loc);
  else
    v_id := m.id;
    if v_def and not m.is_default then update public.money_accounts set is_default = false, updated_at = now() where gl_account = m.gl_account and is_default and id <> m.id; end if;
    update public.money_accounts set label = v_label, provider = v_prov, account_no_masked = v_mask, holder = v_hold, tax_notified = v_tn, tax_notified_at = v_tna,
           is_default = v_def, active = v_act, location_id = v_loc, info_changed_at = v_changed, bk_closed_reported = v_closed_rep, updated_at = now() where id = m.id;
  end if;
  if p ? 'account_no' then
    if v_digits is null then
      delete from public.money_account_numbers where account_id = v_id;
    else
      insert into public.money_account_numbers(account_id, account_no, updated_by, updated_at) values (v_id, v_digits, (select auth.uid()), now())
      on conflict (account_id) do update set account_no = excluded.account_no, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
    end if;
  end if;
  -- audit KHÔNG chứa số tài khoản đầy đủ
  insert into public.accounting_audit(actor, action, detail)
  values ((select auth.uid()), 'upsert_money_account', jsonb_build_object('id', v_id, 'new', v_new, 'kind', m.kind, 'label', v_label, 'active', v_act, 'default', v_def,
          'tax_notified', v_tn, 'account_no_changed', v_no_changed, 'account_no_masked', v_mask));
  return jsonb_build_object('id', v_id, 'kind', m.kind, 'label', v_label, 'account_no_masked', v_mask, 'is_default', v_def, 'active', v_act, 'tax_notified', v_tn);
exception when unique_violation then
  raise exception 'money_account_label_duplicate';
end $$;

-- ---------------------------------------------------------------- 01/BK-STK
-- trạng thái [09]: first = khai lần đầu (chưa thông báo), changed = thay đổi thông tin, closed = đóng (đã thông báo, nay ngừng dùng),
-- unchanged = đã thông báo, không đổi (không cần khai), closed_reported = đã khai đóng
create or replace function public._bk_stk_status(m public.money_accounts)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case
    when m.kind = 'cash' then null
    when not m.active and m.bk_closed_reported then 'closed_reported'
    when not m.active and m.tax_notified then 'closed'
    when not m.active then null
    when not m.tax_notified then 'first'
    when m.info_changed_at is not null then 'changed'
    else 'unchanged' end
$$;
revoke all on function public._bk_stk_status(public.money_accounts) from public, anon, authenticated;

-- p_scope: 'pending' (chỉ dòng cần khai) | 'all' (mọi tài khoản NH/ví, kể cả đã khai)
create or replace function public.bk_stk_data(p_scope text default 'pending')
returns table(account_id uuid, kind text, label text, provider text, account_no text, account_no_masked text, holder text,
              location_id uuid, location_name text, location_code text, status text, active boolean, tax_notified_at date, missing text[])
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_owner text; v_hq uuid;
begin
  if not (select public.is_owner()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if coalesce(p_scope, 'pending') not in ('pending', 'all') then raise exception 'scope_invalid'; end if;
  select coalesce(bp.owner_name, bp.business_name) into v_owner from public.business_profile bp limit 1;
  select b.id into v_hq from public.business_locations b where b.is_hq order by (b.status = 'closed'), b.created_at limit 1;
  return query
  select m.id, m.kind, m.label, m.provider, n.account_no, m.account_no_masked, coalesce(m.holder, v_owner),
         b.id, b.name, b.tax_location_code, public._bk_stk_status(m), m.active, m.tax_notified_at,
         array_remove(array[
           case when n.account_no is null then 'account_no' end,
           case when m.provider is null then 'provider' end,
           case when coalesce(m.holder, v_owner) is null then 'holder' end,
           case when b.id is null then 'location' end], null)
    from public.money_accounts m
    left join public.money_account_numbers n on n.account_id = m.id
    left join public.business_locations b on b.id = coalesce(m.location_id, v_hq)
   where m.kind in ('bank', 'ewallet')
     and public._bk_stk_status(m) is not null
     and (p_scope = 'all' or public._bk_stk_status(m) in ('first', 'changed', 'closed'))
   order by case public._bk_stk_status(m) when 'first' then 1 when 'changed' then 2 when 'closed' then 3 else 4 end, m.label;
end $$;

-- sau khi nộp bảng kê: tài khoản đang dùng → đã thông báo (ngày nộp), xóa cờ thay đổi; tài khoản đã ngừng → đã khai đóng
create or replace function public.mark_bk_stk_filed(p_ids uuid[], p_date date)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int := 0; m public.money_accounts%rowtype;
begin
  if not (select public.is_owner()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_date is null or p_date > current_date + 1 or p_date < date '2020-01-01' then raise exception 'date_invalid'; end if;
  if p_ids is null or cardinality(p_ids) = 0 then raise exception 'bk_stk_empty'; end if;
  for m in select * from public.money_accounts where id = any(p_ids) and kind in ('bank', 'ewallet') for update loop
    if m.active then
      update public.money_accounts set tax_notified = true, tax_notified_at = p_date, info_changed_at = null, updated_at = now() where id = m.id;
    elsif m.tax_notified then
      update public.money_accounts set bk_closed_reported = true, updated_at = now() where id = m.id;
    else
      continue;
    end if;
    v_n := v_n + 1;
  end loop;
  if v_n <> cardinality(p_ids) then raise exception 'bk_stk_invalid: % tài khoản không hợp lệ', cardinality(p_ids) - v_n; end if;
  insert into public.accounting_audit(actor, action, detail)
  values ((select auth.uid()), 'mark_bk_stk_filed', jsonb_build_object('ids', to_jsonb(p_ids), 'date', p_date));
  return v_n;
end $$;

-- ---------------------------------------------------------------- 01/TKN-CNKD
-- chỉ tiêu: nhóm ngành goods → a, service → b, production_service → d, other → g; kênh online/marketplace → [09], store/other → [08]
create or replace function public.tkn_cnkd_data(p_year int, p_half int default null)
returns table(code text, revenue numeric)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_from date; v_to date;
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_year is null or p_year < 2020 or p_year > 2100 then raise exception 'period_invalid'; end if;
  if p_half is not null and p_half not in (1, 2) then raise exception 'period_invalid'; end if;
  v_from := make_date(p_year, case when p_half = 2 then 7 else 1 end, 1);
  v_to := case when p_half = 1 then make_date(p_year, 6, 30) else make_date(p_year, 12, 31) end;
  return query
  with rows as (
    select s.amount, s.tax_group,
           coalesce(si.channel, ri.channel, 'store') as channel
      from public.book_s1a(v_from, v_to, null, 'detail') s
      left join public.sales_invoices si on s.doc_type in ('sale', 'sale_void') and si.id = s.doc_id
      left join public.sales_returns r on s.doc_type in ('return', 'return_void') and r.id = s.doc_id
      left join public.sales_invoices ri on ri.id = r.sale_id
  ), coded as (
    select (case when channel in ('online', 'marketplace') then '09' else '08' end)
           || (case tax_group when 'goods' then 'a' when 'service' then 'b' when 'production_service' then 'd' else 'g' end) as c, amount
      from rows
  ), codes(c, ord) as (
    values ('08', 1), ('08a', 2), ('08b', 3), ('08c', 4), ('08d', 5), ('08e', 6), ('08g', 7),
           ('09', 8), ('09a', 9), ('09b', 10), ('09c', 11), ('09d', 12), ('09e', 13), ('09g', 14), ('10', 15), ('11', 16)
  )
  select k.c,
         coalesce((select sum(x.amount) from coded x
                    where x.c = k.c or (char_length(k.c) = 2 and k.c in ('08', '09') and left(x.c, 2) = k.c) or k.c = '11'), 0)::numeric
    from codes k order by k.ord;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.upsert_money_account(uuid, jsonb)', 'public.bk_stk_data(text)', 'public.mark_bk_stk_filed(uuid[], date)',
                           'public.tkn_cnkd_data(integer, integer)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
