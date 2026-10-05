-- ============================================================================
-- 0014_hkd_vat_removal.sql — A3: gỡ xung đột VAT/doanh nghiệp khỏi luồng hộ kinh doanh
--
-- Chế độ kế toán `app_settings.accounting_mode`: 'hkd' (mặc định) | 'enterprise' (đường cũ có TK 3331/133, chỉ để tương thích/ kiểm thử).
-- Ở chế độ 'hkd':
--   * KHÔNG phát sinh TK 3331 (VAT đầu ra) và 133 (VAT đầu vào) — trigger trên journal_lines chặn bút toán mới (trừ bút toán đảo);
--     hóa đơn bán/dòng hóa đơn/báo giá có VAT bị từ chối (`vat_not_allowed_hkd`).
--   * Mua hàng: VAT trên chứng từ đầu vào được CỘNG VÀO GIÁ VỐN (Nợ 156 = trước thuế + VAT; Có 331 = tổng), không Nợ 133 (D3).
--   * Nhập kho tay không chứng từ (`stock_adjust` loại 'in', ref 'manual') bị chặn => hàng mua không còn đường vào 711;
--     điều chỉnh tồn do kiểm kê vẫn đi 711/811 như cũ.
--   * Báo giá -> đơn bán dùng `post_sale_hkd` (giá đã gồm thuế, nhóm ngành, snapshot thuế).
-- Forward-only, idempotent. Cần 0004–0013.
-- ============================================================================

-- ---------------------------------------------------------------- cấu hình ứng dụng
create table if not exists public.app_settings (
  key        text primary key check (key ~ '^[a-z_]{2,60}$'),
  value      text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.app_settings enable row level security;
drop policy if exists "staff_read_app_settings" on public.app_settings;
create policy "staff_read_app_settings" on public.app_settings for select to authenticated using ((select public.is_staff()));
revoke all on public.app_settings from anon;
revoke insert, update, delete, truncate on public.app_settings from authenticated;
insert into public.app_settings(key, value) values ('accounting_mode', 'hkd') on conflict (key) do nothing;

create or replace function public.accounting_mode()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select value from public.app_settings where key = 'accounting_mode'), 'hkd')
$$;

create or replace function public.set_accounting_mode(p_mode text, p_reason text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old text := public.accounting_mode();
begin
  if not (select public.is_owner()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_mode not in ('hkd', 'enterprise') then raise exception 'accounting_mode_invalid'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'reason_required'; end if;
  insert into public.app_settings(key, value, updated_by) values ('accounting_mode', p_mode, (select auth.uid()))
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
  insert into public.accounting_audit(actor, action, detail)
  values ((select auth.uid()), 'set_accounting_mode', jsonb_build_object('from', v_old, 'to', p_mode, 'reason', btrim(p_reason)));
  return p_mode;
end $$;

-- ---------------------------------------------------------------- chặn VAT ở chế độ HKD
create or replace function public.trg_hkd_no_vat()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare j jsonb := to_jsonb(new); o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
begin
  if public.accounting_mode() <> 'hkd' then return new; end if;
  if tg_table_name = 'sales_invoices' and coalesce((j->>'vat_amount')::numeric, 0) <> 0 then
    raise exception 'vat_not_allowed_hkd' using errcode = '23514';
  elsif tg_table_name = 'sales_invoice_lines' and (coalesce((j->>'vat_rate')::numeric, 0) <> 0 or coalesce((j->>'vat_amount')::numeric, 0) <> 0) then
    raise exception 'vat_not_allowed_hkd' using errcode = '23514';
  elsif tg_table_name = 'quotations' and coalesce((j->>'vat')::numeric, 0) <> 0 and (tg_op = 'INSERT' or (j->>'vat') is distinct from (o->>'vat')) then
    raise exception 'vat_not_allowed_hkd' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists trg_hkd_no_vat on public.sales_invoices;
create trigger trg_hkd_no_vat before insert on public.sales_invoices for each row execute function public.trg_hkd_no_vat();
drop trigger if exists trg_hkd_no_vat on public.sales_invoice_lines;
create trigger trg_hkd_no_vat before insert on public.sales_invoice_lines for each row execute function public.trg_hkd_no_vat();
drop trigger if exists trg_hkd_no_vat on public.quotations;
create trigger trg_hkd_no_vat before insert or update on public.quotations for each row execute function public.trg_hkd_no_vat();

-- không có bút toán mới nào chạm 3331/133 (bút toán đảo của chứng từ cũ vẫn được phép)
create or replace function public.trg_hkd_no_vat_accounts()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.account_code in ('133', '3331') and public.accounting_mode() = 'hkd'
     and not exists (select 1 from public.journal_entries e where e.id = new.entry_id and e.reverses_id is not null) then
    raise exception 'vat_account_not_allowed_hkd: TK % không dùng ở chế độ hộ kinh doanh', new.account_code using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists trg_hkd_no_vat_accounts on public.journal_lines;
create trigger trg_hkd_no_vat_accounts before insert on public.journal_lines for each row execute function public.trg_hkd_no_vat_accounts();

revoke execute on function public.trg_hkd_no_vat() from public, anon, authenticated;
revoke execute on function public.trg_hkd_no_vat_accounts() from public, anon, authenticated;

-- ---------------------------------------------------------------- nhập kho: bắt buộc có chứng từ mua
create or replace function public.stock_adjust(
  p_product_id uuid, p_type public.stock_movement_type, p_qty integer,
  p_unit_cost numeric default null, p_ref_type text default null, p_ref_id uuid default null,
  p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cur integer; v_delta integer; v_id uuid;
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_qty is null or p_qty = 0 or (p_type in ('in','out') and p_qty < 0) then raise exception 'qty_invalid'; end if;
  -- HKD: hàng mua phải đi qua chứng từ mua (post_purchase_bill); nhập tay không chứng từ sẽ rơi vào 711 (thu nhập khác) — chặn.
  -- Loại 'in' chỉ còn dùng cho tồn đầu kỳ (ref 'opening' -> vốn chủ sở hữu 411). Kiểm kê (loại 'adjust') vẫn đi 711/811.
  if p_type = 'in' and coalesce(p_ref_type, '') <> 'opening' and public.accounting_mode() = 'hkd' then
    raise exception 'stock_in_requires_purchase_bill';
  end if;
  select stock_qty into v_cur from public.products where id = p_product_id for update;
  if not found then raise exception 'product_not_found'; end if;
  v_delta := case when p_type = 'out' then -p_qty else p_qty end;
  if v_cur + v_delta < 0 then
    raise exception 'insufficient_stock' using detail = format('have %s, need %s', v_cur, -v_delta);
  end if;
  insert into public.stock_movements(product_id, type, qty, unit_cost, ref_type, ref_id, notes, created_by)
  values (p_product_id, p_type, p_qty, p_unit_cost, p_ref_type, p_ref_id, p_notes, (select auth.uid()))
  returning id into v_id;
  return jsonb_build_object('movement_id', v_id, 'stock_qty', v_cur + v_delta);
end $$;

-- ---------------------------------------------------------------- mua hàng có chứng từ: VAT cộng vào giá vốn (D3)
create or replace function public.post_purchase_bill(
  p_supplier_id uuid, p_bill_date date, p_due_date date, p_lines jsonb,
  p_supplier_ref text default null, p_memo text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := gen_random_uuid(); v_no text; v_due date := coalesce(p_due_date, p_bill_date); l jsonb; i int := 0;
  v_pid uuid; v_qty int; v_cost numeric; v_rate numeric; v_net numeric; v_vat numeric; v_sub numeric := 0; v_vat_t numeric := 0; v_total numeric;
  v_entry uuid; v_je jsonb; v_mid uuid; v_rows jsonb := '[]'::jsonb; v_hkd boolean := public.accounting_mode() = 'hkd'; v_stock numeric;
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
    v_stock := case when v_hkd then v_net + v_vat else v_net end;           -- HKD: VAT đầu vào là một phần giá vốn hàng tồn
    insert into public.stock_movements(product_id, type, qty, unit_cost, value_delta, ref_type, ref_id, notes, created_by)
    values (v_pid, 'in', v_qty, round(v_stock / v_qty, 2), v_stock, 'purchase_bill', v_id, 'Nhập mua ' || v_no, (select auth.uid())) returning id into v_mid;
    v_rows := v_rows || jsonb_build_object('line_no', i, 'product_id', v_pid, 'qty', v_qty, 'unit_cost', v_cost, 'vat_rate', v_rate, 'line_net', v_net, 'vat_amount', v_vat, 'movement_id', v_mid);
  end loop;
  v_total := v_sub + v_vat_t;
  if v_total <= 0 then raise exception 'total_must_be_positive'; end if;
  if v_hkd then
    v_je := jsonb_build_array(jsonb_build_object('account', '156', 'debit', v_total, 'memo', 'Nhập hàng (giá vốn gồm VAT đầu vào) ' || v_no));
  else
    v_je := jsonb_build_array(jsonb_build_object('account', '156', 'debit', v_sub, 'memo', 'Nhập hàng ' || v_no));
    if v_vat_t > 0 then v_je := v_je || jsonb_build_object('account', '133', 'debit', v_vat_t, 'memo', 'VAT đầu vào ' || v_no); end if;
  end if;
  v_je := v_je || jsonb_build_object('account', '331', 'credit', v_total, 'supplier_id', p_supplier_id, 'memo', 'Phải trả ' || v_no);
  v_entry := public.post_journal(p_bill_date, 'Mua hàng ' || v_no, v_je, 'purchase_bill', v_id);
  insert into public.purchase_bills(id, bill_no, supplier_ref, supplier_id, bill_date, due_date, subtotal, vat_amount, total, memo, entry_id, created_by)
  values (v_id, v_no, p_supplier_ref, p_supplier_id, p_bill_date, v_due, v_sub, v_vat_t, v_total, p_memo, v_entry, (select auth.uid()));
  for l in select * from jsonb_array_elements(v_rows) loop
    insert into public.purchase_bill_lines(bill_id, line_no, product_id, qty, unit_cost, vat_rate, line_net, vat_amount, movement_id)
    values (v_id, (l->>'line_no')::int, (l->>'product_id')::uuid, (l->>'qty')::int, (l->>'unit_cost')::numeric,
            (l->>'vat_rate')::numeric, (l->>'line_net')::numeric, (l->>'vat_amount')::numeric, (l->>'movement_id')::uuid);
  end loop;
  return jsonb_build_object('bill_id', v_id, 'bill_no', v_no, 'subtotal', v_sub, 'vat', v_vat_t, 'total', v_total, 'entry_id', v_entry,
                            'vat_in_cost', case when v_hkd then v_vat_t else 0 end);
end $$;

-- hủy phiếu mua: hoàn kho đúng GIÁ TRỊ đã nhập của từng dòng (gồm VAT trong giá vốn ở chế độ HKD)
create or replace function public.reverse_purchase_bill(p_bill_id uuid, p_date date default current_date, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.purchase_bills%rowtype; v_rev uuid; r record; v_cur int; v_val numeric;
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
    select coalesce(m.value_delta, r.line_net) into v_val from public.stock_movements m where m.id = r.movement_id;
    insert into public.stock_movements(product_id, type, qty, value_delta, ref_type, ref_id, notes, created_by)
    values (r.product_id, 'out', r.qty, -coalesce(v_val, r.line_net), 'purchase_bill_void', b.id, 'Xuất trả do hủy ' || b.bill_no, (select auth.uid()));
  end loop;
  update public.purchase_bills set voided_at = now(), void_entry_id = v_rev where id = b.id;
  return jsonb_build_object('bill_id', b.id, 'reversal_entry_id', v_rev);
end $$;

-- ---------------------------------------------------------------- bán hàng: post_sale_hkd nhận thêm liên kết báo giá
drop function if exists public.post_sale_hkd(uuid, date, jsonb, jsonb, text, uuid, jsonb, text, date, jsonb, boolean);
-- (0014: + p_quotation_id — hóa đơn tạo từ báo giá)
-- p_lines   : [{"product_id":uuid|null,"description":text,"qty":int,"unit_price":num (ĐÃ GỒM THUẾ),"discount_pct":num,"discount_amount":num,"tax_group":text}]
-- p_payments: [{"method":"cash"|"bank","amount":num,"note":text}]   Σ <= tổng; phần dư = công nợ (chỉ khách có tên)
-- p_einvoice: {"symbol","number","lookup_code","lookup_url","provider","issued_on"} (tùy chọn, hóa đơn điện tử đã phát hành ở hệ thống ngoài)
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


-- ---------------------------------------------------------------- báo giá -> đơn bán
create or replace function public.invoice_from_quotation(
  p_quotation_id uuid, p_invoice_date date, p_due_date date default null, p_allow_over_limit boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  q public.quotations%rowtype; it record; v_lines jsonb := '[]'::jsonb; v_base numeric; v_rate numeric;
  v_eff numeric; v_res jsonb; n int := 0; v_hkd boolean := public.accounting_mode() = 'hkd';
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into q from public.quotations where id = p_quotation_id for update;
  if not found then raise exception 'quotation_not_found'; end if;
  if q.status <> 'approved' then raise exception 'quotation_not_approved'; end if;
  if q.customer_id is null then raise exception 'customer_required_for_invoice'; end if;
  if exists (select 1 from public.sales_invoices where quotation_id = q.id and voided_at is null) then
    raise exception 'quotation_already_invoiced';
  end if;
  v_base := q.subtotal - q.discount;
  if v_base <= 0 then raise exception 'total_must_be_positive'; end if;
  v_rate := case when v_base = 0 then 0 else round(q.vat * 100 / v_base, 2) end;
  if v_hkd and q.vat <> 0 then raise exception 'vat_not_allowed_hkd: báo giá % có VAT, hãy lập báo giá mới với giá đã gồm thuế', q.code; end if;
  if v_rate not in (0, 5, 8, 10) then raise exception 'vat_rate_unknown: %', v_rate; end if;
  for it in select qi.*, p.name as pname from public.quotation_items qi left join public.products p on p.id = qi.product_id
             where qi.quotation_id = q.id order by qi.id loop
    n := n + 1;
    if it.qty <> trunc(it.qty) then raise exception 'qty_not_integer: line %', n; end if;
    -- the quotation-level discount is spread proportionally over the lines
    v_eff := round((1 - (1 - it.discount / 100) * (1 - case when q.subtotal = 0 then 0 else q.discount / q.subtotal end)) * 100, 6);
    v_lines := v_lines || jsonb_build_array(
      case when v_hkd
        then jsonb_build_object('product_id', it.product_id, 'description', coalesce(it.notes, it.pname, 'Hàng hóa/dịch vụ'), 'qty', it.qty::int, 'unit_price', it.unit_price, 'discount_pct', v_eff)
        else jsonb_build_object('product_id', it.product_id, 'description', coalesce(it.notes, it.pname, 'Hàng hóa/dịch vụ'), 'qty', it.qty::int, 'unit_price', it.unit_price, 'discount_pct', v_eff, 'vat_rate', v_rate)
      end);
  end loop;
  if n = 0 then raise exception 'lines_required'; end if;
  if v_hkd then
    -- chế độ HKD: giá báo giá đã gồm thuế; đơn bán nguyên tử, chưa thu tiền (công nợ khách có tên), có nhóm ngành + snapshot thuế
    v_res := public.post_sale_hkd(q.customer_id, p_invoice_date, v_lines, '[]'::jsonb, 'store', null, null, 'Từ báo giá ' || q.code,
                                  p_due_date, null, p_allow_over_limit, q.id);
  else
    v_res := public.post_sales_invoice(q.customer_id, p_invoice_date, p_due_date, v_lines, 'Từ báo giá ' || q.code, q.id, p_allow_over_limit);
  end if;
  if abs((v_res->>'total')::numeric - q.total) > 1 then
    raise exception 'amount_mismatch: invoice % vs quotation %', v_res->>'total', q.total;
  end if;
  return v_res || jsonb_build_object('quotation_code', q.code);
end $$;

-- ---------------------------------------------------------------- grants
do $$
declare f text;
begin
  foreach f in array array[
    'public.post_sale_hkd(uuid, date, jsonb, jsonb, text, uuid, jsonb, text, date, jsonb, boolean, uuid)',
    'public.invoice_from_quotation(uuid, date, date, boolean)', 'public.post_purchase_bill(uuid, date, date, jsonb, text, text)',
    'public.reverse_purchase_bill(uuid, date, text)', 'public.accounting_mode()', 'public.set_accounting_mode(text, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  revoke all on function public.stock_adjust(uuid, public.stock_movement_type, integer, numeric, text, uuid, text) from public, anon;
  grant execute on function public.stock_adjust(uuid, public.stock_movement_type, integer, numeric, text, uuid, text) to authenticated, service_role;
end $$;
