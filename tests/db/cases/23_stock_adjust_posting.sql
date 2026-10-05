-- Document-less stock movements are booked to the GL by post_stock_adjustments() (rolled back)
\ir ../_lib.sql
begin;
select pg_temp.set_mode('enterprise'); -- legacy (pre-0014) behaviour under test; the HKD default is covered by case 32
do $$
declare u uuid := pg_temp.mk_staff(); p uuid := pg_temp.mk_product(0, 0); r jsonb; d numeric; e text; n int;
begin
  perform pg_temp.act_as('authenticated', u);
  perform public.post_stock_adjustments('2025-07-01');            -- flush anything pending from fixtures
  reset role;
  select diff into d from public.accounting_reconciliation() where check_name like 'Inventory%';
  perform pg_temp.rec('ADJ-baseline', 'control', pg_temp.ok(d = 0), 'inventory GL = stock value after flush, diff=' || d);
  perform pg_temp.act_as('service_role');
  perform public.stock_adjust(p, 'in', 100, 50000);
  perform public.stock_adjust(p, 'out', 10, null, 'manual', null, 'hỏng');
  reset role;
  select diff into d from public.accounting_reconciliation() where check_name like 'Inventory%';
  perform pg_temp.rec('ADJ-gap-visible', 'control', pg_temp.ok(d = -4500000), 'unposted stock movements appear in reconciliation: diff=' || d || ' (expect -4,500,000)');
  perform pg_temp.act_as('authenticated', u);
  r := public.post_stock_adjustments('2025-07-02');
  reset role;
  select diff into d from public.accounting_reconciliation() where check_name like 'Inventory%';
  perform pg_temp.rec('ADJ-posted', 'control', pg_temp.ok(d = 0 and (r->>'posted')::int = 2 and (r->>'gain')::numeric = 5000000 and (r->>'loss')::numeric = 500000 and pg_temp.bal('711') = 5000000 and pg_temp.bal('811') = 500000),
    format('posted=%s gain=%s loss=%s; 711=%s 811=%s; diff=%s', r->>'posted', r->>'gain', r->>'loss', pg_temp.bal('711'), pg_temp.bal('811'), d));
  perform pg_temp.act_as('authenticated', u);
  r := public.post_stock_adjustments('2025-07-03');
  perform pg_temp.rec('ADJ-idempotent', 'control', pg_temp.ok((r->>'posted')::int = 0), 'second call posts nothing');
  perform pg_temp.act_as('anon');
  e := pg_temp.try('select public.post_stock_adjustments()');
  reset role;
  perform pg_temp.rec('ADJ-anon', 'control', pg_temp.ok(e like 'permission denied%'), e);
end $$;
select current_setting('harness.out');
rollback;
