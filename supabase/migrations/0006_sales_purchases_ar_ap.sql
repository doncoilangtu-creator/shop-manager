-- ============================================================================
-- 0006_sales_purchases_ar_ap.sql — sales invoices (AR), purchase bills (AP), receipts/disbursements
--                                  with allocations, VAT, aging, reconciliation
--
-- Every business document posts ONE balanced journal entry through the ledger of 0004 and moves
-- stock through the stock ledger of 0003/0005, inside the same transaction:
--   sale      : Dr 131 total | Cr 511 net | Cr 3331 VAT | Dr 632 cost | Cr 156 cost  (+ stock OUT at average cost)
--   purchase  : Dr 156 net | Dr 133 VAT | Cr 331 total                              (+ stock IN at cost)
--   receipt   : Dr 111/112 | Cr 131 (customer)      disbursement: Dr 331 (supplier) | Cr 111/112
-- Documents are immutable; corrections = reverse_* (reversal journal + compensating stock movement).
-- Idempotent. Requires 0003, 0004, 0005.
-- ============================================================================

create or replace function public.assert_period_open(p_date date)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_status text;
begin
  select status into v_status from public.fiscal_periods where year = extract(year from p_date)::int and month = extract(month from p_date)::int;
  if v_status = 'closed' then raise exception 'period_closed'; end if;
end $$;

-- ------------------------------------------------------------------ tables
create table if not exists public.sales_invoices (
  id            uuid primary key default gen_random_uuid(),
  invoice_no    text not null unique,
  customer_id   uuid not null references public.customers(id) on delete restrict,
  invoice_date  date not null,
  due_date      date not null,
  subtotal      numeric(16,2) not null check (subtotal >= 0),
  vat_amount    numeric(16,2) not null check (vat_amount >= 0),
  total         numeric(16,2) not null check (total > 0),
  cogs_total    numeric(16,2) not null default 0 check (cogs_total >= 0),
  quotation_id  uuid references public.quotations(id) on delete restrict,
  memo          text,
  entry_id      uuid not null references public.journal_entries(id) on delete restrict,
  voided_at     timestamptz,
  void_entry_id uuid references public.journal_entries(id) on delete restrict,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  check (total = subtotal + vat_amount), check (due_date >= invoice_date)
);
create index if not exists idx_si_customer on public.sales_invoices(customer_id);

create table if not exists public.sales_invoice_lines (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references public.sales_invoices(id) on delete restrict,
  line_no      integer not null,
  product_id   uuid references public.products(id) on delete restrict,
  description  text,
  qty          integer not null check (qty > 0),
  unit_price   numeric(14,2) not null check (unit_price >= 0),
  discount_pct numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  vat_rate     numeric(5,2) not null default 0 check (vat_rate in (0, 5, 8, 10)),
  line_net     numeric(16,2) not null,
  vat_amount   numeric(16,2) not null,
  unit_cost    numeric(14,4) not null default 0,
  line_cogs    numeric(16,2) not null default 0,
  movement_id  uuid references public.stock_movements(id) on delete restrict,
  unique (invoice_id, line_no)
);

create table if not exists public.purchase_bills (
  id            uuid primary key default gen_random_uuid(),
  bill_no       text not null unique,
  supplier_ref  text,                                   -- the supplier's own invoice number
  supplier_id   uuid not null references public.suppliers(id) on delete restrict,
  bill_date     date not null,
  due_date      date not null,
  subtotal      numeric(16,2) not null check (subtotal >= 0),
  vat_amount    numeric(16,2) not null check (vat_amount >= 0),
  total         numeric(16,2) not null check (total > 0),
  memo          text,
  entry_id      uuid not null references public.journal_entries(id) on delete restrict,
  voided_at     timestamptz,
  void_entry_id uuid references public.journal_entries(id) on delete restrict,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  check (total = subtotal + vat_amount), check (due_date >= bill_date)
);
create unique index if not exists uq_pb_supplier_ref on public.purchase_bills(supplier_id, supplier_ref) where supplier_ref is not null and voided_at is null;
create index if not exists idx_pb_supplier on public.purchase_bills(supplier_id);

create table if not exists public.purchase_bill_lines (
  id           uuid primary key default gen_random_uuid(),
  bill_id      uuid not null references public.purchase_bills(id) on delete restrict,
  line_no      integer not null,
  product_id   uuid not null references public.products(id) on delete restrict,
  qty          integer not null check (qty > 0),
  unit_cost    numeric(14,2) not null check (unit_cost >= 0),
  vat_rate     numeric(5,2) not null default 0 check (vat_rate in (0, 5, 8, 10)),
  line_net     numeric(16,2) not null,
  vat_amount   numeric(16,2) not null,
  movement_id  uuid references public.stock_movements(id) on delete restrict,
  unique (bill_id, line_no)
);

create table if not exists public.payments (
  id            uuid primary key default gen_random_uuid(),
  payment_no    text not null unique,
  kind          text not null check (kind in ('receipt','disbursement')),
  customer_id   uuid references public.customers(id) on delete restrict,
  supplier_id   uuid references public.suppliers(id) on delete restrict,
  amount        numeric(16,2) not null check (amount > 0),
  method        text not null check (method in ('cash','bank')),
  pay_date      date not null,
  memo          text,
  entry_id      uuid not null references public.journal_entries(id) on delete restrict,
  voided_at     timestamptz,
  void_entry_id uuid references public.journal_entries(id) on delete restrict,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  check ((kind = 'receipt' and customer_id is not null and supplier_id is null)
      or (kind = 'disbursement' and supplier_id is not null and customer_id is null))
);

create table if not exists public.payment_allocations (
  id                uuid primary key default gen_random_uuid(),
  payment_id        uuid not null references public.payments(id) on delete restrict,
  sales_invoice_id  uuid references public.sales_invoices(id) on delete restrict,
  purchase_bill_id  uuid references public.purchase_bills(id) on delete restrict,
  amount            numeric(16,2) not null check (amount > 0),
  created_at        timestamptz not null default now(),
  check ((sales_invoice_id is not null) <> (purchase_bill_id is not null))
);
create index if not exists idx_pa_payment on public.payment_allocations(payment_id);
create index if not exists idx_pa_si on public.payment_allocations(sales_invoice_id) where sales_invoice_id is not null;
create index if not exists idx_pa_pb on public.payment_allocations(purchase_bill_id) where purchase_bill_id is not null;

-- stock movements already booked to the GL by post_stock_adjustments()
create table if not exists public.stock_movement_postings (
  movement_id  uuid primary key references public.stock_movements(id) on delete restrict,
  entry_id     uuid not null references public.journal_entries(id) on delete restrict
);

-- ------------------------------------------------------------------ immutability
create or replace function public.trg_doc_immutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and tg_table_name in ('sales_invoices','purchase_bills','payments') then
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
  foreach t in array array['sales_invoices','sales_invoice_lines','purchase_bills','purchase_bill_lines','payments','payment_allocations','stock_movement_postings'] loop
    execute format('drop trigger if exists trg_%I_immutable on public.%I', t, t);
    execute format('create trigger trg_%I_immutable before update or delete on public.%I for each row execute function public.trg_doc_immutable()', t, t);
  end loop;
end $$;

-- ------------------------------------------------------------------ open-item views
create or replace view public.v_sales_invoice_open with (security_invoker = true) as
  select i.id as invoice_id, i.invoice_no, i.customer_id, i.invoice_date, i.due_date, i.total,
         coalesce(a.allocated, 0) as allocated, i.total - coalesce(a.allocated, 0) as outstanding,
         greatest(current_date - i.due_date, 0) as days_overdue
    from public.sales_invoices i
    left join lateral (select sum(pa.amount) as allocated from public.payment_allocations pa
                         join public.payments p on p.id = pa.payment_id and p.voided_at is null
                        where pa.sales_invoice_id = i.id) a on true
   where i.voided_at is null;

create or replace view public.v_purchase_bill_open with (security_invoker = true) as
  select b.id as bill_id, b.bill_no, b.supplier_id, b.bill_date, b.due_date, b.total,
         coalesce(a.allocated, 0) as allocated, b.total - coalesce(a.allocated, 0) as outstanding,
         greatest(current_date - b.due_date, 0) as days_overdue
    from public.purchase_bills b
    left join lateral (select sum(pa.amount) as allocated from public.payment_allocations pa
                         join public.payments p on p.id = pa.payment_id and p.voided_at is null
                        where pa.purchase_bill_id = b.id) a on true
   where b.voided_at is null;

create or replace view public.v_payment_unapplied with (security_invoker = true) as
  select p.id as payment_id, p.payment_no, p.kind, p.customer_id, p.supplier_id, p.pay_date, p.amount,
         coalesce(a.allocated, 0) as allocated, p.amount - coalesce(a.allocated, 0) as unapplied
    from public.payments p
    left join lateral (select sum(amount) as allocated from public.payment_allocations pa where pa.payment_id = p.id) a on true
   where p.voided_at is null;

create or replace view public.v_ar_by_customer with (security_invoker = true) as
  select c.id as customer_id, c.name,
         coalesce((select sum(outstanding) from public.v_sales_invoice_open o where o.customer_id = c.id), 0)
         - coalesce((select sum(unapplied) from public.v_payment_unapplied u where u.customer_id = c.id), 0) as balance,
         coalesce((select sum(debit - credit) from public.journal_lines l where l.account_code = '131' and l.customer_id = c.id), 0) as gl_balance
    from public.customers c
   where exists (select 1 from public.sales_invoices i where i.customer_id = c.id)
      or exists (select 1 from public.payments p where p.customer_id = c.id);

create or replace view public.v_ap_by_supplier with (security_invoker = true) as
  select s.id as supplier_id, s.name,
         coalesce((select sum(outstanding) from public.v_purchase_bill_open o where o.supplier_id = s.id), 0)
         - coalesce((select sum(unapplied) from public.v_payment_unapplied u where u.supplier_id = s.id), 0) as balance,
         coalesce((select sum(credit - debit) from public.journal_lines l where l.account_code = '331' and l.supplier_id = s.id), 0) as gl_balance
    from public.suppliers s
   where exists (select 1 from public.purchase_bills b where b.supplier_id = s.id)
      or exists (select 1 from public.payments p where p.supplier_id = s.id);

-- ------------------------------------------------------------------ helpers
create or replace function public._method_account(p_method text)
returns text language sql immutable as $$ select case p_method when 'cash' then '111' when 'bank' then '112' end $$;

-- ------------------------------------------------------------------ SALE
-- p_lines: [{"product_id":uuid|null,"description":text,"qty":int,"unit_price":num,"discount_pct":num,"vat_rate":0|5|8|10}]
create or replace function public.post_sales_invoice(
  p_customer_id uuid, p_invoice_date date, p_due_date date, p_lines jsonb,
  p_memo text default null, p_quotation_id uuid default null, p_allow_over_limit boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := gen_random_uuid(); v_no text; v_due date := coalesce(p_due_date, p_invoice_date);
  c public.customers%rowtype; l jsonb; i int := 0; n int;
  v_qty int; v_price numeric; v_disc numeric; v_rate numeric; v_pid uuid;
  v_net numeric; v_vat numeric; v_sub numeric := 0; v_vat_t numeric := 0; v_cogs numeric := 0; v_total numeric;
  v_mid uuid; v_val numeric; v_ar numeric; v_entry uuid; v_je jsonb; v_cur int; v_sku text;
  rec record;
  v_lines jsonb := '[]'::jsonb;
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'lines_required'; end if;
  if p_invoice_date is null then raise exception 'date_required'; end if;
  if v_due < p_invoice_date then raise exception 'due_before_invoice_date'; end if;
  perform public.assert_period_open(p_invoice_date);
  select * into c from public.customers where id = p_customer_id for update;       -- serialises debt-limit checks per customer
  if not found then raise exception 'customer_not_found'; end if;

  -- lock stock rows in a stable order (avoids deadlocks between concurrent invoices)
  perform 1 from public.products where id in (select nullif(x->>'product_id','')::uuid from jsonb_array_elements(p_lines) x) order by id for update;

  v_no := public.next_doc_no('INV', p_invoice_date);
  for l in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    v_pid := nullif(l->>'product_id','')::uuid; v_qty := (l->>'qty')::int; v_price := (l->>'unit_price')::numeric;
    v_disc := coalesce((l->>'discount_pct')::numeric, 0); v_rate := coalesce((l->>'vat_rate')::numeric, 0);
    if v_qty is null or v_qty <= 0 or v_price is null or v_price < 0 or v_disc < 0 or v_disc > 100 or v_rate not in (0,5,8,10) then
      raise exception 'line_invalid: line %', i;
    end if;
    if v_pid is null and coalesce(l->>'description','') = '' then raise exception 'line_invalid: line % needs product or description', i; end if;
    v_net := round(v_qty * v_price * (1 - v_disc / 100), 2);
    v_vat := round(v_net * v_rate / 100, 2);
    v_sub := v_sub + v_net; v_vat_t := v_vat_t + v_vat;
    v_mid := null; v_val := 0;
    if v_pid is not null then
      select stock_qty, sku into v_cur, v_sku from public.products where id = v_pid;
      if not found then raise exception 'product_not_found: line %', i; end if;
      if v_cur < v_qty then raise exception 'insufficient_stock: % (have %, need %)', v_sku, v_cur, v_qty; end if;
      insert into public.stock_movements(product_id, type, qty, ref_type, ref_id, notes, created_by)
      values (v_pid, 'out', v_qty, 'sales_invoice', v_id, 'Xuất bán ' || v_no, auth.uid())
      returning id, -value_delta into v_mid, v_val;
    end if;
    v_cogs := v_cogs + v_val;
    v_lines := v_lines || jsonb_build_object('line_no', i, 'product_id', v_pid, 'description', l->>'description', 'qty', v_qty,
      'unit_price', v_price, 'discount_pct', v_disc, 'vat_rate', v_rate, 'line_net', v_net, 'vat_amount', v_vat,
      'unit_cost', case when v_qty > 0 then round(v_val / v_qty, 4) else 0 end, 'line_cogs', v_val, 'movement_id', v_mid);
  end loop;
  v_total := v_sub + v_vat_t;
  if v_total <= 0 then raise exception 'total_must_be_positive'; end if;

  if not p_allow_over_limit and c.debt_limit > 0 then
    select coalesce(sum(debit - credit), 0) into v_ar from public.journal_lines where account_code = '131' and customer_id = p_customer_id;
    if v_ar + v_total > c.debt_limit then
      raise exception 'debt_limit_exceeded' using detail = format('AR %s + invoice %s > limit %s', v_ar, v_total, c.debt_limit);
    end if;
  end if;

  v_je := jsonb_build_array(
    jsonb_build_object('account', '131', 'debit', v_total, 'customer_id', p_customer_id, 'memo', 'Phải thu ' || v_no));
  v_je := v_je || jsonb_build_object('account', '511', 'credit', v_sub, 'memo', 'Doanh thu ' || v_no);
  if v_vat_t > 0 then v_je := v_je || jsonb_build_object('account', '3331', 'credit', v_vat_t, 'memo', 'VAT đầu ra ' || v_no); end if;
  if v_cogs > 0 then
    v_je := v_je || jsonb_build_object('account', '632', 'debit', v_cogs, 'memo', 'Giá vốn ' || v_no);
    v_je := v_je || jsonb_build_object('account', '156', 'credit', v_cogs, 'memo', 'Xuất kho ' || v_no);
  end if;
  v_entry := public.post_journal(p_invoice_date, 'Bán hàng ' || v_no, v_je, 'sales_invoice', v_id);

  insert into public.sales_invoices(id, invoice_no, customer_id, invoice_date, due_date, subtotal, vat_amount, total, cogs_total, quotation_id, memo, entry_id, created_by)
  values (v_id, v_no, p_customer_id, p_invoice_date, v_due, v_sub, v_vat_t, v_total, v_cogs, p_quotation_id, p_memo, v_entry, auth.uid());
  for l in select * from jsonb_array_elements(v_lines) loop
    insert into public.sales_invoice_lines(invoice_id, line_no, product_id, description, qty, unit_price, discount_pct, vat_rate, line_net, vat_amount, unit_cost, line_cogs, movement_id)
    values (v_id, (l->>'line_no')::int, nullif(l->>'product_id','')::uuid, l->>'description', (l->>'qty')::int,
            (l->>'unit_price')::numeric, (l->>'discount_pct')::numeric, (l->>'vat_rate')::numeric,
            (l->>'line_net')::numeric, (l->>'vat_amount')::numeric, (l->>'unit_cost')::numeric, (l->>'line_cogs')::numeric,
            nullif(l->>'movement_id','')::uuid);
  end loop;
  return jsonb_build_object('invoice_id', v_id, 'invoice_no', v_no, 'subtotal', v_sub, 'vat', v_vat_t, 'total', v_total, 'cogs', v_cogs, 'entry_id', v_entry);
end $$;

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
  perform public.assert_period_open(p_date);
  v_rev := public.reverse_journal(i.entry_id, p_date, 'Hủy hóa đơn ' || i.invoice_no || coalesce(' — ' || p_reason, ''));
  for r in select * from public.sales_invoice_lines where invoice_id = i.id and product_id is not null order by product_id for update of sales_invoice_lines loop
    insert into public.stock_movements(product_id, type, qty, value_delta, ref_type, ref_id, notes, created_by)
    values (r.product_id, 'in', r.qty, r.line_cogs, 'sales_invoice_void', i.id, 'Nhập lại do hủy ' || i.invoice_no, auth.uid());
  end loop;
  update public.sales_invoices set voided_at = now(), void_entry_id = v_rev where id = i.id;
  return jsonb_build_object('invoice_id', i.id, 'reversal_entry_id', v_rev);
end $$;

-- ------------------------------------------------------------------ PURCHASE
-- p_lines: [{"product_id":uuid,"qty":int,"unit_cost":num,"vat_rate":0|5|8|10}]
create or replace function public.post_purchase_bill(
  p_supplier_id uuid, p_bill_date date, p_due_date date, p_lines jsonb,
  p_supplier_ref text default null, p_memo text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := gen_random_uuid(); v_no text; v_due date := coalesce(p_due_date, p_bill_date); l jsonb; i int := 0;
  v_pid uuid; v_qty int; v_cost numeric; v_rate numeric; v_net numeric; v_vat numeric; v_sub numeric := 0; v_vat_t numeric := 0; v_total numeric;
  v_entry uuid; v_je jsonb; v_mid uuid; rec record; v_rows jsonb := '[]'::jsonb;
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'lines_required'; end if;
  if p_bill_date is null then raise exception 'date_required'; end if;
  if v_due < p_bill_date then raise exception 'due_before_bill_date'; end if;
  perform public.assert_period_open(p_bill_date);
  perform 1 from public.suppliers where id = p_supplier_id for update;
  if not found then raise exception 'supplier_not_found'; end if;
  perform 1 from public.products where id in (select nullif(x->>'product_id','')::uuid from jsonb_array_elements(p_lines) x) order by id for update;
  v_no := public.next_doc_no('PB', p_bill_date);
  for l in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    v_pid := nullif(l->>'product_id','')::uuid; v_qty := (l->>'qty')::int; v_cost := (l->>'unit_cost')::numeric; v_rate := coalesce((l->>'vat_rate')::numeric, 0);
    if v_pid is null or v_qty is null or v_qty <= 0 or v_cost is null or v_cost < 0 or v_rate not in (0,5,8,10) then raise exception 'line_invalid: line %', i; end if;
    perform 1 from public.products where id = v_pid;
    if not found then raise exception 'product_not_found: line %', i; end if;
    v_net := round(v_qty * v_cost, 2); v_vat := round(v_net * v_rate / 100, 2);
    v_sub := v_sub + v_net; v_vat_t := v_vat_t + v_vat;
    insert into public.stock_movements(product_id, type, qty, unit_cost, value_delta, ref_type, ref_id, notes, created_by)
    values (v_pid, 'in', v_qty, v_cost, v_net, 'purchase_bill', v_id, 'Nhập mua ' || v_no, auth.uid()) returning id into v_mid;
    v_rows := v_rows || jsonb_build_object('line_no', i, 'product_id', v_pid, 'qty', v_qty, 'unit_cost', v_cost, 'vat_rate', v_rate, 'line_net', v_net, 'vat_amount', v_vat, 'movement_id', v_mid);
  end loop;
  v_total := v_sub + v_vat_t;
  if v_total <= 0 then raise exception 'total_must_be_positive'; end if;
  v_je := jsonb_build_array(jsonb_build_object('account', '156', 'debit', v_sub, 'memo', 'Nhập hàng ' || v_no));
  if v_vat_t > 0 then v_je := v_je || jsonb_build_object('account', '133', 'debit', v_vat_t, 'memo', 'VAT đầu vào ' || v_no); end if;
  v_je := v_je || jsonb_build_object('account', '331', 'credit', v_total, 'supplier_id', p_supplier_id, 'memo', 'Phải trả ' || v_no);
  v_entry := public.post_journal(p_bill_date, 'Mua hàng ' || v_no, v_je, 'purchase_bill', v_id);
  insert into public.purchase_bills(id, bill_no, supplier_ref, supplier_id, bill_date, due_date, subtotal, vat_amount, total, memo, entry_id, created_by)
  values (v_id, v_no, p_supplier_ref, p_supplier_id, p_bill_date, v_due, v_sub, v_vat_t, v_total, p_memo, v_entry, auth.uid());
  for l in select * from jsonb_array_elements(v_rows) loop
    insert into public.purchase_bill_lines(bill_id, line_no, product_id, qty, unit_cost, vat_rate, line_net, vat_amount, movement_id)
    values (v_id, (l->>'line_no')::int, (l->>'product_id')::uuid, (l->>'qty')::int, (l->>'unit_cost')::numeric,
            (l->>'vat_rate')::numeric, (l->>'line_net')::numeric, (l->>'vat_amount')::numeric, (l->>'movement_id')::uuid);
  end loop;
  return jsonb_build_object('bill_id', v_id, 'bill_no', v_no, 'subtotal', v_sub, 'vat', v_vat_t, 'total', v_total, 'entry_id', v_entry);
end $$;

create or replace function public.reverse_purchase_bill(p_bill_id uuid, p_date date default current_date, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.purchase_bills%rowtype; v_rev uuid; r record; v_cur int;
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into b from public.purchase_bills where id = p_bill_id for update;
  if not found then raise exception 'bill_not_found'; end if;
  if b.voided_at is not null then raise exception 'already_voided'; end if;
  if exists (select 1 from public.payment_allocations pa join public.payments p on p.id = pa.payment_id and p.voided_at is null where pa.purchase_bill_id = b.id) then
    raise exception 'bill_has_allocations';
  end if;
  perform public.assert_period_open(p_date);
  perform 1 from public.products where id in (select product_id from public.purchase_bill_lines where bill_id = b.id) order by id for update;
  for r in select * from public.purchase_bill_lines where bill_id = b.id order by product_id loop
    select stock_qty into v_cur from public.products where id = r.product_id;
    if v_cur < r.qty then raise exception 'insufficient_stock_to_void: product % has % need %', r.product_id, v_cur, r.qty; end if;
  end loop;
  v_rev := public.reverse_journal(b.entry_id, p_date, 'Hủy phiếu mua ' || b.bill_no || coalesce(' — ' || p_reason, ''));
  for r in select * from public.purchase_bill_lines where bill_id = b.id order by product_id loop
    insert into public.stock_movements(product_id, type, qty, value_delta, ref_type, ref_id, notes, created_by)
    values (r.product_id, 'out', r.qty, -r.line_net, 'purchase_bill_void', b.id, 'Xuất trả do hủy ' || b.bill_no, auth.uid());
  end loop;
  update public.purchase_bills set voided_at = now(), void_entry_id = v_rev where id = b.id;
  return jsonb_build_object('bill_id', b.id, 'reversal_entry_id', v_rev);
end $$;

-- ------------------------------------------------------------------ PAYMENTS & ALLOCATION
-- p_allocations: [{"invoice_id":uuid,"amount":num}]  (receipt)   /  [{"bill_id":uuid,"amount":num}] (disbursement)
create or replace function public._allocate(p_payment_id uuid, p_kind text, p_party uuid, p_allocations jsonb)
returns numeric language plpgsql security definer set search_path = public, pg_temp as $$
declare a jsonb; v_amt numeric; v_out numeric; v_sum numeric := 0; v_doc uuid; v_unapplied numeric;
begin
  select unapplied into v_unapplied from public.v_payment_unapplied where payment_id = p_payment_id;
  if v_unapplied is null then raise exception 'payment_not_found_or_voided'; end if;
  for a in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    v_amt := (a->>'amount')::numeric;
    if v_amt is null or v_amt <= 0 then raise exception 'allocation_invalid'; end if;
    if p_kind = 'receipt' then
      v_doc := (a->>'invoice_id')::uuid;
      perform 1 from public.sales_invoices where id = v_doc and customer_id = p_party and voided_at is null for update;
      if not found then raise exception 'invoice_not_found_for_customer'; end if;
      select outstanding into v_out from public.v_sales_invoice_open where invoice_id = v_doc;
      if v_amt > v_out then raise exception 'allocation_exceeds_outstanding: % > %', v_amt, v_out; end if;
      insert into public.payment_allocations(payment_id, sales_invoice_id, amount) values (p_payment_id, v_doc, v_amt);
    else
      v_doc := (a->>'bill_id')::uuid;
      perform 1 from public.purchase_bills where id = v_doc and supplier_id = p_party and voided_at is null for update;
      if not found then raise exception 'bill_not_found_for_supplier'; end if;
      select outstanding into v_out from public.v_purchase_bill_open where bill_id = v_doc;
      if v_amt > v_out then raise exception 'allocation_exceeds_outstanding: % > %', v_amt, v_out; end if;
      insert into public.payment_allocations(payment_id, purchase_bill_id, amount) values (p_payment_id, v_doc, v_amt);
    end if;
    v_sum := v_sum + v_amt;
  end loop;
  if v_sum > v_unapplied then raise exception 'allocation_exceeds_payment: % > %', v_sum, v_unapplied; end if;
  return v_sum;
end $$;

create or replace function public.post_receipt(
  p_customer_id uuid, p_amount numeric, p_method text, p_date date, p_allocations jsonb default '[]'::jsonb, p_memo text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := gen_random_uuid(); v_no text; v_entry uuid; v_alloc numeric;
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount_invalid'; end if;
  if p_method not in ('cash','bank') then raise exception 'method_invalid'; end if;
  perform public.assert_period_open(p_date);
  perform 1 from public.customers where id = p_customer_id for update;
  if not found then raise exception 'customer_not_found'; end if;
  v_no := public.next_doc_no('RC', p_date);
  v_entry := public.post_journal(p_date, 'Thu tiền ' || v_no, jsonb_build_array(
    jsonb_build_object('account', public._method_account(p_method), 'debit', p_amount, 'memo', 'Thu ' || v_no),
    jsonb_build_object('account', '131', 'credit', p_amount, 'customer_id', p_customer_id, 'memo', 'Thu tiền KH ' || v_no)),
    'receipt', v_id);
  insert into public.payments(id, payment_no, kind, customer_id, amount, method, pay_date, memo, entry_id, created_by)
  values (v_id, v_no, 'receipt', p_customer_id, p_amount, p_method, p_date, p_memo, v_entry, auth.uid());
  v_alloc := public._allocate(v_id, 'receipt', p_customer_id, p_allocations);
  return jsonb_build_object('payment_id', v_id, 'payment_no', v_no, 'amount', p_amount, 'allocated', v_alloc, 'unapplied', p_amount - v_alloc, 'entry_id', v_entry);
end $$;

create or replace function public.post_disbursement(
  p_supplier_id uuid, p_amount numeric, p_method text, p_date date, p_allocations jsonb default '[]'::jsonb, p_memo text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := gen_random_uuid(); v_no text; v_entry uuid; v_alloc numeric;
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount_invalid'; end if;
  if p_method not in ('cash','bank') then raise exception 'method_invalid'; end if;
  perform public.assert_period_open(p_date);
  perform 1 from public.suppliers where id = p_supplier_id for update;
  if not found then raise exception 'supplier_not_found'; end if;
  v_no := public.next_doc_no('PV', p_date);
  v_entry := public.post_journal(p_date, 'Chi tiền ' || v_no, jsonb_build_array(
    jsonb_build_object('account', '331', 'debit', p_amount, 'supplier_id', p_supplier_id, 'memo', 'Trả NCC ' || v_no),
    jsonb_build_object('account', public._method_account(p_method), 'credit', p_amount, 'memo', 'Chi ' || v_no)),
    'disbursement', v_id);
  insert into public.payments(id, payment_no, kind, supplier_id, amount, method, pay_date, memo, entry_id, created_by)
  values (v_id, v_no, 'disbursement', p_supplier_id, p_amount, p_method, p_date, p_memo, v_entry, auth.uid());
  v_alloc := public._allocate(v_id, 'disbursement', p_supplier_id, p_allocations);
  return jsonb_build_object('payment_id', v_id, 'payment_no', v_no, 'amount', p_amount, 'allocated', v_alloc, 'unapplied', p_amount - v_alloc, 'entry_id', v_entry);
end $$;

-- allocate (part of) an unapplied payment to documents later
create or replace function public.allocate_payment(p_payment_id uuid, p_allocations jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.payments%rowtype; v_alloc numeric;
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into p from public.payments where id = p_payment_id and voided_at is null for update;
  if not found then raise exception 'payment_not_found_or_voided'; end if;
  v_alloc := public._allocate(p.id, p.kind, coalesce(p.customer_id, p.supplier_id), p_allocations);
  return jsonb_build_object('payment_id', p.id, 'allocated_now', v_alloc);
end $$;

create or replace function public.reverse_payment(p_payment_id uuid, p_date date default current_date, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.payments%rowtype; v_rev uuid;
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into p from public.payments where id = p_payment_id for update;
  if not found then raise exception 'payment_not_found'; end if;
  if p.voided_at is not null then raise exception 'already_voided'; end if;
  perform public.assert_period_open(p_date);
  v_rev := public.reverse_journal(p.entry_id, p_date, 'Hủy chứng từ ' || p.payment_no || coalesce(' — ' || p_reason, ''));
  update public.payments set voided_at = now(), void_entry_id = v_rev where id = p.id;   -- allocations of a voided payment stop counting (views)
  return jsonb_build_object('payment_id', p.id, 'reversal_entry_id', v_rev);
end $$;

-- ------------------------------------------------------------------ stock adjustments & opening -> GL
-- Books movements that have no business document (manual in/out/adjust, count, edit, opening) so GL 156 == stock value.
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
   where coalesce(m.ref_type, '') not in ('sales_invoice','sales_invoice_void','purchase_bill','purchase_bill_void')
     and m.value_delta <> 0
     and not exists (select 1 from public.stock_movement_postings p where p.movement_id = m.id);
  select count(*) into n from _sm_pending;
  if n = 0 then return jsonb_build_object('posted', 0); end if;
  select coalesce(sum(value_delta) filter (where ref_type = 'opening' and value_delta > 0), 0) into v_open from _sm_pending;
  select coalesce(sum(value_delta) filter (where coalesce(ref_type,'') <> 'opening' and value_delta > 0), 0) into v_gain from _sm_pending;
  select coalesce(-sum(value_delta) filter (where value_delta < 0), 0) into v_loss from _sm_pending;
  -- opening reconciliations that are negative are treated like losses
  if v_open > 0 then v_je := v_je || jsonb_build_array(jsonb_build_object('account', '156', 'debit', v_open, 'memo', 'Tồn đầu kỳ'), jsonb_build_object('account', '411', 'credit', v_open, 'memo', 'Tồn đầu kỳ')); end if;
  if v_gain > 0 then v_je := v_je || jsonb_build_array(jsonb_build_object('account', '156', 'debit', v_gain, 'memo', 'Nhập kho không chứng từ'), jsonb_build_object('account', '711', 'credit', v_gain, 'memo', 'Thu nhập khác (thừa kho)')); end if;
  if v_loss > 0 then v_je := v_je || jsonb_build_array(jsonb_build_object('account', '811', 'debit', v_loss, 'memo', 'Hao hụt/điều chỉnh giảm kho'), jsonb_build_object('account', '156', 'credit', v_loss, 'memo', 'Hao hụt/điều chỉnh giảm kho')); end if;
  v_entry := public.post_journal(p_date, 'Ghi nhận điều chỉnh tồn kho', v_je, 'stock_adjustments', null);
  insert into public.stock_movement_postings(movement_id, entry_id) select id, v_entry from _sm_pending;
  return jsonb_build_object('posted', n, 'entry_id', v_entry, 'opening', v_open, 'gain', v_gain, 'loss', v_loss);
end $$;

-- ------------------------------------------------------------------ reports
create or replace function public.vat_report(p_year int, p_month int)
returns table(output_vat numeric, input_vat numeric, payable numeric)
language sql stable security invoker set search_path = public, pg_temp as $$
  with r as (
    select coalesce(sum(l.credit - l.debit) filter (where l.account_code = '3331'), 0) as o,
           coalesce(sum(l.debit - l.credit) filter (where l.account_code = '133'), 0) as i
      from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
     where extract(year from e.entry_date) = p_year and extract(month from e.entry_date) = p_month)
  select o, i, o - i from r
$$;

create or replace function public.vat_by_rate(p_from date, p_to date)
returns table(direction text, vat_rate numeric, taxable numeric, vat numeric)
language sql stable security invoker set search_path = public, pg_temp as $$
  select 'output', l.vat_rate, sum(l.line_net), sum(l.vat_amount)
    from public.sales_invoice_lines l join public.sales_invoices i on i.id = l.invoice_id
   where i.voided_at is null and i.invoice_date between p_from and p_to group by l.vat_rate
  union all
  select 'input', l.vat_rate, sum(l.line_net), sum(l.vat_amount)
    from public.purchase_bill_lines l join public.purchase_bills b on b.id = l.bill_id
   where b.voided_at is null and b.bill_date between p_from and p_to group by l.vat_rate
  order by 1, 2
$$;

create or replace function public.ar_aging(p_as_of date default current_date)
returns table(customer_id uuid, customer_name text, not_due numeric, d1_30 numeric, d31_60 numeric, d61_90 numeric, d90_plus numeric, open_total numeric, unapplied numeric)
language sql stable security invoker set search_path = public, pg_temp as $$
  select c.id, c.name,
    coalesce(sum(o.outstanding) filter (where p_as_of <= o.due_date), 0),
    coalesce(sum(o.outstanding) filter (where p_as_of - o.due_date between 1 and 30), 0),
    coalesce(sum(o.outstanding) filter (where p_as_of - o.due_date between 31 and 60), 0),
    coalesce(sum(o.outstanding) filter (where p_as_of - o.due_date between 61 and 90), 0),
    coalesce(sum(o.outstanding) filter (where p_as_of - o.due_date > 90), 0),
    coalesce(sum(o.outstanding), 0),
    coalesce((select sum(u.unapplied) from public.v_payment_unapplied u where u.customer_id = c.id), 0)
  from public.customers c
  join public.v_sales_invoice_open o on o.customer_id = c.id and o.outstanding > 0 and o.invoice_date <= p_as_of
  group by c.id, c.name order by c.name
$$;

-- Control totals: subledger vs general ledger. Every diff must be 0.
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
$$;

-- ------------------------------------------------------------------ RLS / grants
do $$
declare t text;
begin
  foreach t in array array['sales_invoices','sales_invoice_lines','purchase_bills','purchase_bill_lines','payments','payment_allocations','stock_movement_postings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "staff_read_%I" on public.%I', t, t);
    execute format('create policy "staff_read_%I" on public.%I for select to authenticated using (public.is_staff())', t, t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
  end loop;
end $$;
do $$
declare f text;
begin
  foreach f in array array[
    'public.post_sales_invoice(uuid, date, date, jsonb, text, uuid, boolean)', 'public.reverse_sales_invoice(uuid, date, text)',
    'public.post_purchase_bill(uuid, date, date, jsonb, text, text)', 'public.reverse_purchase_bill(uuid, date, text)',
    'public.post_receipt(uuid, numeric, text, date, jsonb, text)', 'public.post_disbursement(uuid, numeric, text, date, jsonb, text)',
    'public.allocate_payment(uuid, jsonb)', 'public.reverse_payment(uuid, date, text)', 'public.post_stock_adjustments(date)',
    'public.assert_period_open(date)', 'public._allocate(uuid, text, uuid, jsonb)', 'public._method_account(text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  revoke all on function public._allocate(uuid, text, uuid, jsonb) from authenticated;
  revoke all on function public.assert_period_open(date) from authenticated;
end $$;
grant select on public.v_sales_invoice_open, public.v_purchase_bill_open, public.v_payment_unapplied, public.v_ar_by_customer, public.v_ap_by_supplier to authenticated;
revoke all on function public.vat_report(int, int), public.vat_by_rate(date, date), public.ar_aging(date), public.accounting_reconciliation(), public.trial_balance(date, date), public.account_balance(text, date) from public, anon;
grant execute on function public.vat_report(int, int), public.vat_by_rate(date, date), public.ar_aging(date), public.accounting_reconciliation(), public.trial_balance(date, date), public.account_balance(text, date) to authenticated, service_role;
