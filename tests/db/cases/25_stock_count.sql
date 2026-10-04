-- C4: stock_count() (kiểm kê by absolute counted quantity) + v_stock_card
\ir ../_lib.sql
begin;
do $$
declare u uuid := pg_temp.mk_staff(); p uuid := pg_temp.mk_product(100000, 10); r jsonb; e text; q int; n int; v numeric;
begin
  perform pg_temp.act_as('authenticated', u);
  r := public.stock_count(p, 7, 'đếm lại kệ A');
  reset role;
  select stock_qty, stock_value into q, v from public.products where id = p;
  perform pg_temp.rec('CNT-decrease', 'control', pg_temp.ok((r->>'changed')::boolean and (r->>'delta')::int = -3 and q = 7 and v = 700000),
    format('count 7 of 10 -> delta %s, stock %s value %s (expect -3 / 7 / 700,000)', r->>'delta', q, v));
  perform pg_temp.act_as('authenticated', u);
  r := public.stock_count(p, 7);
  perform pg_temp.rec('CNT-noop', 'control', pg_temp.ok(not (r->>'changed')::boolean), 'same count -> no movement written');
  r := public.stock_count(p, 12, null);
  reset role;
  select count(*) into n from public.stock_movements where product_id = p and ref_type = 'stocktake';
  perform pg_temp.rec('CNT-increase', 'control', pg_temp.ok((r->>'delta')::int = 5 and n = 2), 'count 12 -> +5; 2 stocktake movements recorded');
  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try(format('select public.stock_count(%L, -1)', p));
  perform pg_temp.rec('CNT-negative', 'control', pg_temp.ok(e = 'qty_invalid'), e);
  e := pg_temp.try(format('select public.stock_count(%L, 1)', gen_random_uuid()));
  perform pg_temp.rec('CNT-unknown-product', 'control', pg_temp.ok(e = 'product_not_found'), e);
  select running_qty into q from public.v_stock_card where product_id = p order by created_at desc, id desc limit 1;
  perform pg_temp.rec('CNT-stock-card', 'control', pg_temp.ok(q = 12), 'running_qty on the newest card row = ' || q);
  perform pg_temp.act_as('authenticated', gen_random_uuid());
  e := pg_temp.try(format('select public.stock_count(%L, 1)', p));
  perform pg_temp.rec('CNT-nonstaff', 'control', pg_temp.ok(e = 'forbidden'), e);
  perform pg_temp.act_as('anon');
  e := pg_temp.try(format('select public.stock_count(%L, 1)', p));
  reset role;
  perform pg_temp.rec('CNT-anon', 'control', pg_temp.ok(e like 'permission denied%'), e);
end $$;
select current_setting('harness.out');
rollback;
