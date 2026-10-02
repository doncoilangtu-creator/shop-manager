-- 0007 (C4): stocktake (kiểm kê) by absolute counted quantity, atomic.
-- The old edit form sent an absolute quantity, the server computed `delta = new - current` from a stale read
-- and then adjusted: two concurrent edits / sales between read and write produced a wrong stock.
-- stock_count() takes the row lock first, so the delta is computed against the real current stock.
create or replace function public.stock_count(p_product_id uuid, p_counted integer, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cur integer; v_delta integer; v_res jsonb;
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'qty_invalid'; end if;
  select stock_qty into v_cur from public.products where id = p_product_id for update;
  if not found then raise exception 'product_not_found'; end if;
  v_delta := p_counted - v_cur;
  if v_delta = 0 then
    return jsonb_build_object('changed', false, 'stock_qty', v_cur, 'delta', 0);
  end if;
  v_res := public.stock_adjust(p_product_id, 'adjust', v_delta, null, 'stocktake', null,
                               coalesce(nullif(btrim(p_notes), ''), 'Kiểm kê'));
  return v_res || jsonb_build_object('changed', true, 'delta', v_delta, 'previous', v_cur);
end $$;
revoke all on function public.stock_count(uuid, integer, text) from public, anon;
grant execute on function public.stock_count(uuid, integer, text) to authenticated, service_role;

-- stock card for the product page (newest first) with running quantity
create or replace view public.v_stock_card with (security_invoker = true) as
  select m.id, m.product_id, m.created_at, m.type, m.qty, m.qty_delta, m.unit_cost, m.value_delta,
         m.ref_type, m.notes,
         sum(m.qty_delta) over (partition by m.product_id order by m.created_at, m.id) as running_qty
    from public.stock_movements m;
grant select on public.v_stock_card to authenticated, service_role;
