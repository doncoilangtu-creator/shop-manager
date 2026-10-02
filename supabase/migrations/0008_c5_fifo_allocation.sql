-- 0008 (C5): receipt / disbursement that settles the OLDEST open documents first (FIFO), atomically.
-- Serialised per customer / supplier by locking the partner row, so two cashiers cannot both allocate
-- the same outstanding amount. Whatever is left after all documents are settled stays as unapplied credit.
create or replace function public.post_receipt_fifo(
  p_customer_id uuid, p_amount numeric, p_method text, p_date date, p_memo text default null)
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
  return public.post_receipt(p_customer_id, p_amount, p_method, p_date, v_alloc, p_memo);
end $$;

create or replace function public.post_disbursement_fifo(
  p_supplier_id uuid, p_amount numeric, p_method text, p_date date, p_memo text default null)
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
  return public.post_disbursement(p_supplier_id, p_amount, p_method, p_date, v_alloc, p_memo);
end $$;

revoke all on function public.post_receipt_fifo(uuid, numeric, text, date, text), public.post_disbursement_fifo(uuid, numeric, text, date, text) from public, anon;
grant execute on function public.post_receipt_fifo(uuid, numeric, text, date, text), public.post_disbursement_fifo(uuid, numeric, text, date, text) to authenticated, service_role;
