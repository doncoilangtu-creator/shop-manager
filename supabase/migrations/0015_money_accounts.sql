-- 0015 (A4): Tiền theo từng tài khoản — tiền mặt / ngân hàng / ví điện tử
--  * money_accounts: loại (cash|bank|ewallet), tên hiển thị, ngân hàng/nhà cung cấp ví, số tài khoản CHỈ LƯU DẠNG CHE (****1234), chủ tài khoản,
--    TK sổ cái liên kết (111/112), cờ "đã thông báo cơ quan thuế" (+ ngày) cho danh sách tài khoản (mẫu 01/BK-STK), tài khoản mặc định, trạng thái.
--  * journal_lines / payments / sale_payments có money_account_id (nullable, KHÔNG backfill sổ cái bất biến): dòng cũ chưa gắn tài khoản được
--    gom vào "tài khoản mặc định" của TK đó (hoặc dòng "chưa gán tài khoản" nếu chưa có mặc định).
--  * Thu/chi/bán hàng/trả hàng nhận money_account_id; số dư mỗi tài khoản = tổng dòng sổ cái cùng money_account_id (+ dòng cũ chưa gắn).
--  * Chuyển tiền nội bộ (money_transfers), nhập số dư đầu kỳ (Nợ 111/112 · Có 411), sổ tiền theo tài khoản (money_book), đối chiếu 111+112.
-- Forward-only; không UPDATE dữ liệu kế toán cũ (chỉ ADD COLUMN nullable + 1 dòng seed "Tiền mặt"). Hàm có search_path cố định.

-- ---------------------------------------------------------------- bảng tài khoản tiền
create table if not exists public.money_accounts (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null check (kind in ('cash', 'bank', 'ewallet')),
  label            text not null check (char_length(btrim(label)) between 1 and 80),
  provider         text check (provider is null or char_length(provider) <= 80),          -- tên ngân hàng / nhà cung cấp ví
  account_no_masked text check (account_no_masked is null or char_length(account_no_masked) <= 40),   -- chỉ lưu dạng che, vd ****1234
  holder           text check (holder is null or char_length(holder) <= 120),
  gl_account       text not null check (gl_account in ('111', '112')),
  tax_notified     boolean not null default false,
  tax_notified_at  date,
  is_default       boolean not null default false,
  active           boolean not null default true,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((kind = 'cash' and gl_account = '111') or (kind in ('bank', 'ewallet') and gl_account = '112')),
  check (tax_notified or tax_notified_at is null),
  check (kind <> 'cash' or not tax_notified),
  check (not is_default or active)
);
create unique index if not exists uq_money_accounts_default on public.money_accounts(gl_account) where is_default;
create unique index if not exists uq_money_accounts_label on public.money_accounts(lower(btrim(label)));

alter table public.money_accounts enable row level security;
drop policy if exists "staff_read_money_accounts" on public.money_accounts;
create policy "staff_read_money_accounts" on public.money_accounts for select to authenticated using ((select public.is_staff()));
revoke all on public.money_accounts from anon;
revoke insert, update, delete, truncate on public.money_accounts from authenticated;

-- tài khoản mặc định cho tiền mặt: nhận các dòng 111 cũ chưa gắn tài khoản và mọi khoản thu/chi tiền mặt không chọn quỹ
insert into public.money_accounts(kind, label, gl_account, is_default)
select 'cash', 'Tiền mặt', '111', true
where not exists (select 1 from public.money_accounts where gl_account = '111');

-- ---------------------------------------------------------------- cột tham chiếu tài khoản (nullable, không backfill)
alter table public.journal_lines add column if not exists money_account_id uuid references public.money_accounts(id) on delete restrict;
alter table public.payments      add column if not exists money_account_id uuid references public.money_accounts(id) on delete restrict;
alter table public.sale_payments add column if not exists money_account_id uuid references public.money_accounts(id) on delete restrict;
create index if not exists idx_jl_money_account on public.journal_lines(money_account_id) where money_account_id is not null;
create index if not exists idx_jl_money_gl on public.journal_lines(account_code) where account_code in ('111', '112');

-- dòng sổ cái: money_account_id chỉ hợp lệ trên TK 111/112 và phải đúng TK liên kết của tài khoản tiền (+ quy tắc cũ của 0004)
create or replace function public.trg_jl_rules()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.accounts%rowtype; v_status text; m public.money_accounts%rowtype;
begin
  select * into a from public.accounts where code = new.account_code;
  if not a.is_postable or not a.active then raise exception 'account_not_postable: %', new.account_code; end if;
  if new.account_code = '131' and new.customer_id is null then raise exception 'customer_required_for_131'; end if;
  if new.account_code = '331' and new.supplier_id is null then raise exception 'supplier_required_for_331'; end if;
  if new.account_code not in ('131') and new.customer_id is not null then raise exception 'customer_only_on_131'; end if;
  if new.account_code not in ('331') and new.supplier_id is not null then raise exception 'supplier_only_on_331'; end if;
  if new.money_account_id is not null then
    select * into m from public.money_accounts where id = new.money_account_id;
    if not found then raise exception 'money_account_not_found'; end if;
    if m.gl_account <> new.account_code then raise exception 'money_account_mismatch: account % is linked to TK %', new.money_account_id, m.gl_account; end if;
  end if;
  select p.status into v_status from public.journal_entries e join public.fiscal_periods p on p.id = e.period_id where e.id = new.entry_id;
  if v_status <> 'open' then raise exception 'period_closed'; end if;
  return new;
end $$;
revoke execute on function public.trg_jl_rules() from public, anon, authenticated;

-- post_journal: dòng nhận thêm "money_account_id"
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
  values (public.next_doc_no('JE', p_date), p_date, public.ensure_period(p_date), p_memo, p_source_type, p_source_id, p_reverses, (select auth.uid()))
  returning id into v_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    insert into public.journal_lines(entry_id, line_no, account_code, debit, credit, customer_id, supplier_id, memo, money_account_id)
    values (v_id, i, l->>'account', coalesce((l->>'debit')::numeric, 0), coalesce((l->>'credit')::numeric, 0),
            nullif(l->>'customer_id','')::uuid, nullif(l->>'supplier_id','')::uuid, l->>'memo', nullif(l->>'money_account_id','')::uuid);
  end loop;
  return v_id;
end $$;

-- bút toán đảo giữ nguyên tài khoản tiền của dòng gốc
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
                                      'customer_id', customer_id, 'supplier_id', supplier_id, 'memo', memo, 'money_account_id', money_account_id) order by line_no)
    into v_lines from public.journal_lines where entry_id = p_entry_id;
  v_new := public.post_journal(p_date, coalesce(p_memo, 'Bút toán đảo của ' || e.entry_no), v_lines,
                               'reversal', p_entry_id, p_entry_id);
  return v_new;
end $$;

-- ---------------------------------------------------------------- helper nội bộ (không gọi được qua RPC)
-- Tài khoản tiền cho một lần thu/chi: id rõ ràng (kiểm tra tồn tại/đang dùng/đúng TK) hoặc tài khoản mặc định của TK; null nếu chưa có.
create or replace function public._resolve_money_account(p_id uuid, p_gl text)
returns uuid language plpgsql stable security definer set search_path = public, pg_temp as $$
declare m public.money_accounts%rowtype; v uuid;
begin
  if p_id is null then
    select id into v from public.money_accounts where gl_account = p_gl and is_default and active limit 1;
    return v;
  end if;
  select * into m from public.money_accounts where id = p_id;
  if not found then raise exception 'money_account_not_found'; end if;
  if not m.active then raise exception 'money_account_inactive'; end if;
  if m.gl_account <> p_gl then raise exception 'money_account_mismatch: account is TK % but method needs TK %', m.gl_account, p_gl; end if;
  return m.id;
end $$;

-- Chuẩn hóa danh sách thanh toán [{method, amount, note, money_account_id}] -> cùng dạng, đã kiểm tra, method suy ra từ tài khoản nếu thiếu.
create or replace function public._normalize_payments(p_items jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare x jsonb; v_method text; v_amt numeric; v_acc uuid; v_gl text; m public.money_accounts%rowtype; v_out jsonb := '[]'::jsonb;
begin
  if p_items is null then return v_out; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'payments_invalid'; end if;
  for x in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(x) is distinct from 'object' then raise exception 'payments_invalid'; end if;
    v_method := nullif(x->>'method', ''); v_acc := nullif(x->>'money_account_id', '')::uuid; v_amt := (x->>'amount')::numeric;
    if v_method is null and v_acc is not null then
      select * into m from public.money_accounts where id = v_acc;
      if not found then raise exception 'money_account_not_found'; end if;
      v_method := case when m.kind = 'cash' then 'cash' else 'bank' end;
    end if;
    if v_method is null or v_method not in ('cash', 'bank') then raise exception 'method_invalid'; end if;
    if v_amt is null or v_amt <= 0 then raise exception 'amount_invalid'; end if;
    v_gl := case when v_method = 'cash' then '111' else '112' end;
    v_acc := public._resolve_money_account(v_acc, v_gl);
    v_out := v_out || jsonb_build_object('method', v_method, 'amount', v_amt, 'note', x->>'note', 'money_account_id', v_acc);
  end loop;
  return v_out;
end $$;

-- Dòng sổ cái 111/112 từ danh sách thanh toán đã chuẩn hóa: gộp theo (TK, tài khoản tiền); p_side = 'debit' (thu) | 'credit' (chi/hoàn)
create or replace function public._money_lines(p_side text, p_items jsonb, p_memo text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('account', gl, p_side, amt, 'money_account_id', acc, 'memo', p_memo) order by gl, acc nulls first), '[]'::jsonb)
    from (select case when x->>'method' = 'cash' then '111' else '112' end as gl,
                 nullif(x->>'money_account_id', '')::uuid as acc,
                 sum((x->>'amount')::numeric) as amt
            from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x group by 1, 2) g
$$;
revoke all on function public._resolve_money_account(uuid, text), public._normalize_payments(jsonb), public._money_lines(text, jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- thu / chi: nhận tài khoản tiền
drop function if exists public.post_receipt(uuid, numeric, text, date, jsonb, text);
drop function if exists public.post_disbursement(uuid, numeric, text, date, jsonb, text);
drop function if exists public.post_receipt_fifo(uuid, numeric, text, date, text);
drop function if exists public.post_disbursement_fifo(uuid, numeric, text, date, text);

create or replace function public.post_receipt(
  p_customer_id uuid, p_amount numeric, p_method text, p_date date, p_allocations jsonb default '[]'::jsonb, p_memo text default null,
  p_money_account_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := gen_random_uuid(); v_no text; v_entry uuid; v_alloc numeric; v_acc uuid;
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount_invalid'; end if;
  if p_method not in ('cash','bank') then raise exception 'method_invalid'; end if;
  perform public.assert_period_open(p_date);
  perform 1 from public.customers where id = p_customer_id for update;
  if not found then raise exception 'customer_not_found'; end if;
  v_acc := public._resolve_money_account(p_money_account_id, public._method_account(p_method));
  v_no := public.next_doc_no('RC', p_date);
  v_entry := public.post_journal(p_date, 'Thu tiền ' || v_no, jsonb_build_array(
    jsonb_build_object('account', public._method_account(p_method), 'debit', p_amount, 'memo', 'Thu ' || v_no, 'money_account_id', v_acc),
    jsonb_build_object('account', '131', 'credit', p_amount, 'customer_id', p_customer_id, 'memo', 'Thu tiền KH ' || v_no)),
    'receipt', v_id);
  insert into public.payments(id, payment_no, kind, customer_id, amount, method, pay_date, memo, entry_id, created_by, money_account_id)
  values (v_id, v_no, 'receipt', p_customer_id, p_amount, p_method, p_date, p_memo, v_entry, (select auth.uid()), v_acc);
  v_alloc := public._allocate(v_id, 'receipt', p_customer_id, p_allocations);
  return jsonb_build_object('payment_id', v_id, 'payment_no', v_no, 'amount', p_amount, 'allocated', v_alloc, 'unapplied', p_amount - v_alloc, 'entry_id', v_entry, 'money_account_id', v_acc);
end $$;

create or replace function public.post_disbursement(
  p_supplier_id uuid, p_amount numeric, p_method text, p_date date, p_allocations jsonb default '[]'::jsonb, p_memo text default null,
  p_money_account_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := gen_random_uuid(); v_no text; v_entry uuid; v_alloc numeric; v_acc uuid;
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount_invalid'; end if;
  if p_method not in ('cash','bank') then raise exception 'method_invalid'; end if;
  perform public.assert_period_open(p_date);
  perform 1 from public.suppliers where id = p_supplier_id for update;
  if not found then raise exception 'supplier_not_found'; end if;
  v_acc := public._resolve_money_account(p_money_account_id, public._method_account(p_method));
  v_no := public.next_doc_no('PV', p_date);
  v_entry := public.post_journal(p_date, 'Chi tiền ' || v_no, jsonb_build_array(
    jsonb_build_object('account', '331', 'debit', p_amount, 'supplier_id', p_supplier_id, 'memo', 'Trả NCC ' || v_no),
    jsonb_build_object('account', public._method_account(p_method), 'credit', p_amount, 'memo', 'Chi ' || v_no, 'money_account_id', v_acc)),
    'disbursement', v_id);
  insert into public.payments(id, payment_no, kind, supplier_id, amount, method, pay_date, memo, entry_id, created_by, money_account_id)
  values (v_id, v_no, 'disbursement', p_supplier_id, p_amount, p_method, p_date, p_memo, v_entry, (select auth.uid()), v_acc);
  v_alloc := public._allocate(v_id, 'disbursement', p_supplier_id, p_allocations);
  return jsonb_build_object('payment_id', v_id, 'payment_no', v_no, 'amount', p_amount, 'allocated', v_alloc, 'unapplied', p_amount - v_alloc, 'entry_id', v_entry, 'money_account_id', v_acc);
end $$;

create or replace function public.post_receipt_fifo(
  p_customer_id uuid, p_amount numeric, p_method text, p_date date, p_memo text default null, p_money_account_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_left numeric := p_amount; v_take numeric; v_alloc jsonb := '[]'::jsonb;
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform 1 from public.customers where id = p_customer_id for update;
  if not found then raise exception 'customer_not_found'; end if;
  for r in select invoice_id, outstanding from public.v_sales_invoice_open
            where customer_id = p_customer_id and outstanding > 0
            order by invoice_date, invoice_no loop
    exit when v_left <= 0;
    v_take := least(v_left, r.outstanding);
    v_alloc := v_alloc || jsonb_build_array(jsonb_build_object('invoice_id', r.invoice_id, 'amount', v_take));
    v_left := v_left - v_take;
  end loop;
  return public.post_receipt(p_customer_id, p_amount, p_method, p_date, v_alloc, p_memo, p_money_account_id);
end $$;

create or replace function public.post_disbursement_fifo(
  p_supplier_id uuid, p_amount numeric, p_method text, p_date date, p_memo text default null, p_money_account_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_left numeric := p_amount; v_take numeric; v_alloc jsonb := '[]'::jsonb;
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform 1 from public.suppliers where id = p_supplier_id for update;
  if not found then raise exception 'supplier_not_found'; end if;
  for r in select bill_id, outstanding from public.v_purchase_bill_open
            where supplier_id = p_supplier_id and outstanding > 0
            order by bill_date, bill_no loop
    exit when v_left <= 0;
    v_take := least(v_left, r.outstanding);
    v_alloc := v_alloc || jsonb_build_array(jsonb_build_object('bill_id', r.bill_id, 'amount', v_take));
    v_left := v_left - v_take;
  end loop;
  return public.post_disbursement(p_supplier_id, p_amount, p_method, p_date, v_alloc, p_memo, p_money_account_id);
end $$;

-- ---------------------------------------------------------------- bán hàng / trả hàng: thanh toán theo từng tài khoản
-- p_payments: [{"method":"cash"|"bank" (hoặc bỏ trống nếu có money_account_id),"amount":num,"note":text,"money_account_id":uuid}]

create or replace function public.post_sale_hkd(
  p_customer_id uuid, p_date date, p_lines jsonb, p_payments jsonb default '[]'::jsonb,
  p_channel text default 'store', p_location_id uuid default null, p_buyer jsonb default null,
  p_memo text default null, p_due_date date default null, p_einvoice jsonb default null, p_allow_over_limit boolean default false,
  p_quotation_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := gen_random_uuid(); v_no text; c public.customers%rowtype; v_loc uuid; v_main text;
  l jsonb; pay jsonb; i int := 0; v_pid uuid; v_qty int; v_price numeric; v_pct numeric; v_damt numeric; v_net numeric; v_group text;
  v_rate record; v_cur int; v_sku text; v_mid uuid; v_val numeric;
  v_total numeric := 0; v_cogs numeric := 0; v_rows jsonb := '[]'::jsonb;
  v_pays jsonb; v_paid numeric := 0; v_resid numeric; v_amt numeric; v_method text;
  v_due date; v_ar numeric; v_je jsonb; v_entry uuid; v_einv jsonb;
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_date is null then raise exception 'date_required'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'lines_required'; end if;
  if jsonb_typeof(coalesce(p_payments, '[]'::jsonb)) is distinct from 'array' then raise exception 'payments_invalid'; end if;
  if p_channel not in ('store', 'online', 'marketplace', 'other') then raise exception 'channel_invalid'; end if;
  perform public.assert_period_open(p_date);

  if p_customer_id is null then
    select * into c from public.customers where is_walkin;
    if not found then raise exception 'walkin_customer_missing'; end if;
  else
    select * into c from public.customers where id = p_customer_id for update;     -- serialises debt-limit checks per customer
    if not found then raise exception 'customer_not_found'; end if;
  end if;

  if p_location_id is not null then
    perform 1 from public.business_locations where id = p_location_id and status <> 'closed';
    if not found then raise exception 'location_not_found'; end if;
    v_loc := p_location_id;
  else
    select id into v_loc from public.business_locations where is_hq and status <> 'closed' limit 1;
  end if;
  select main_tax_group into v_main from public.business_profile where id;

  perform 1 from public.products where id in (select nullif(x->>'product_id','')::uuid from jsonb_array_elements(p_lines) x) order by id for update;
  v_no := public.next_doc_no('INV', p_date);

  for l in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    v_pid := nullif(l->>'product_id', '')::uuid; v_qty := (l->>'qty')::int; v_price := (l->>'unit_price')::numeric;
    v_pct := coalesce((l->>'discount_pct')::numeric, 0); v_damt := coalesce((l->>'discount_amount')::numeric, 0);
    if l ? 'vat_rate' and coalesce((l->>'vat_rate')::numeric, 0) <> 0 then raise exception 'vat_not_allowed_hkd: line %', i; end if;
    if v_qty is null or v_qty <= 0 or v_price is null or v_price < 0 or v_pct < 0 or v_pct > 100 or v_damt < 0 or (v_pct > 0 and v_damt > 0) then
      raise exception 'line_invalid: line %', i;
    end if;
    if v_pid is null and coalesce(l->>'description', '') = '' then raise exception 'line_invalid: line % needs product or description', i; end if;
    v_net := round(v_qty * v_price * (1 - v_pct / 100), 2) - v_damt;
    if v_net < 0 then raise exception 'line_invalid: line % discount exceeds amount', i; end if;
    v_mid := null; v_val := 0; v_group := null;
    if v_pid is not null then
      select stock_qty, sku, tax_group into v_cur, v_sku, v_group from public.products where id = v_pid;
      if not found then raise exception 'product_not_found: line %', i; end if;
      if v_cur < v_qty then raise exception 'insufficient_stock: % (have %, need %)', v_sku, v_cur, v_qty; end if;
      insert into public.stock_movements(product_id, type, qty, ref_type, ref_id, notes, created_by)
      values (v_pid, 'out', v_qty, 'sales_invoice', v_id, 'Xuất bán ' || v_no, (select auth.uid()))
      returning id, -value_delta into v_mid, v_val;
    end if;
    v_group := coalesce(public._clean_text(l->>'tax_group'), v_group, v_main, 'goods');
    if not exists (select 1 from public.tax_groups where code = v_group) then raise exception 'tax_group_unknown: line %', i; end if;
    select * into v_rate from public._tax_rate_for(v_group, p_date);
    v_total := v_total + v_net; v_cogs := v_cogs + v_val;
    v_rows := v_rows || jsonb_build_object('line_no', i, 'product_id', v_pid, 'description', l->>'description', 'qty', v_qty,
      'unit_price', v_price, 'discount_pct', v_pct, 'line_net', v_net,
      'unit_cost', case when v_qty > 0 then round(v_val / v_qty, 4) else 0 end, 'line_cogs', v_val, 'movement_id', v_mid,
      'tax_group', v_group, 'vat_pct', v_rate.vat_pct, 'pit_pct', v_rate.pit_pct);
  end loop;
  if v_total <= 0 then raise exception 'total_must_be_positive'; end if;

  v_pays := public._normalize_payments(p_payments);         -- method/amount/tài khoản tiền đã kiểm tra; tài khoản trống -> tài khoản mặc định
  select coalesce(sum((x->>'amount')::numeric), 0) into v_paid from jsonb_array_elements(v_pays) x;
  if v_paid > v_total then raise exception 'payment_exceeds_total: % > %', v_paid, v_total; end if;
  v_resid := v_total - v_paid;
  if v_resid > 0 and c.is_walkin then raise exception 'walkin_must_pay_in_full'; end if;
  v_due := coalesce(p_due_date, p_date);
  if v_due < p_date then raise exception 'due_before_invoice_date'; end if;
  if v_resid > 0 and not p_allow_over_limit and c.debt_limit > 0 then
    select coalesce(sum(debit - credit), 0) into v_ar from public.journal_lines where account_code = '131' and customer_id = c.id;
    if v_ar + v_resid > c.debt_limit then
      raise exception 'debt_limit_exceeded' using detail = format('AR %s + debt %s > limit %s', v_ar, v_resid, c.debt_limit);
    end if;
  end if;

  v_je := '[]'::jsonb;
  v_je := v_je || public._money_lines('debit', v_pays, 'Thu tiền ' || v_no);   -- Nợ 111/112 theo TỪNG tài khoản tiền
  if v_resid > 0 then v_je := v_je || jsonb_build_object('account', '131', 'debit', v_resid, 'customer_id', c.id, 'memo', 'Phải thu ' || v_no); end if;
  v_je := v_je || jsonb_build_object('account', '511', 'credit', v_total, 'memo', 'Doanh thu (đã gồm thuế) ' || v_no);
  if v_cogs > 0 then
    v_je := v_je || jsonb_build_object('account', '632', 'debit', v_cogs, 'memo', 'Giá vốn ' || v_no);
    v_je := v_je || jsonb_build_object('account', '156', 'credit', v_cogs, 'memo', 'Xuất kho ' || v_no);
  end if;
  v_entry := public.post_journal(p_date, 'Bán hàng ' || v_no, v_je, 'sales_invoice', v_id);

  insert into public.sales_invoices(id, invoice_no, customer_id, invoice_date, due_date, subtotal, vat_amount, total, cogs_total, memo, entry_id,
                                    created_by, sale_source, channel, location_id, buyer, paid_at_sale, quotation_id)
  values (v_id, v_no, c.id, p_date, v_due, v_total, 0, v_total, v_cogs, p_memo, v_entry,
          (select auth.uid()), 'hkd_sale', p_channel, v_loc, public._sale_buyer(p_buyer), v_paid, p_quotation_id);
  for l in select * from jsonb_array_elements(v_rows) loop
    insert into public.sales_invoice_lines(invoice_id, line_no, product_id, description, qty, unit_price, discount_pct, vat_rate, line_net, vat_amount,
                                           unit_cost, line_cogs, movement_id, tax_group, vat_pct_snapshot, pit_pct_snapshot)
    values (v_id, (l->>'line_no')::int, nullif(l->>'product_id', '')::uuid, l->>'description', (l->>'qty')::int, (l->>'unit_price')::numeric,
            (l->>'discount_pct')::numeric, 0, (l->>'line_net')::numeric, 0, (l->>'unit_cost')::numeric, (l->>'line_cogs')::numeric,
            nullif(l->>'movement_id', '')::uuid, l->>'tax_group', nullif(l->>'vat_pct', '')::numeric, nullif(l->>'pit_pct', '')::numeric);
  end loop;
  for pay in select * from jsonb_array_elements(v_pays) loop
    insert into public.sale_payments(sale_id, direction, method, amount, note, money_account_id)
    values (v_id, 'in', pay->>'method', (pay->>'amount')::numeric, public._clean_text(left(pay->>'note', 200)), nullif(pay->>'money_account_id', '')::uuid);
  end loop;
  if p_einvoice is not null and jsonb_typeof(p_einvoice) = 'object' and p_einvoice <> '{}'::jsonb then
    v_einv := public.record_sale_einvoice(v_id, p_einvoice);
  end if;
  return jsonb_build_object('invoice_id', v_id, 'invoice_no', v_no, 'customer_id', c.id, 'customer_name', c.name, 'is_walkin', c.is_walkin,
    'subtotal', v_total, 'vat', 0, 'total', v_total, 'paid', v_paid, 'debt', v_resid, 'cogs', v_cogs, 'entry_id', v_entry, 'einvoice', v_einv);
end $$;

-- post_sale_return: hoàn tiền theo từng tài khoản (p_refunds[].money_account_id hoặc p_refund_account_id cho hoàn toàn bộ)
drop function if exists public.post_sale_return(uuid, date, jsonb, jsonb, text, text);
create or replace function public.post_sale_return(
  p_sale_id uuid, p_date date, p_lines jsonb, p_refunds jsonb default null, p_reason text default null, p_refund_method text default 'cash',
  p_refund_account_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.sales_invoices%rowtype; l jsonb; rf jsonb; i int := 0; sl public.sales_invoice_lines%rowtype;
  v_qty int; v_amt numeric; v_cost numeric; v_done_qty int; v_done_amt numeric; v_done_cost numeric; v_open numeric;
  v_id uuid := gen_random_uuid(); v_no text; v_total numeric := 0; v_cogs numeric := 0; v_ar numeric := 0; v_ref numeric; v_ref_sum numeric := 0;
  v_pays jsonb; v_mid uuid; v_rows jsonb := '[]'::jsonb; v_je jsonb; v_entry uuid; v_walk boolean; v_method text; v_ramt numeric;
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_date is null then raise exception 'date_required'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'lines_required'; end if;
  select * into s from public.sales_invoices where id = p_sale_id for update;
  if not found then raise exception 'invoice_not_found'; end if;
  if s.voided_at is not null then raise exception 'invoice_voided'; end if;
  if s.vat_amount <> 0 then raise exception 'return_unsupported_vat_invoice'; end if;
  if p_date < s.invoice_date then raise exception 'return_before_sale'; end if;
  perform public.assert_period_open(p_date);
  select is_walkin into v_walk from public.customers where id = s.customer_id;
  perform 1 from public.products where id in (select product_id from public.sales_invoice_lines where invoice_id = s.id and product_id is not null) order by id for update;
  v_no := public.next_doc_no('RT', p_date);

  for l in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    select * into sl from public.sales_invoice_lines where id = nullif(l->>'sale_line_id', '')::uuid and invoice_id = s.id;
    if not found then raise exception 'sale_line_not_found: line %', i; end if;
    v_qty := coalesce((l->>'qty')::int, 0);
    if v_qty < 0 or v_qty > sl.qty then raise exception 'return_qty_invalid: line %', i; end if;
    if v_qty > 0 and sl.product_id is null then raise exception 'return_qty_invalid: line % has no product to restock', i; end if;
    select coalesce(sum(rl.qty), 0), coalesce(sum(rl.amount), 0), coalesce(sum(rl.cost), 0) into v_done_qty, v_done_amt, v_done_cost
      from public.sales_return_lines rl join public.sales_returns r on r.id = rl.return_id and r.voided_at is null where rl.sale_line_id = sl.id;
    if v_done_qty + v_qty > sl.qty then raise exception 'return_exceeds_sold: line % (sold %, already returned %, now %)', i, sl.qty, v_done_qty, v_qty; end if;
    v_open := sl.line_net - v_done_amt;                                              -- số tiền còn có thể trả/giảm của dòng
    if nullif(l->>'amount', '') is not null then
      v_amt := (l->>'amount')::numeric;
    elsif v_qty = 0 then
      raise exception 'return_amount_required: line %', i;
    elsif v_done_qty + v_qty = sl.qty then
      v_amt := v_open;                                                               -- trả nốt: lấy phần còn lại (không lệch làm tròn)
    else
      v_amt := round(sl.line_net * v_qty / sl.qty, 2);
    end if;
    if v_amt is null or v_amt <= 0 then raise exception 'return_amount_invalid: line %', i; end if;
    if v_amt > v_open then raise exception 'return_amount_exceeds_line: line % (% > %)', i, v_amt, v_open; end if;
    v_cost := 0; v_mid := null;
    if v_qty > 0 then
      v_cost := case when v_done_qty + v_qty = sl.qty then sl.line_cogs - v_done_cost else round(sl.line_cogs * v_qty / sl.qty, 2) end;
      insert into public.stock_movements(product_id, type, qty, unit_cost, value_delta, ref_type, ref_id, notes, created_by)
      values (sl.product_id, 'in', v_qty, round(v_cost / v_qty, 4), v_cost, 'sales_return', v_id, 'Nhập lại hàng trả ' || v_no, (select auth.uid()))
      returning id into v_mid;
    end if;
    v_total := v_total + v_amt; v_cogs := v_cogs + v_cost;
    v_rows := v_rows || jsonb_build_object('line_no', i, 'sale_line_id', sl.id, 'qty', v_qty, 'amount', v_amt, 'cost', v_cost, 'movement_id', v_mid);
  end loop;
  if v_total <= 0 then raise exception 'total_must_be_positive'; end if;

  -- phần trừ vào công nợ còn lại của chính hóa đơn này (không áp cho khách lẻ)
  if not v_walk then
    select greatest(outstanding, 0) into v_open from public.v_sales_invoice_open where invoice_id = s.id;
    v_ar := least(v_total, coalesce(v_open, 0));
  end if;
  v_ref := v_total - v_ar;
  if p_refund_method not in ('cash', 'bank') then raise exception 'method_invalid'; end if;
  if p_refunds is null then
    if v_ref > 0 then p_refunds := jsonb_build_array(jsonb_build_object('method', p_refund_method, 'amount', v_ref, 'money_account_id', p_refund_account_id)); else p_refunds := '[]'::jsonb; end if;
  end if;
  if jsonb_typeof(p_refunds) is distinct from 'array' then raise exception 'refunds_invalid'; end if;
  v_pays := public._normalize_payments(p_refunds);
  select coalesce(sum((x->>'amount')::numeric), 0) into v_ref_sum from jsonb_array_elements(v_pays) x;
  if v_ref_sum <> v_ref then raise exception 'refund_mismatch: refunds % <> % (return % - applied to debt %)', v_ref_sum, v_ref, v_total, v_ar; end if;

  v_je := jsonb_build_array(jsonb_build_object('account', '521', 'debit', v_total, 'memo', 'Hàng bán trả lại/giảm giá ' || v_no));
  if v_cogs > 0 then
    v_je := v_je || jsonb_build_object('account', '156', 'debit', v_cogs, 'memo', 'Nhập lại kho ' || v_no);
    v_je := v_je || jsonb_build_object('account', '632', 'credit', v_cogs, 'memo', 'Hoàn giá vốn ' || v_no);
  end if;
  if v_ar > 0 then v_je := v_je || jsonb_build_object('account', '131', 'credit', v_ar, 'customer_id', s.customer_id, 'memo', 'Trừ công nợ ' || v_no); end if;
  v_je := v_je || public._money_lines('credit', v_pays, 'Hoàn tiền ' || v_no);   -- Có 111/112 theo TỪNG tài khoản tiền
  v_entry := public.post_journal(p_date, 'Trả hàng/giảm giá ' || v_no || ' (' || s.invoice_no || ')', v_je, 'sales_return', v_id);

  insert into public.sales_returns(id, return_no, sale_id, return_date, total, cogs_total, ar_applied, refunded, reason, entry_id, created_by)
  values (v_id, v_no, s.id, p_date, v_total, v_cogs, v_ar, v_ref, public._clean_text(left(p_reason, 500)), v_entry, (select auth.uid()));
  for l in select * from jsonb_array_elements(v_rows) loop
    insert into public.sales_return_lines(return_id, line_no, sale_line_id, qty, amount, cost, movement_id)
    values (v_id, (l->>'line_no')::int, (l->>'sale_line_id')::uuid, (l->>'qty')::int, (l->>'amount')::numeric, (l->>'cost')::numeric, nullif(l->>'movement_id', '')::uuid);
  end loop;
  for rf in select * from jsonb_array_elements(v_pays) loop
    insert into public.sale_payments(return_id, direction, method, amount, note, money_account_id)
    values (v_id, 'out', rf->>'method', (rf->>'amount')::numeric, public._clean_text(left(rf->>'note', 200)), nullif(rf->>'money_account_id', '')::uuid);
  end loop;
  return jsonb_build_object('return_id', v_id, 'return_no', v_no, 'sale_id', s.id, 'invoice_no', s.invoice_no, 'total', v_total,
    'cogs', v_cogs, 'applied_to_debt', v_ar, 'refunded', v_ref, 'entry_id', v_entry);
end $$;

-- ---------------------------------------------------------------- quản lý tài khoản tiền (chỉ owner)
create or replace function public._money_balance(p_id uuid, p_as_of date default null)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(l.debit - l.credit), 0)
    from public.money_accounts m
    join public.journal_lines l on l.account_code = m.gl_account
     and (l.money_account_id = m.id or (m.is_default and l.money_account_id is null))
    join public.journal_entries e on e.id = l.entry_id and (p_as_of is null or e.entry_date <= p_as_of)
   where m.id = p_id
$$;
revoke all on function public._money_balance(uuid, date) from public, anon, authenticated;

-- p: {"kind","label","provider","account_no","holder","tax_notified","tax_notified_at","active","is_default"}; số tài khoản chỉ lưu dạng che (4 số cuối)
create or replace function public.upsert_money_account(p_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare m public.money_accounts%rowtype; v_new boolean := p_id is null; v_kind text; v_label text; v_prov text; v_hold text; v_mask text; v_digits text;
        v_tn boolean; v_tna date; v_act boolean; v_def boolean; v_id uuid;
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
  end if;
  v_label := coalesce(public._clean_text(p->>'label'), case when v_new then null else m.label end);
  if v_label is null or char_length(v_label) > 80 then raise exception 'money_account_label_required'; end if;
  v_prov := case when p ? 'provider' then public._clean_text(p->>'provider') else m.provider end;
  v_hold := case when p ? 'holder' then public._clean_text(p->>'holder') else m.holder end;
  if char_length(coalesce(v_prov, '')) > 80 or char_length(coalesce(v_hold, '')) > 120 then raise exception 'money_account_invalid'; end if;
  v_mask := m.account_no_masked;
  if p ? 'account_no' then
    v_digits := regexp_replace(coalesce(p->>'account_no', ''), '[^0-9A-Za-z]', '', 'g');
    if v_digits = '' then v_mask := null;
    elsif char_length(v_digits) < 4 or char_length(v_digits) > 30 then raise exception 'money_account_no_invalid';
    else v_mask := '****' || right(v_digits, 4); end if;
  end if;
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

  if v_new then
    v_id := gen_random_uuid();
    if v_def then update public.money_accounts set is_default = false, updated_at = now() where gl_account = case when m.kind = 'cash' then '111' else '112' end and is_default; end if;
    insert into public.money_accounts(id, kind, label, provider, account_no_masked, holder, gl_account, tax_notified, tax_notified_at, is_default, active, created_by)
    values (v_id, m.kind, v_label, v_prov, v_mask, v_hold, case when m.kind = 'cash' then '111' else '112' end, v_tn, v_tna, v_def, v_act, (select auth.uid()));
  else
    v_id := m.id;
    if v_def and not m.is_default then update public.money_accounts set is_default = false, updated_at = now() where gl_account = m.gl_account and is_default and id <> m.id; end if;
    update public.money_accounts set label = v_label, provider = v_prov, account_no_masked = v_mask, holder = v_hold, tax_notified = v_tn, tax_notified_at = v_tna,
           is_default = v_def, active = v_act, updated_at = now() where id = m.id;
  end if;
  insert into public.accounting_audit(actor, action, detail)
  values ((select auth.uid()), 'upsert_money_account', jsonb_build_object('id', v_id, 'new', v_new, 'kind', m.kind, 'label', v_label, 'active', v_act, 'default', v_def, 'tax_notified', v_tn));
  return jsonb_build_object('id', v_id, 'kind', m.kind, 'label', v_label, 'account_no_masked', v_mask, 'is_default', v_def, 'active', v_act, 'tax_notified', v_tn);
exception when unique_violation then
  raise exception 'money_account_label_duplicate';
end $$;

-- số dư đầu kỳ của một tài khoản tiền: Nợ 111/112 (gắn tài khoản) · Có 411
create or replace function public.post_money_opening(p_account_id uuid, p_amount numeric, p_date date, p_memo text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare m public.money_accounts%rowtype; v_entry uuid;
begin
  if not (select public.is_owner()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount_invalid'; end if;
  if p_date is null then raise exception 'date_required'; end if;
  perform public.assert_period_open(p_date);
  select * into m from public.money_accounts where id = p_account_id for update;
  if not found then raise exception 'money_account_not_found'; end if;
  if not m.active then raise exception 'money_account_inactive'; end if;
  v_entry := public.post_journal(p_date, 'Số dư đầu kỳ ' || m.label, jsonb_build_array(
    jsonb_build_object('account', m.gl_account, 'debit', p_amount, 'money_account_id', m.id, 'memo', coalesce(public._clean_text(left(p_memo, 200)), 'Số dư đầu kỳ ' || m.label)),
    jsonb_build_object('account', '411', 'credit', p_amount, 'memo', 'Vốn chủ sở hữu — số dư đầu kỳ ' || m.label)), 'money_opening', m.id);
  insert into public.accounting_audit(actor, action, detail)
  values ((select auth.uid()), 'post_money_opening', jsonb_build_object('account', m.id, 'amount', p_amount, 'date', p_date, 'entry_id', v_entry));
  return jsonb_build_object('account_id', m.id, 'entry_id', v_entry, 'amount', p_amount);
end $$;

-- ---------------------------------------------------------------- chuyển tiền nội bộ (nộp/rút tiền, chuyển giữa ngân hàng/ví)
create table if not exists public.money_transfers (
  id            uuid primary key default gen_random_uuid(),
  transfer_no   text not null unique,
  from_account  uuid not null references public.money_accounts(id) on delete restrict,
  to_account    uuid not null references public.money_accounts(id) on delete restrict,
  amount        numeric(16,2) not null check (amount > 0),
  transfer_date date not null,
  memo          text,
  entry_id      uuid not null references public.journal_entries(id) on delete restrict,
  voided_at     timestamptz,
  void_entry_id uuid references public.journal_entries(id) on delete restrict,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  check (from_account <> to_account)
);
create index if not exists idx_money_transfers_from on public.money_transfers(from_account);
create index if not exists idx_money_transfers_to on public.money_transfers(to_account);

create or replace function public.trg_money_transfer_immutable()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and old.voided_at is null and new.voided_at is not null and new.void_entry_id is not null
     and (to_jsonb(new) - 'voided_at' - 'void_entry_id') = (to_jsonb(old) - 'voided_at' - 'void_entry_id') then
    return new;                                   -- thay đổi duy nhất được phép: dấu hủy do reverse_money_transfer() đặt
  end if;
  raise exception 'money transfers are immutable: % (use reverse_money_transfer)', tg_op using errcode = '42501';
end $$;
drop trigger if exists trg_money_transfers_immutable on public.money_transfers;
create trigger trg_money_transfers_immutable before update or delete on public.money_transfers
  for each row execute function public.trg_money_transfer_immutable();
revoke execute on function public.trg_money_transfer_immutable() from public, anon, authenticated;

alter table public.money_transfers enable row level security;
drop policy if exists "staff_read_money_transfers" on public.money_transfers;
create policy "staff_read_money_transfers" on public.money_transfers for select to authenticated using ((select public.is_staff()));
revoke all on public.money_transfers from anon;
revoke insert, update, delete, truncate on public.money_transfers from authenticated;

create or replace function public.post_money_transfer(p_from uuid, p_to uuid, p_amount numeric, p_date date, p_memo text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.money_accounts%rowtype; b public.money_accounts%rowtype; v_id uuid := gen_random_uuid(); v_no text; v_entry uuid;
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount_invalid'; end if;
  if p_date is null then raise exception 'date_required'; end if;
  if p_from is null or p_to is null or p_from = p_to then raise exception 'transfer_same_account'; end if;
  perform public.assert_period_open(p_date);
  perform 1 from public.money_accounts where id in (p_from, p_to) order by id for update;
  select * into a from public.money_accounts where id = p_from;
  select * into b from public.money_accounts where id = p_to;
  if a.id is null or b.id is null then raise exception 'money_account_not_found'; end if;
  if not a.active or not b.active then raise exception 'money_account_inactive'; end if;
  v_no := public.next_doc_no('MT', p_date);
  v_entry := public.post_journal(p_date, 'Chuyển tiền nội bộ ' || v_no || ': ' || a.label || ' → ' || b.label, jsonb_build_array(
    jsonb_build_object('account', b.gl_account, 'debit', p_amount, 'money_account_id', b.id, 'memo', 'Nhận từ ' || a.label),
    jsonb_build_object('account', a.gl_account, 'credit', p_amount, 'money_account_id', a.id, 'memo', 'Chuyển sang ' || b.label)),
    'money_transfer', v_id);
  insert into public.money_transfers(id, transfer_no, from_account, to_account, amount, transfer_date, memo, entry_id, created_by)
  values (v_id, v_no, a.id, b.id, p_amount, p_date, public._clean_text(left(p_memo, 300)), v_entry, (select auth.uid()));
  return jsonb_build_object('transfer_id', v_id, 'transfer_no', v_no, 'amount', p_amount, 'entry_id', v_entry);
end $$;

create or replace function public.reverse_money_transfer(p_transfer_id uuid, p_date date default current_date, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.money_transfers%rowtype; v_rev uuid;
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into t from public.money_transfers where id = p_transfer_id for update;
  if not found then raise exception 'transfer_not_found'; end if;
  if t.voided_at is not null then raise exception 'already_voided'; end if;
  perform public.assert_period_open(p_date);
  v_rev := public.reverse_journal(t.entry_id, p_date, 'Hủy chuyển tiền ' || t.transfer_no || coalesce(' — ' || p_reason, ''));
  update public.money_transfers set voided_at = now(), void_entry_id = v_rev where id = t.id;
  return jsonb_build_object('transfer_id', t.id, 'reversal_entry_id', v_rev);
end $$;

-- ---------------------------------------------------------------- số dư & sổ tiền theo tài khoản
-- Mỗi dòng 111/112 thuộc đúng một hàng: tài khoản được gắn; dòng cũ chưa gắn -> tài khoản mặc định của TK đó, nếu chưa có thì hàng "chưa gán" (account_id null).
create or replace function public.money_balances(p_as_of date default null)
returns table(account_id uuid, kind text, label text, provider text, account_no_masked text, gl_account text, tax_notified boolean, tax_notified_at date,
              is_default boolean, active boolean, balance numeric, unassigned boolean)
language sql stable security invoker set search_path = public, pg_temp as $$
  select m.id, m.kind, m.label, m.provider, m.account_no_masked, m.gl_account, m.tax_notified, m.tax_notified_at, m.is_default, m.active,
         coalesce((select sum(l.debit - l.credit) from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
                    where l.account_code = m.gl_account and (l.money_account_id = m.id or (m.is_default and l.money_account_id is null))
                      and (p_as_of is null or e.entry_date <= p_as_of)), 0), false
    from public.money_accounts m
  union all
  select null::uuid, case g.code when '111' then 'cash' else 'bank' end, 'Chưa gán tài khoản (TK ' || g.code || ')', null, null, g.code, false, null, false, true,
         coalesce((select sum(l.debit - l.credit) from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
                    where l.account_code = g.code and l.money_account_id is null and (p_as_of is null or e.entry_date <= p_as_of)), 0), true
    from (values ('111'), ('112')) g(code)
   where not exists (select 1 from public.money_accounts d where d.gl_account = g.code and d.is_default)
$$;

-- Sổ tiền của một tài khoản (hoặc "chưa gán" khi p_account_id null + p_gl): từng dòng, số dư lũy kế sau dòng đó
create or replace function public.money_book(p_account_id uuid, p_from date default null, p_to date default null, p_gl text default null)
returns table(entry_date date, entry_no text, memo text, source_type text, debit numeric, credit numeric, running numeric)
language sql stable security invoker set search_path = public, pg_temp as $$
  with acc as (select * from public.money_accounts where id = p_account_id),
  src as (
    select e.entry_date, e.entry_no, coalesce(l.memo, e.memo) as memo, e.source_type, l.debit, l.credit, e.created_at, l.line_no
      from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
     where (p_account_id is not null and exists (select 1 from acc a where a.gl_account = l.account_code and (l.money_account_id = a.id or (a.is_default and l.money_account_id is null))))
        or (p_account_id is null and l.account_code = p_gl and l.money_account_id is null
            and not exists (select 1 from public.money_accounts d where d.gl_account = p_gl and d.is_default))
  ), run as (
    select s.*, sum(s.debit - s.credit) over (order by s.entry_date, s.created_at, s.entry_no, s.line_no) as running from src s
  )
  select r.entry_date, r.entry_no, r.memo, r.source_type, r.debit, r.credit, r.running from run r
   where (p_from is null or r.entry_date >= p_from) and (p_to is null or r.entry_date <= p_to)
   order by r.entry_date, r.created_at, r.entry_no, r.line_no
$$;

-- Đối chiếu: tổng các tài khoản tiền (kể cả hàng "chưa gán") = TK 111 + 112 của sổ cái
create or replace function public.accounting_reconciliation()
returns table(check_name text, gl_value numeric, subledger_value numeric, diff numeric)
language sql stable security invoker set search_path = public, pg_temp as $$
  select 'AR 131 vs open invoices - unapplied receipts', gl, sub, gl - sub from (
    select public.account_balance('131') as gl,
           coalesce((select sum(outstanding) from public.v_sales_invoice_open), 0)
         - coalesce((select sum(unapplied) from public.v_payment_unapplied where kind = 'receipt'), 0) as sub) x
  union all
  select 'AP 331 vs open bills - unapplied disbursements', gl, sub, gl - sub from (
    select public.account_balance('331') as gl,
           coalesce((select sum(outstanding) from public.v_purchase_bill_open), 0)
         - coalesce((select sum(unapplied) from public.v_payment_unapplied where kind = 'disbursement'), 0) as sub) x
  union all
  select 'Inventory 156 vs sum(stock_value)', public.account_balance('156'), coalesce((select sum(stock_value) from public.products), 0),
         public.account_balance('156') - coalesce((select sum(stock_value) from public.products), 0)
  union all
  select 'Trial balance debit vs credit', coalesce(sum(debit), 0), coalesce(sum(credit), 0), coalesce(sum(debit), 0) - coalesce(sum(credit), 0)
    from public.trial_balance()
  union all
  select 'Cash/bank 111+112 vs sum(money accounts)', gl, sub, gl - sub from (
    select public.account_balance('111') + public.account_balance('112') as gl,
           coalesce((select sum(balance) from public.money_balances()), 0) as sub) y
$$;

-- ---------------------------------------------------------------- grants
do $$
declare f text;
begin
  foreach f in array array[
    'public.post_receipt(uuid, numeric, text, date, jsonb, text, uuid)', 'public.post_disbursement(uuid, numeric, text, date, jsonb, text, uuid)',
    'public.post_receipt_fifo(uuid, numeric, text, date, text, uuid)', 'public.post_disbursement_fifo(uuid, numeric, text, date, text, uuid)',
    'public.post_sale_return(uuid, date, jsonb, jsonb, text, text, uuid)', 'public.upsert_money_account(uuid, jsonb)',
    'public.post_money_opening(uuid, numeric, date, text)', 'public.post_money_transfer(uuid, uuid, numeric, date, text)',
    'public.reverse_money_transfer(uuid, date, text)', 'public.money_balances(date)', 'public.money_book(uuid, date, date, text)',
    'public.accounting_reconciliation()', 'public.post_sale_hkd(uuid, date, jsonb, jsonb, text, uuid, jsonb, text, date, jsonb, boolean, uuid)',
    'public.post_journal(date, text, jsonb, text, uuid, uuid)', 'public.reverse_journal(uuid, date, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
