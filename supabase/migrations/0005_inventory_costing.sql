-- ============================================================================
-- 0005_inventory_costing.sql — moving-average inventory valuation on the stock ledger
--
-- * stock_movements.value_delta : value (VND) added to / removed from stock by the movement,
--   computed ONCE at insert time (BEFORE INSERT trigger) and immutable afterwards
-- * products.stock_value        : cache = sum(value_delta); avg_cost = stock_value / stock_qty
-- * OUT movements are costed at the current average; the last unit takes the remainder so
--   stock_value hits exactly 0 with stock_qty (no rounding drift between GL 156 and stock)
-- * v_inventory_valuation / v_stock_value_mismatch (must be empty)
-- Idempotent. Requires 0003.
-- ============================================================================
alter table public.products add column if not exists stock_value numeric(16,2) not null default 0;
alter table public.stock_movements add column if not exists value_delta numeric(16,2);

-- one-off backfill of legacy movements (value at the movement's unit_cost, falling back to the product cost_price)
do $$
begin
  if exists (select 1 from public.stock_movements where value_delta is null) then
    alter table public.stock_movements disable trigger trg_stock_movements_no_update;
    update public.stock_movements m
       set value_delta = round(m.qty_delta * coalesce(m.unit_cost, p.cost_price, 0), 2)
      from public.products p
     where p.id = m.product_id and m.value_delta is null;
    alter table public.stock_movements enable trigger trg_stock_movements_no_update;
    -- legacy data could carry a negative value for a net-zero or negative stock; clamp at the product level below
    perform set_config('app.stock_internal', '1', true);
    update public.products p
       set stock_value = coalesce((select sum(value_delta) from public.stock_movements m where m.product_id = p.id), 0);
    perform set_config('app.stock_internal', '0', true);
  end if;
end $$;
alter table public.stock_movements alter column value_delta set not null;
-- (a NOT NULL on a column added in this file cannot be set before the backfill above; enforced here)

-- costing trigger (BEFORE INSERT): fills unit_cost for OUT and value_delta for everything unless the
-- caller (an internal SECURITY DEFINER function) supplied an explicit value_delta.
create or replace function public.trg_stock_movement_costing()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.products%rowtype; d integer;
begin
  if new.value_delta is not null then return new; end if;   -- explicit (e.g. reversal at original cost)
  d := case when new.type = 'out' then -new.qty else new.qty end;   -- generated column qty_delta is not computed yet in BEFORE triggers
  select * into p from public.products where id = new.product_id;
  if d >= 0 then
    new.value_delta := round(d * coalesce(new.unit_cost, case when p.stock_qty > 0 then p.stock_value / p.stock_qty else p.cost_price end, 0), 2);
  else
    if p.stock_qty + d <= 0 then
      new.value_delta := -p.stock_value;                    -- last units take the remainder (no rounding drift)
    else
      new.value_delta := -round(p.stock_value * (-d)::numeric / p.stock_qty, 2);
    end if;
    if new.type = 'out' and new.unit_cost is null and new.qty > 0 then
      new.unit_cost := round((-new.value_delta) / new.qty, 4);
    end if;
  end if;
  return new;
end $$;
-- BEFORE INSERT triggers fire alphabetically: "trg_stock_movement_costing" runs before "trg_stock_movement_apply" (AFTER)
drop trigger if exists trg_stock_movement_costing on public.stock_movements;
create trigger trg_stock_movement_costing before insert on public.stock_movements
  for each row execute function public.trg_stock_movement_costing();

-- apply trigger now also maintains stock_value
create or replace function public.trg_stock_movement_apply()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(current_setting('app.skip_stock_apply', true), '') = '1' then return new; end if;
  perform set_config('app.stock_internal', '1', true);
  update public.products set stock_qty = stock_qty + new.qty_delta, stock_value = stock_value + new.value_delta
   where id = new.product_id;
  perform set_config('app.stock_internal', '0', true);
  return new;
end $$;

-- stock_value is guarded exactly like stock_qty
create or replace function public.trg_products_stock_guard()
returns trigger language plpgsql as $$
begin
  if (new.stock_qty is distinct from old.stock_qty or new.stock_value is distinct from old.stock_value)
     and coalesce(current_setting('app.stock_internal', true), '') <> '1' then
    raise exception 'products.stock_qty/stock_value can only change through stock_movements (use stock_adjust())' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_products_stock_guard on public.products;
create trigger trg_products_stock_guard before update of stock_qty, stock_value on public.products
  for each row execute function public.trg_products_stock_guard();

-- the opening-stock trigger must also reset stock_value before posting the opening movement
create or replace function public.trg_products_opening_stock()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.stock_qty <> 0 then
    perform set_config('app.stock_internal', '1', true);
    update public.products set stock_qty = 0, stock_value = 0 where id = new.id;
    perform set_config('app.stock_internal', '0', true);
    insert into public.stock_movements(product_id, type, qty, unit_cost, ref_type, notes)
    values (new.id, 'adjust', new.stock_qty, new.cost_price, 'opening', 'Tồn đầu khi tạo sản phẩm');
  end if;
  return new;
end $$;

-- value must be consistent with the ledger
create or replace view public.v_stock_value_mismatch with (security_invoker = true) as
  select p.id as product_id, p.sku, p.stock_value, coalesce(sum(m.value_delta), 0)::numeric(16,2) as ledger_value
    from public.products p left join public.stock_movements m on m.product_id = p.id
   group by p.id, p.sku, p.stock_value
  having p.stock_value <> coalesce(sum(m.value_delta), 0);

create or replace view public.v_inventory_valuation with (security_invoker = true) as
  select p.id as product_id, p.sku, p.name, p.stock_qty, p.stock_value,
         case when p.stock_qty > 0 then round(p.stock_value / p.stock_qty, 4) else 0 end as avg_cost
    from public.products p;
grant select on public.v_inventory_valuation, public.v_stock_value_mismatch to authenticated;
