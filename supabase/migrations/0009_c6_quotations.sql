-- 0009 (C6): quotation workflow integrity, private PDF storage, approved quotation -> sales invoice.
--  * status FSM trigger (draft->sent; sent->approved|rejected|draft; rejected->draft; approved is final)
--  * content frozen once the quotation left 'draft' (totals/customer/items cannot be edited behind the customer's back)
--  * quotations.pdf_path (object path in the PRIVATE bucket); links are signed on demand, never stored public
--  * invoice_from_quotation(): approved quotation -> post_sales_invoice(), at most once per quotation
alter table public.quotations add column if not exists pdf_path text;

create or replace function public.trg_quotation_guard()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if not ((old.status = 'draft'    and new.status = 'sent')
         or (old.status = 'sent'     and new.status in ('approved', 'rejected', 'draft'))
         or (old.status = 'rejected' and new.status = 'draft')) then
      raise exception 'quotation_status_transition: % -> %', old.status, new.status using errcode = '23514';
    end if;
  end if;
  if old.status <> 'draft' and (
       new.customer_id is distinct from old.customer_id or new.valid_until is distinct from old.valid_until
    or new.notes is distinct from old.notes or new.subtotal is distinct from old.subtotal
    or new.discount is distinct from old.discount or new.vat is distinct from old.vat or new.total is distinct from old.total
    or new.code is distinct from old.code) then
    raise exception 'quotation_not_draft: content is frozen after sending' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists trg_quotation_guard on public.quotations;
create trigger trg_quotation_guard before update on public.quotations
  for each row execute function public.trg_quotation_guard();

create or replace function public.trg_quotation_items_guard()
returns trigger language plpgsql as $$
declare v_status public.quotation_status; v_qid uuid := coalesce(new.quotation_id, old.quotation_id);
begin
  select status into v_status from public.quotations where id = v_qid;
  if not found then return coalesce(new, old); end if;            -- parent already gone (cascade)
  if tg_op = 'DELETE' and v_status in ('draft', 'rejected') then return old; end if;
  if v_status <> 'draft' then
    raise exception 'quotation_not_draft: items are frozen after sending' using errcode = '23514';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_quotation_items_guard on public.quotation_items;
create trigger trg_quotation_items_guard before insert or update or delete on public.quotation_items
  for each row execute function public.trg_quotation_items_guard();

-- private bucket (Supabase only; harmless where the storage schema does not exist)
do $$ begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets set public = false where id = 'quotations';
  end if;
end $$;

-- approved quotation -> sales invoice (stock out + ledger entries happen inside post_sales_invoice)
create or replace function public.invoice_from_quotation(
  p_quotation_id uuid, p_invoice_date date, p_due_date date default null, p_allow_over_limit boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  q public.quotations%rowtype; it record; v_lines jsonb := '[]'::jsonb; v_base numeric; v_rate numeric;
  v_eff numeric; v_res jsonb; n int := 0;
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
  if v_rate not in (0, 5, 8, 10) then raise exception 'vat_rate_unknown: %', v_rate; end if;
  for it in select qi.*, p.name as pname from public.quotation_items qi left join public.products p on p.id = qi.product_id
             where qi.quotation_id = q.id order by qi.id loop
    n := n + 1;
    if it.qty <> trunc(it.qty) then raise exception 'qty_not_integer: line %', n; end if;
    -- the quotation-level discount is spread proportionally over the lines
    v_eff := round((1 - (1 - it.discount / 100) * (1 - case when q.subtotal = 0 then 0 else q.discount / q.subtotal end)) * 100, 6);
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_id', it.product_id, 'description', coalesce(it.notes, it.pname, 'Hàng hóa/dịch vụ'),
      'qty', it.qty::int, 'unit_price', it.unit_price, 'discount_pct', v_eff, 'vat_rate', v_rate));
  end loop;
  if n = 0 then raise exception 'lines_required'; end if;
  v_res := public.post_sales_invoice(q.customer_id, p_invoice_date, p_due_date, v_lines, 'Từ báo giá ' || q.code, q.id, p_allow_over_limit);
  if abs((v_res->>'total')::numeric - q.total) > 1 then
    raise exception 'amount_mismatch: invoice % vs quotation %', v_res->>'total', q.total;
  end if;
  return v_res || jsonb_build_object('quotation_code', q.code);
end $$;
revoke all on function public.invoice_from_quotation(uuid, date, date, boolean) from public, anon;
grant execute on function public.invoice_from_quotation(uuid, date, date, boolean) to authenticated, service_role;
