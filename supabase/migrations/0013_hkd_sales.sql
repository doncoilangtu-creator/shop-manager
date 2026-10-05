-- ============================================================================
-- 0013_hkd_sales.sql — A2: bán hàng đúng chế độ hộ kinh doanh
--
-- * post_sale_hkd(): MỘT giao dịch nguyên tử — xuất kho, thu tiền nhiều phương thức, công nợ (chỉ khách có tên),
--   MỘT bút toán cân: Nợ 111/112 · Nợ 131 (phần còn nợ) · Có 511 = tổng tiền (đã gồm thuế) · Nợ 632 / Có 156.
--   KHÔNG có 3331: giá đã gồm VAT, hóa đơn bán hàng không tách VAT (ND254 Đ8.2). Khách lẻ ("Khách lẻ", is_walkin)
--   phải thanh toán đủ. Mỗi dòng có nhóm ngành thuế + tỷ lệ GTGT/TNCN SNAPSHOT tại ngày bán.
-- * post_sale_return() / reverse_sales_return(): hàng bán trả lại / giảm giá hàng bán (TK 521), nhập lại kho theo giá vốn gốc,
--   hoàn tiền nhiều phương thức hoặc trừ vào công nợ của chính hóa đơn.
-- * einvoices + record_sale_einvoice()/cancel_sale_einvoice(): LƯU số/ký hiệu/mã tra cứu của hóa đơn điện tử do nhà cung cấp
--   bên ngoài phát hành (không tích hợp API). Số hóa đơn nội bộ (INV-...) tách khỏi số hóa đơn điện tử.
-- * doanh thu (v_revenue_events, revenue_by_tax_group) trừ hàng bán trả lại; báo cáo dashboard/P&L/top = 511 − 521.
-- Chứng từ bất biến; sửa sai = reverse_*. Idempotent. Cần 0003–0012.
-- ============================================================================

-- ---------------------------------------------------------------- khách lẻ
alter table public.customers add column if not exists is_walkin boolean not null default false;
create unique index if not exists uq_customers_walkin on public.customers((true)) where is_walkin;
insert into public.customers(type, name, notes, is_walkin)
select 'retail', 'Khách lẻ', 'Khách hệ thống cho bán lẻ không lấy thông tin. Không có công nợ — phải thanh toán đủ khi bán.', true
 where not exists (select 1 from public.customers where is_walkin);

create or replace function public.trg_customers_walkin_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    if old.is_walkin then raise exception 'walkin_customer_protected' using errcode = '42501'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.is_walkin and (new.is_walkin is distinct from old.is_walkin or new.name is distinct from old.name) then
    raise exception 'walkin_customer_protected' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_customers_walkin_guard on public.customers;
create trigger trg_customers_walkin_guard before update or delete on public.customers
  for each row execute function public.trg_customers_walkin_guard();
revoke execute on function public.trg_customers_walkin_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------- cột mới (chỉ thêm, không UPDATE sổ bất biến)
alter table public.products add column if not exists tax_group text not null default 'goods' references public.tax_groups(code) on delete restrict;

alter table public.sales_invoices
  add column if not exists sale_source  text not null default 'invoice' check (sale_source in ('invoice', 'hkd_sale')),
  add column if not exists channel      text not null default 'store' check (channel in ('store', 'online', 'marketplace', 'other')),
  add column if not exists location_id  uuid references public.business_locations(id) on delete restrict,
  add column if not exists buyer        jsonb,
  add column if not exists paid_at_sale numeric(16,2) not null default 0 check (paid_at_sale >= 0);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sales_invoices_paid_at_sale_le_total') then
    alter table public.sales_invoices add constraint sales_invoices_paid_at_sale_le_total check (paid_at_sale <= total);
  end if;
end $$;

alter table public.sales_invoice_lines
  add column if not exists tax_group        text not null default 'goods' references public.tax_groups(code) on delete restrict,
  add column if not exists vat_pct_snapshot numeric(5,2),
  add column if not exists pit_pct_snapshot numeric(5,2);

-- ---------------------------------------------------------------- hàng bán trả lại / giảm giá
create table if not exists public.sales_returns (
  id            uuid primary key default gen_random_uuid(),
  return_no     text not null unique,
  sale_id       uuid not null references public.sales_invoices(id) on delete restrict,
  return_date   date not null,
  total         numeric(16,2) not null check (total > 0),
  cogs_total    numeric(16,2) not null default 0 check (cogs_total >= 0),
  ar_applied    numeric(16,2) not null default 0 check (ar_applied >= 0),
  refunded      numeric(16,2) not null default 0 check (refunded >= 0),
  reason        text,
  entry_id      uuid not null references public.journal_entries(id) on delete restrict,
  voided_at     timestamptz,
  void_entry_id uuid references public.journal_entries(id) on delete restrict,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  check (total = ar_applied + refunded)
);
create index if not exists idx_sales_returns_sale on public.sales_returns(sale_id);

create table if not exists public.sales_return_lines (
  id           uuid primary key default gen_random_uuid(),
  return_id    uuid not null references public.sales_returns(id) on delete restrict,
  line_no      integer not null,
  sale_line_id uuid not null references public.sales_invoice_lines(id) on delete restrict,
  qty          integer not null check (qty >= 0),               -- 0 = giảm giá hàng bán (không nhập lại kho)
  amount       numeric(16,2) not null check (amount > 0),
  cost         numeric(16,2) not null default 0 check (cost >= 0),
  movement_id  uuid references public.stock_movements(id) on delete restrict,
  unique (return_id, line_no)
);
create index if not exists idx_srl_sale_line on public.sales_return_lines(sale_line_id);

-- tiền thu khi bán (direction 'in', sale_id) / tiền hoàn khi trả hàng (direction 'out', return_id)
create table if not exists public.sale_payments (
  id         uuid primary key default gen_random_uuid(),
  sale_id    uuid references public.sales_invoices(id) on delete restrict,
  return_id  uuid references public.sales_returns(id) on delete restrict,
  direction  text not null check (direction in ('in', 'out')),
  method     text not null check (method in ('cash', 'bank')),
  amount     numeric(16,2) not null check (amount > 0),
  note       text,
  created_at timestamptz not null default now(),
  check ((sale_id is not null and return_id is null and direction = 'in') or (return_id is not null and sale_id is null and direction = 'out'))
);
create index if not exists idx_sale_payments_sale on public.sale_payments(sale_id) where sale_id is not null;
create index if not exists idx_sale_payments_return on public.sale_payments(return_id) where return_id is not null;

-- hóa đơn điện tử do nhà cung cấp bên ngoài phát hành: chỉ LƯU thông tin tra cứu
create table if not exists public.einvoices (
  id           uuid primary key default gen_random_uuid(),
  sale_id      uuid not null references public.sales_invoices(id) on delete restrict,
  return_id    uuid references public.sales_returns(id) on delete restrict,
  kind         text not null default 'original' check (kind in ('original', 'replace', 'adjust')),
  status       text not null default 'issued' check (status in ('issued', 'cancelled', 'replaced')),
  provider     text,
  symbol       text check (symbol is null or symbol ~ '^[A-Za-z0-9]{1,15}$'),
  number       text not null check (number ~ '^[A-Za-z0-9/_-]{1,30}$'),
  lookup_code  text check (lookup_code is null or char_length(lookup_code) <= 100),
  lookup_url   text check (lookup_url is null or (lookup_url ~* '^https?://' and char_length(lookup_url) <= 500)),
  issued_on    date not null default current_date,
  note         text,
  cancelled_at timestamptz,
  cancel_reason text,
  created_by   uuid,
  created_at   timestamptz not null default now()
);
create unique index if not exists uq_einvoices_active_main on public.einvoices(sale_id) where kind in ('original', 'replace') and status = 'issued';
create unique index if not exists uq_einvoices_number on public.einvoices((coalesce(symbol, '')), number) where status = 'issued';
create index if not exists idx_einvoices_sale on public.einvoices(sale_id);

-- ---------------------------------------------------------------- bất biến
create or replace function public.trg_doc_immutable()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and tg_table_name in ('sales_invoices','purchase_bills','payments','sales_returns') then
    if old.voided_at is null and new.voided_at is not null and new.void_entry_id is not null
       and (to_jsonb(new) - 'voided_at' - 'void_entry_id') = (to_jsonb(old) - 'voided_at' - 'void_entry_id') then
      return new;                                 -- the ONLY allowed change: void marker set by reverse_*()
    end if;
  end if;
  raise exception 'accounting documents are immutable: % on % (use the reverse_* function)', tg_op, tg_table_name using errcode = '42501';
end $$;
do $$
declare t text;
begin
  foreach t in array array['sales_returns','sales_return_lines','sale_payments'] loop
    execute format('drop trigger if exists trg_%I_immutable on public.%I', t, t);
    execute format('create trigger trg_%I_immutable before update or delete on public.%I for each row execute function public.trg_doc_immutable()', t, t);
  end loop;
end $$;

-- khách lẻ không được để công nợ (mọi đường tạo hóa đơn, kể cả hóa đơn từ báo giá)
create or replace function public.trg_sales_invoices_walkin_paid()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.customers where id = new.customer_id and is_walkin) and new.total - new.paid_at_sale > 0 then
    raise exception 'walkin_must_pay_in_full' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists trg_sales_invoices_walkin_paid on public.sales_invoices;
create trigger trg_sales_invoices_walkin_paid before insert on public.sales_invoices
  for each row execute function public.trg_sales_invoices_walkin_paid();
revoke execute on function public.trg_sales_invoices_walkin_paid() from public, anon, authenticated;

-- ---------------------------------------------------------------- công nợ theo hóa đơn: trừ phần thu lúc bán và phần trả hàng trừ nợ
create or replace view public.v_sales_invoice_open with (security_invoker = true) as
  select i.id as invoice_id, i.invoice_no, i.customer_id, i.invoice_date, i.due_date, i.total,
         coalesce(a.allocated, 0) as allocated,
         i.total - i.paid_at_sale - coalesce(a.allocated, 0) - coalesce(r.ar_applied, 0) as outstanding,
         greatest(current_date - i.due_date, 0) as days_overdue
    from public.sales_invoices i
    left join lateral (select sum(pa.amount) as allocated from public.payment_allocations pa
                         join public.payments p on p.id = pa.payment_id and p.voided_at is null
                        where pa.sales_invoice_id = i.id) a on true
    left join lateral (select sum(sr.ar_applied) as ar_applied from public.sales_returns sr
                        where sr.sale_id = i.id and sr.voided_at is null) r on true
   where i.voided_at is null;

-- doanh thu tính thuế: hóa đơn bán (tổng tiền gồm thuế) trừ hàng bán trả lại / giảm giá
create or replace view public.v_revenue_events with (security_invoker = true) as
  select i.invoice_date as event_date, 'sale'::text as kind, i.id as doc_id, i.total::numeric(16,2) as amount
    from public.sales_invoices i
   where i.voided_at is null
  union all
  select r.return_date, 'return'::text, r.id, (-r.total)::numeric(16,2)
    from public.sales_returns r
   where r.voided_at is null;

create or replace view public.v_sales_missing_einvoice with (security_invoker = true) as
  select i.id as sale_id, i.invoice_no, i.invoice_date, i.customer_id, c.name as customer_name, i.total
    from public.sales_invoices i
    join public.customers c on c.id = i.customer_id
   where i.voided_at is null
     and not exists (select 1 from public.einvoices e where e.sale_id = i.id and e.kind in ('original', 'replace') and e.status = 'issued');

-- ---------------------------------------------------------------- helpers
create or replace function public._sale_buyer(p jsonb)
returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select nullif(jsonb_strip_nulls(jsonb_build_object(
    'name', public._clean_text(left(p->>'name', 255)), 'tax_code', public._clean_text(left(p->>'tax_code', 20)),
    'address', public._clean_text(left(p->>'address', 500)), 'email', public._clean_text(left(p->>'email', 255)))), '{}'::jsonb)
$$;

create or replace function public._tax_rate_for(p_group text, p_on date)
returns table(vat_pct numeric, pit_pct numeric) language sql stable set search_path = public, pg_temp as $$
  select r.vat_pct, r.pit_pct from public.tax_rates r where r.tax_group = p_group and r.effective_from <= p_on order by r.effective_from desc limit 1
$$;

-- ---------------------------------------------------------------- BÁN HÀNG
-- p_lines   : [{"product_id":uuid|null,"description":text,"qty":int,"unit_price":num (ĐÃ GỒM THUẾ),"discount_pct":num,"discount_amount":num,"tax_group":text}]
-- p_payments: [{"method":"cash"|"bank","amount":num,"note":text}]   Σ <= tổng; phần dư = công nợ (chỉ khách có tên)
-- p_einvoice: {"symbol","number","lookup_code","lookup_url","provider","issued_on"} (tùy chọn, hóa đơn điện tử đã phát hành ở hệ thống ngoài)
create or replace function public.post_sale_hkd(
  p_customer_id uuid, p_date date, p_lines jsonb, p_payments jsonb default '[]'::jsonb,
  p_channel text default 'store', p_location_id uuid default null, p_buyer jsonb default null,
  p_memo text default null, p_due_date date default null, p_einvoice jsonb default null, p_allow_over_limit boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := gen_random_uuid(); v_no text; c public.customers%rowtype; v_loc uuid; v_main text;
  l jsonb; pay jsonb; i int := 0; v_pid uuid; v_qty int; v_price numeric; v_pct numeric; v_damt numeric; v_net numeric; v_group text;
  v_rate record; v_cur int; v_sku text; v_mid uuid; v_val numeric;
  v_total numeric := 0; v_cogs numeric := 0; v_rows jsonb := '[]'::jsonb;
  v_cash numeric := 0; v_bank numeric := 0; v_paid numeric := 0; v_resid numeric; v_amt numeric; v_method text;
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

  for pay in select * from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    v_method := pay->>'method'; v_amt := (pay->>'amount')::numeric;
    if v_method not in ('cash', 'bank') then raise exception 'method_invalid'; end if;
    if v_amt is null or v_amt <= 0 then raise exception 'amount_invalid'; end if;
    if v_method = 'cash' then v_cash := v_cash + v_amt; else v_bank := v_bank + v_amt; end if;
    v_paid := v_paid + v_amt;
  end loop;
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
  if v_cash > 0 then v_je := v_je || jsonb_build_object('account', '111', 'debit', v_cash, 'memo', 'Thu tiền mặt ' || v_no); end if;
  if v_bank > 0 then v_je := v_je || jsonb_build_object('account', '112', 'debit', v_bank, 'memo', 'Thu chuyển khoản ' || v_no); end if;
  if v_resid > 0 then v_je := v_je || jsonb_build_object('account', '131', 'debit', v_resid, 'customer_id', c.id, 'memo', 'Phải thu ' || v_no); end if;
  v_je := v_je || jsonb_build_object('account', '511', 'credit', v_total, 'memo', 'Doanh thu (đã gồm thuế) ' || v_no);
  if v_cogs > 0 then
    v_je := v_je || jsonb_build_object('account', '632', 'debit', v_cogs, 'memo', 'Giá vốn ' || v_no);
    v_je := v_je || jsonb_build_object('account', '156', 'credit', v_cogs, 'memo', 'Xuất kho ' || v_no);
  end if;
  v_entry := public.post_journal(p_date, 'Bán hàng ' || v_no, v_je, 'sales_invoice', v_id);

  insert into public.sales_invoices(id, invoice_no, customer_id, invoice_date, due_date, subtotal, vat_amount, total, cogs_total, memo, entry_id,
                                    created_by, sale_source, channel, location_id, buyer, paid_at_sale)
  values (v_id, v_no, c.id, p_date, v_due, v_total, 0, v_total, v_cogs, p_memo, v_entry,
          (select auth.uid()), 'hkd_sale', p_channel, v_loc, public._sale_buyer(p_buyer), v_paid);
  for l in select * from jsonb_array_elements(v_rows) loop
    insert into public.sales_invoice_lines(invoice_id, line_no, product_id, description, qty, unit_price, discount_pct, vat_rate, line_net, vat_amount,
                                           unit_cost, line_cogs, movement_id, tax_group, vat_pct_snapshot, pit_pct_snapshot)
    values (v_id, (l->>'line_no')::int, nullif(l->>'product_id', '')::uuid, l->>'description', (l->>'qty')::int, (l->>'unit_price')::numeric,
            (l->>'discount_pct')::numeric, 0, (l->>'line_net')::numeric, 0, (l->>'unit_cost')::numeric, (l->>'line_cogs')::numeric,
            nullif(l->>'movement_id', '')::uuid, l->>'tax_group', nullif(l->>'vat_pct', '')::numeric, nullif(l->>'pit_pct', '')::numeric);
  end loop;
  for pay in select * from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    insert into public.sale_payments(sale_id, direction, method, amount, note)
    values (v_id, 'in', pay->>'method', (pay->>'amount')::numeric, public._clean_text(left(pay->>'note', 200)));
  end loop;
  if p_einvoice is not null and jsonb_typeof(p_einvoice) = 'object' and p_einvoice <> '{}'::jsonb then
    v_einv := public.record_sale_einvoice(v_id, p_einvoice);
  end if;
  return jsonb_build_object('invoice_id', v_id, 'invoice_no', v_no, 'customer_id', c.id, 'customer_name', c.name, 'is_walkin', c.is_walkin,
    'subtotal', v_total, 'vat', 0, 'total', v_total, 'paid', v_paid, 'debt', v_resid, 'cogs', v_cogs, 'entry_id', v_entry, 'einvoice', v_einv);
end $$;

-- ---------------------------------------------------------------- HÓA ĐƠN ĐIỆN TỬ (chỉ lưu thông tin)
create or replace function public.record_sale_einvoice(p_sale_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.sales_invoices%rowtype; v_kind text := coalesce(public._clean_text(p->>'kind'), 'original');
  v_num text := public._clean_text(p->>'number'); v_sym text := public._clean_text(p->>'symbol');
  v_url text := public._clean_text(p->>'lookup_url'); v_ret uuid; v_issued date; v_old uuid; v_id uuid;
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'einvoice_invalid'; end if;
  select * into s from public.sales_invoices where id = p_sale_id for update;
  if not found then raise exception 'invoice_not_found'; end if;
  if s.voided_at is not null then raise exception 'invoice_voided'; end if;
  if v_kind not in ('original', 'replace', 'adjust') then raise exception 'einvoice_kind_invalid'; end if;
  if v_num is null then raise exception 'einvoice_number_required'; end if;
  if v_num !~ '^[A-Za-z0-9/_-]{1,30}$' then raise exception 'einvoice_number_invalid'; end if;
  if v_sym is not null and v_sym !~ '^[A-Za-z0-9]{1,15}$' then raise exception 'einvoice_symbol_invalid'; end if;
  if v_url is not null and (v_url !~* '^https?://' or char_length(v_url) > 500) then raise exception 'einvoice_url_invalid'; end if;
  begin
    v_issued := coalesce(nullif(btrim(p->>'issued_on'), '')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
    v_ret := nullif(btrim(p->>'return_id'), '')::uuid;
  exception when others then raise exception 'einvoice_invalid'; end;
  if v_kind = 'adjust' then
    if v_ret is not null then perform 1 from public.sales_returns where id = v_ret and sale_id = s.id; if not found then raise exception 'return_not_found'; end if; end if;
  else
    v_ret := null;
    select id into v_old from public.einvoices where sale_id = s.id and kind in ('original', 'replace') and status = 'issued' for update;
    if v_kind = 'original' and v_old is not null then raise exception 'einvoice_already_recorded'; end if;
    if v_kind = 'replace' then
      if v_old is null then raise exception 'einvoice_nothing_to_replace'; end if;
      update public.einvoices set status = 'replaced' where id = v_old;
    end if;
  end if;
  begin
    insert into public.einvoices(sale_id, return_id, kind, provider, symbol, number, lookup_code, lookup_url, issued_on, note, created_by)
    values (s.id, v_ret, v_kind, public._clean_text(left(p->>'provider', 100)), v_sym, v_num, public._clean_text(left(p->>'lookup_code', 100)), v_url,
            v_issued, public._clean_text(left(p->>'note', 500)), (select auth.uid()))
    returning id into v_id;
  exception when unique_violation then
    if sqlerrm like '%uq_einvoices_number%' then raise exception 'einvoice_number_duplicate'; end if;
    raise exception 'einvoice_already_recorded';
  end;
  return (select to_jsonb(e) from public.einvoices e where e.id = v_id);
end $$;

create or replace function public.cancel_sale_einvoice(p_einvoice_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare e public.einvoices%rowtype;
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  if public._clean_text(p_reason) is null or char_length(btrim(p_reason)) < 5 then raise exception 'reason_required'; end if;
  select * into e from public.einvoices where id = p_einvoice_id for update;
  if not found then raise exception 'einvoice_not_found'; end if;
  if e.status <> 'issued' then raise exception 'einvoice_not_active'; end if;
  update public.einvoices set status = 'cancelled', cancelled_at = now(), cancel_reason = btrim(p_reason) where id = e.id;
  insert into public.accounting_audit(actor, action, detail)
  values ((select auth.uid()), 'cancel_sale_einvoice', jsonb_build_object('einvoice_id', e.id, 'sale_id', e.sale_id, 'number', e.number, 'reason', btrim(p_reason)));
  return (select to_jsonb(x) from public.einvoices x where x.id = e.id);
end $$;

-- ---------------------------------------------------------------- TRẢ HÀNG / GIẢM GIÁ HÀNG BÁN
-- p_lines  : [{"sale_line_id":uuid,"qty":int (0 = chỉ giảm giá),"amount":num (tùy chọn; mặc định theo tỷ lệ số lượng)}]
-- p_refunds: [{"method":"cash"|"bank","amount":num,"note":text}] — phải đúng bằng (tổng trả − phần trừ vào công nợ của hóa đơn);
--            null = hoàn toàn bộ phần còn lại bằng p_refund_method ('cash' | 'bank')
create or replace function public.post_sale_return(
  p_sale_id uuid, p_date date, p_lines jsonb, p_refunds jsonb default null, p_reason text default null, p_refund_method text default 'cash')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.sales_invoices%rowtype; l jsonb; rf jsonb; i int := 0; sl public.sales_invoice_lines%rowtype;
  v_qty int; v_amt numeric; v_cost numeric; v_done_qty int; v_done_amt numeric; v_done_cost numeric; v_open numeric;
  v_id uuid := gen_random_uuid(); v_no text; v_total numeric := 0; v_cogs numeric := 0; v_ar numeric := 0; v_ref numeric; v_ref_sum numeric := 0;
  v_cash numeric := 0; v_bank numeric := 0; v_mid uuid; v_rows jsonb := '[]'::jsonb; v_je jsonb; v_entry uuid; v_walk boolean; v_method text; v_ramt numeric;
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
    if v_ref > 0 then p_refunds := jsonb_build_array(jsonb_build_object('method', p_refund_method, 'amount', v_ref)); else p_refunds := '[]'::jsonb; end if;
  end if;
  if jsonb_typeof(p_refunds) is distinct from 'array' then raise exception 'refunds_invalid'; end if;
  for rf in select * from jsonb_array_elements(p_refunds) loop
    v_method := rf->>'method'; v_ramt := (rf->>'amount')::numeric;
    if v_method not in ('cash', 'bank') then raise exception 'method_invalid'; end if;
    if v_ramt is null or v_ramt <= 0 then raise exception 'amount_invalid'; end if;
    if v_method = 'cash' then v_cash := v_cash + v_ramt; else v_bank := v_bank + v_ramt; end if;
    v_ref_sum := v_ref_sum + v_ramt;
  end loop;
  if v_ref_sum <> v_ref then raise exception 'refund_mismatch: refunds % <> % (return % - applied to debt %)', v_ref_sum, v_ref, v_total, v_ar; end if;

  v_je := jsonb_build_array(jsonb_build_object('account', '521', 'debit', v_total, 'memo', 'Hàng bán trả lại/giảm giá ' || v_no));
  if v_cogs > 0 then
    v_je := v_je || jsonb_build_object('account', '156', 'debit', v_cogs, 'memo', 'Nhập lại kho ' || v_no);
    v_je := v_je || jsonb_build_object('account', '632', 'credit', v_cogs, 'memo', 'Hoàn giá vốn ' || v_no);
  end if;
  if v_ar > 0 then v_je := v_je || jsonb_build_object('account', '131', 'credit', v_ar, 'customer_id', s.customer_id, 'memo', 'Trừ công nợ ' || v_no); end if;
  if v_cash > 0 then v_je := v_je || jsonb_build_object('account', '111', 'credit', v_cash, 'memo', 'Hoàn tiền mặt ' || v_no); end if;
  if v_bank > 0 then v_je := v_je || jsonb_build_object('account', '112', 'credit', v_bank, 'memo', 'Hoàn chuyển khoản ' || v_no); end if;
  v_entry := public.post_journal(p_date, 'Trả hàng/giảm giá ' || v_no || ' (' || s.invoice_no || ')', v_je, 'sales_return', v_id);

  insert into public.sales_returns(id, return_no, sale_id, return_date, total, cogs_total, ar_applied, refunded, reason, entry_id, created_by)
  values (v_id, v_no, s.id, p_date, v_total, v_cogs, v_ar, v_ref, public._clean_text(left(p_reason, 500)), v_entry, (select auth.uid()));
  for l in select * from jsonb_array_elements(v_rows) loop
    insert into public.sales_return_lines(return_id, line_no, sale_line_id, qty, amount, cost, movement_id)
    values (v_id, (l->>'line_no')::int, (l->>'sale_line_id')::uuid, (l->>'qty')::int, (l->>'amount')::numeric, (l->>'cost')::numeric, nullif(l->>'movement_id', '')::uuid);
  end loop;
  for rf in select * from jsonb_array_elements(p_refunds) loop
    insert into public.sale_payments(return_id, direction, method, amount, note)
    values (v_id, 'out', rf->>'method', (rf->>'amount')::numeric, public._clean_text(left(rf->>'note', 200)));
  end loop;
  return jsonb_build_object('return_id', v_id, 'return_no', v_no, 'sale_id', s.id, 'invoice_no', s.invoice_no, 'total', v_total,
    'cogs', v_cogs, 'applied_to_debt', v_ar, 'refunded', v_ref, 'entry_id', v_entry);
end $$;

create or replace function public.reverse_sales_return(p_return_id uuid, p_date date default current_date, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.sales_returns%rowtype; v_rev uuid; x record; v_cur int;
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into r from public.sales_returns where id = p_return_id for update;
  if not found then raise exception 'return_not_found'; end if;
  if r.voided_at is not null then raise exception 'already_voided'; end if;
  perform public.assert_period_open(p_date);
  perform 1 from public.sales_invoices where id = r.sale_id for update;
  perform 1 from public.products where id in (select sl.product_id from public.sales_return_lines rl join public.sales_invoice_lines sl on sl.id = rl.sale_line_id
                                               where rl.return_id = r.id and rl.qty > 0) order by id for update;
  for x in select rl.*, sl.product_id from public.sales_return_lines rl join public.sales_invoice_lines sl on sl.id = rl.sale_line_id where rl.return_id = r.id and rl.qty > 0 order by sl.product_id loop
    select stock_qty into v_cur from public.products where id = x.product_id;
    if v_cur < x.qty then raise exception 'insufficient_stock_to_void: product % has % need %', x.product_id, v_cur, x.qty; end if;
  end loop;
  v_rev := public.reverse_journal(r.entry_id, p_date, 'Hủy phiếu trả hàng ' || r.return_no || coalesce(' — ' || p_reason, ''));
  for x in select rl.*, sl.product_id from public.sales_return_lines rl join public.sales_invoice_lines sl on sl.id = rl.sale_line_id where rl.return_id = r.id and rl.qty > 0 order by sl.product_id loop
    insert into public.stock_movements(product_id, type, qty, value_delta, ref_type, ref_id, notes, created_by)
    values (x.product_id, 'out', x.qty, -x.cost, 'sales_return_void', r.id, 'Xuất lại do hủy ' || r.return_no, (select auth.uid()));
  end loop;
  update public.sales_returns set voided_at = now(), void_entry_id = v_rev where id = r.id;
  return jsonb_build_object('return_id', r.id, 'reversal_entry_id', v_rev);
end $$;

-- hủy hóa đơn: không được khi còn phiếu trả hàng hoặc hóa đơn điện tử còn hiệu lực (phải xử lý ở hệ thống hóa đơn trước)
create or replace function public.reverse_sales_invoice(p_invoice_id uuid, p_date date default current_date, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare i public.sales_invoices%rowtype; v_rev uuid; r record;
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into i from public.sales_invoices where id = p_invoice_id for update;
  if not found then raise exception 'invoice_not_found'; end if;
  if i.voided_at is not null then raise exception 'already_voided'; end if;
  if exists (select 1 from public.payment_allocations pa join public.payments p on p.id = pa.payment_id and p.voided_at is null where pa.sales_invoice_id = i.id) then
    raise exception 'invoice_has_allocations';
  end if;
  if exists (select 1 from public.sales_returns where sale_id = i.id and voided_at is null) then raise exception 'invoice_has_returns'; end if;
  if exists (select 1 from public.einvoices where sale_id = i.id and status = 'issued') then raise exception 'invoice_has_einvoice'; end if;
  perform public.assert_period_open(p_date);
  v_rev := public.reverse_journal(i.entry_id, p_date, 'Hủy hóa đơn ' || i.invoice_no || coalesce(' — ' || p_reason, ''));
  for r in select * from public.sales_invoice_lines where invoice_id = i.id and product_id is not null order by product_id for update of sales_invoice_lines loop
    insert into public.stock_movements(product_id, type, qty, value_delta, ref_type, ref_id, notes, created_by)
    values (r.product_id, 'in', r.qty, r.line_cogs, 'sales_invoice_void', i.id, 'Nhập lại do hủy ' || i.invoice_no, (select auth.uid()));
  end loop;
  update public.sales_invoices set voided_at = now(), void_entry_id = v_rev where id = i.id;
  return jsonb_build_object('invoice_id', i.id, 'reversal_entry_id', v_rev);
end $$;

-- phiếu kho phát sinh từ chứng từ trả hàng đã có bút toán riêng: không được ghi nhận lần nữa
create or replace function public.post_stock_adjustments(p_date date default current_date)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_open numeric; v_gain numeric; v_loss numeric; v_je jsonb := '[]'::jsonb; v_entry uuid; n int;
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform public.assert_period_open(p_date);
  create temp table if not exists _sm_pending(id uuid, ref_type text, value_delta numeric) on commit drop;
  truncate _sm_pending;
  insert into _sm_pending
  select m.id, m.ref_type, m.value_delta from public.stock_movements m
   where coalesce(m.ref_type, '') not in ('sales_invoice','sales_invoice_void','purchase_bill','purchase_bill_void','sales_return','sales_return_void')
     and m.value_delta <> 0
     and not exists (select 1 from public.stock_movement_postings p where p.movement_id = m.id);
  select count(*) into n from _sm_pending;
  if n = 0 then return jsonb_build_object('posted', 0); end if;
  select coalesce(sum(value_delta) filter (where ref_type = 'opening' and value_delta > 0), 0) into v_open from _sm_pending;
  select coalesce(sum(value_delta) filter (where coalesce(ref_type,'') <> 'opening' and value_delta > 0), 0) into v_gain from _sm_pending;
  select coalesce(-sum(value_delta) filter (where value_delta < 0), 0) into v_loss from _sm_pending;
  if v_open > 0 then v_je := v_je || jsonb_build_array(jsonb_build_object('account', '156', 'debit', v_open, 'memo', 'Tồn đầu kỳ'), jsonb_build_object('account', '411', 'credit', v_open, 'memo', 'Tồn đầu kỳ')); end if;
  if v_gain > 0 then v_je := v_je || jsonb_build_array(jsonb_build_object('account', '156', 'debit', v_gain, 'memo', 'Nhập kho không chứng từ'), jsonb_build_object('account', '711', 'credit', v_gain, 'memo', 'Thu nhập khác (thừa kho)')); end if;
  if v_loss > 0 then v_je := v_je || jsonb_build_array(jsonb_build_object('account', '811', 'debit', v_loss, 'memo', 'Hao hụt/điều chỉnh giảm kho'), jsonb_build_object('account', '156', 'credit', v_loss, 'memo', 'Hao hụt/điều chỉnh giảm kho')); end if;
  v_entry := public.post_journal(p_date, 'Ghi nhận điều chỉnh tồn kho', v_je, 'stock_adjustments', null);
  insert into public.stock_movement_postings(movement_id, entry_id) select id, v_entry from _sm_pending;
  return jsonb_build_object('posted', n, 'entry_id', v_entry, 'opening', v_open, 'gain', v_gain, 'loss', v_loss);
end $$;

-- ---------------------------------------------------------------- BÁO CÁO: doanh thu thuần = 511 − 521
create or replace function public.report_dashboard()
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_start date := date_trunc('month', (now() at time zone 'Asia/Ho_Chi_Minh'))::date;
  v_end   date := (date_trunc('month', (now() at time zone 'Asia/Ho_Chi_Minh')) + interval '1 month - 1 day')::date;
  r jsonb;
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  select jsonb_build_object(
    'products',            (select count(*) from public.products),
    'low_stock',           (select count(*) from public.low_stock_products),
    'customers',           (select count(*) from public.customers where not is_walkin),
    'business_customers',  (select count(*) from public.customers where type = 'business'),
    'open_tickets',        (select count(*) from public.maintenance_tickets where status not in ('closed', 'signed')),
    'pending_quotations',  (select count(*) from public.quotations where status = 'sent'),
    'month_revenue',       coalesce((select sum(case l.account_code when '511' then l.credit - l.debit else l.credit - l.debit end)
                                       from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
                                      where l.account_code in ('511', '521') and e.entry_date between v_start and v_end), 0),
    'month_cogs',          coalesce((select sum(l.debit - l.credit) from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
                                      where l.account_code = '632' and e.entry_date between v_start and v_end), 0),
    'ar_balance',          public.account_balance('131'),
    'ap_balance',          public.account_balance('331'),
    'stock_value',         public.account_balance('156'),
    'overdue_invoices',    (select count(*) from public.v_sales_invoice_open where outstanding > 0 and due_date < (now() at time zone 'Asia/Ho_Chi_Minh')::date)
  ) into r;
  return r;
end $$;

create or replace function public.report_monthly_pnl(p_from date, p_to date)
returns table(month date, revenue numeric, cogs numeric, gross_profit numeric)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  with m as (select generate_series(date_trunc('month', p_from)::date, date_trunc('month', p_to)::date, interval '1 month')::date as d),
  s as (
    select date_trunc('month', e.entry_date)::date as d,
           coalesce(sum(l.credit - l.debit) filter (where l.account_code in ('511', '521')), 0) as rev,
           coalesce(sum(l.debit - l.credit) filter (where l.account_code = '632'), 0) as cg
      from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
     where l.account_code in ('511', '521', '632') and e.entry_date between p_from and p_to
     group by 1)
  select m.d, coalesce(s.rev, 0)::numeric, coalesce(s.cg, 0)::numeric, (coalesce(s.rev, 0) - coalesce(s.cg, 0))::numeric
    from m left join s on s.d = m.d order by m.d;
end $$;

create or replace function public.report_top_products(p_from date, p_to date, p_limit int default 10)
returns table(product_id uuid, sku text, name text, qty bigint, revenue numeric, cogs numeric, margin numeric)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select l.product_id, p.sku, p.name,
         (sum(l.qty) - coalesce(sum(rt.qty), 0))::bigint,
         (sum(l.line_net) - coalesce(sum(rt.amount), 0))::numeric,
         (sum(l.line_cogs) - coalesce(sum(rt.cost), 0))::numeric,
         ((sum(l.line_net) - coalesce(sum(rt.amount), 0)) - (sum(l.line_cogs) - coalesce(sum(rt.cost), 0)))::numeric
    from public.sales_invoice_lines l
    join public.sales_invoices i on i.id = l.invoice_id and i.voided_at is null
    left join public.products p on p.id = l.product_id
    left join lateral (select sum(rl.qty) as qty, sum(rl.amount) as amount, sum(rl.cost) as cost
                         from public.sales_return_lines rl join public.sales_returns r on r.id = rl.return_id and r.voided_at is null
                        where rl.sale_line_id = l.id) rt on true
   where i.invoice_date between p_from and p_to and l.product_id is not null
   group by l.product_id, p.sku, p.name
   order by (sum(l.line_net) - coalesce(sum(rt.amount), 0)) desc, p.name
   limit greatest(1, least(coalesce(p_limit, 10), 100));
end $$;

create or replace function public.report_top_customers(p_from date, p_to date, p_limit int default 10)
returns table(customer_id uuid, name text, invoices bigint, revenue numeric, outstanding numeric)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select c.id, c.name, count(*)::bigint,
         (sum(i.subtotal) - coalesce(sum((select sum(r.total) from public.sales_returns r where r.sale_id = i.id and r.voided_at is null)), 0))::numeric,
         coalesce(sum(o.outstanding), 0)::numeric
    from public.sales_invoices i
    join public.customers c on c.id = i.customer_id
    left join public.v_sales_invoice_open o on o.invoice_id = i.id
   where i.voided_at is null and i.invoice_date between p_from and p_to
   group by c.id, c.name
   order by (sum(i.subtotal) - coalesce(sum((select sum(r.total) from public.sales_returns r where r.sale_id = i.id and r.voided_at is null)), 0)) desc, c.name
   limit greatest(1, least(coalesce(p_limit, 10), 100));
end $$;

-- doanh thu năm theo nhóm ngành thuế (khớp revenue_ytd): dòng hóa đơn (gồm thuế nếu hóa đơn cũ có VAT) trừ dòng trả hàng/giảm giá
create or replace function public.revenue_by_tax_group(p_year int default null)
returns table(tax_group text, name_vi text, revenue numeric, vat_pct numeric, pit_pct numeric)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_year int := coalesce(p_year, extract(year from (now() at time zone 'Asia/Ho_Chi_Minh'))::int);
        v_from date := make_date(v_year, 1, 1); v_to date := make_date(v_year, 12, 31);
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  with ev as (
    select l.tax_group as g, (l.line_net + l.vat_amount) as amt
      from public.sales_invoice_lines l join public.sales_invoices i on i.id = l.invoice_id
     where i.voided_at is null and i.invoice_date between v_from and v_to
    union all
    select sl.tax_group, -rl.amount
      from public.sales_return_lines rl join public.sales_returns r on r.id = rl.return_id and r.voided_at is null
      join public.sales_invoice_lines sl on sl.id = rl.sale_line_id
     where r.return_date between v_from and v_to)
  select g.code, g.name_vi, coalesce(sum(ev.amt), 0)::numeric,
         (select t.vat_pct from public.tax_rates t where t.tax_group = g.code and t.effective_from <= v_to order by t.effective_from desc limit 1),
         (select t.pit_pct from public.tax_rates t where t.tax_group = g.code and t.effective_from <= v_to order by t.effective_from desc limit 1)
    from public.tax_groups g left join ev on ev.g = g.code
   group by g.code, g.name_vi, g.sort_order
  having coalesce(sum(ev.amt), 0) <> 0 or g.code in ('goods', 'service')
   order by g.sort_order;
end $$;

-- ---------------------------------------------------------------- RLS / grants
do $$
declare t text;
begin
  foreach t in array array['sales_returns', 'sales_return_lines', 'sale_payments', 'einvoices'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "staff_read_%I" on public.%I', t, t);
    execute format('create policy "staff_read_%I" on public.%I for select to authenticated using ((select public.is_staff()))', t, t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
  end loop;
end $$;
do $$
declare f text;
begin
  foreach f in array array[
    'public.post_sale_hkd(uuid, date, jsonb, jsonb, text, uuid, jsonb, text, date, jsonb, boolean)',
    'public.post_sale_return(uuid, date, jsonb, jsonb, text, text)', 'public.reverse_sales_return(uuid, date, text)',
    'public.record_sale_einvoice(uuid, jsonb)', 'public.cancel_sale_einvoice(uuid, text)',
    'public.reverse_sales_invoice(uuid, date, text)', 'public.post_stock_adjustments(date)',
    'public.report_dashboard()', 'public.report_monthly_pnl(date, date)', 'public.report_top_products(date, date, int)',
    'public.report_top_customers(date, date, int)', 'public.revenue_by_tax_group(integer)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  revoke all on function public._sale_buyer(jsonb) from public, anon, authenticated;
  revoke all on function public._tax_rate_for(text, date) from public, anon, authenticated;
end $$;
grant select on public.v_sales_missing_einvoice to authenticated;
