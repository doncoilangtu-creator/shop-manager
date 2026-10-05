-- C2/C4: stock ledger invariants and stock_adjust() RPC
\ir ../_lib.sql
begin;
select pg_temp.set_mode('enterprise'); -- legacy (pre-0014) behaviour under test; the HKD default is covered by case 32
do $$
declare p uuid; p2 uuid; u uuid := pg_temp.mk_staff(); stranger uuid := gen_random_uuid(); r jsonb; e text; n int; q int; mm int;
begin
  insert into public.products(sku, name, stock_qty, cost_price) values ('LED-' || gen_random_uuid(), 'Ledger P', 5, 100) returning id into p;
  select count(*) into n from public.stock_movements where product_id = p and ref_type = 'opening';
  select stock_qty into q from public.products where id = p;
  perform pg_temp.rec('STK-opening', 'control', case when n = 1 and q = 5 then 'OK' else 'FAIL' end, format('product created with stock 5 -> %s opening movement, stock_qty=%s', n, q));

  perform pg_temp.act_as('authenticated', u);
  r := public.stock_adjust(p, 'in', 10, 120, 'manual', null, 'nhap');
  r := public.stock_adjust(p, 'out', 3, null, 'sale', null, 'ban');
  e := pg_temp.try(format('select public.stock_adjust(%L, ''out'', 100)', p));
  reset role;
  select stock_qty into q from public.products where id = p;
  perform pg_temp.rec('STK-in-out', 'control', case when q = 12 and (r->>'stock_qty')::int = 12 then 'OK' else 'FAIL' end, format('5 +10 -3 = %s', q));
  perform pg_temp.rec('STK-insufficient', 'control', case when e = 'insufficient_stock' then 'OK' else 'FAIL' end, 'out 100 with 12 on hand -> ' || e);

  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try(format('select public.stock_adjust(%L, ''in'', -1)', p));
  perform pg_temp.rec('STK-neg-qty', 'control', case when e = 'qty_invalid' then 'OK' else 'FAIL' end, 'in with qty -1 -> ' || e);
  e := pg_temp.try(format('select public.stock_adjust(%L, ''adjust'', -20)', p));
  perform pg_temp.rec('STK-adjust-below-zero', 'control', case when e = 'insufficient_stock' then 'OK' else 'FAIL' end, 'adjust -20 -> ' || e);
  r := public.stock_adjust(p, 'adjust', -2, null, 'count', null, 'kiem ke');
  e := pg_temp.try(format('update public.products set stock_qty = 999 where id = %L', p));
  perform pg_temp.rec('STK-direct-update', 'control', case when e like 'products.stock_qty%can only change%' then 'OK' else 'FAIL' end, 'direct UPDATE of stock_qty -> ' || left(e, 70));
  e := pg_temp.try(format('update public.products set name = ''renamed'', stock_qty = stock_qty where id = %L', p));
  perform pg_temp.rec('STK-update-other-cols', 'control', case when e = 'OK' then 'OK' else 'FAIL' end, 'updating other columns still works: ' || e);
  e := pg_temp.try(format('insert into public.stock_movements(product_id, type, qty) values (%L, ''in'', 1)', p));
  perform pg_temp.rec('STK-no-direct-ledger-insert', 'control', case when e like 'permission denied%' or e like 'new row violates%' then 'OK' else 'FAIL' end, 'staff direct INSERT into stock_movements -> ' || left(e, 70));
  reset role;

  select stock_qty into q from public.products where id = p;
  select count(*) into mm from public.v_stock_mismatch;
  perform pg_temp.rec('STK-invariant', 'control', case when q = 10 and mm = 0 then 'OK' else 'FAIL' end, format('stock_qty=%s equals ledger sum, mismatching products=%s', q, mm));

  e := pg_temp.try(format('update public.stock_movements set qty = 99 where product_id = %L', p));
  perform pg_temp.rec('STK-ledger-no-update', 'control', case when e like 'stock_movements is append-only%' then 'OK' else 'FAIL' end, e);
  e := pg_temp.try(format('delete from public.stock_movements where product_id = %L', p));
  perform pg_temp.rec('STK-ledger-no-delete', 'control', case when e like 'stock_movements is append-only%' then 'OK' else 'FAIL' end, e);
  e := pg_temp.try(format('delete from public.products where id = %L', p));
  perform pg_temp.rec('STK-product-delete-blocked', 'control', case when e like '%violates foreign key%' then 'OK' else 'FAIL' end, 'deleting a product that has ledger rows -> ' || left(e, 60));

  perform pg_temp.act_as('authenticated', stranger);
  e := pg_temp.try(format('select public.stock_adjust(%L, ''in'', 1)', p));
  reset role;
  perform pg_temp.rec('STK-nonstaff-denied', 'control', case when e = 'forbidden' then 'OK' else 'FAIL' end, 'non-staff authenticated -> ' || e);
  perform pg_temp.act_as('anon');
  e := pg_temp.try(format('select public.stock_adjust(%L, ''in'', 1)', p));
  reset role;
  perform pg_temp.rec('STK-anon-denied', 'control', case when e like 'permission denied%' then 'OK' else 'FAIL' end, 'anon -> ' || e);
  perform pg_temp.act_as('service_role');
  r := public.stock_adjust(p, 'in', 1);
  reset role;
  perform pg_temp.rec('STK-service-ok', 'control', case when (r->>'stock_qty')::int = 11 then 'OK' else 'FAIL' end, 'service_role (bot/admin client) allowed');
end $$;
select current_setting('harness.out');
rollback;
