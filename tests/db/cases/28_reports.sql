-- C8: dashboard / report aggregates (GL based, voided invoices netted, staff-only)
\ir ../_lib.sql
begin;
do $$
declare u uuid := pg_temp.mk_staff(); nu uuid := gen_random_uuid(); c1 uuid := pg_temp.mk_customer(); c2 uuid := pg_temp.mk_customer();
  s uuid := pg_temp.mk_supplier(); p1 uuid := pg_temp.mk_product(0, 0); p2 uuid := pg_temp.mk_product(0, 0);
  inv jsonb; d0 jsonb; d1 jsonb; e text; r record; n int;
begin
  perform pg_temp.act_as('authenticated', u);
  perform public.post_purchase_bill(s, '2031-02-01', null, jsonb_build_array(
    jsonb_build_object('product_id', p1, 'qty', 100, 'unit_cost', 1000), jsonb_build_object('product_id', p2, 'qty', 100, 'unit_cost', 1000)));
  perform public.post_sales_invoice(c1, '2031-03-10', null, jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 2, 'unit_price', 1000000, 'vat_rate', 0)), null, null, true);
  perform public.post_sales_invoice(c1, '2031-04-02', null, jsonb_build_array(jsonb_build_object('product_id', p2, 'qty', 1, 'unit_price', 500000, 'vat_rate', 0)), null, null, true);
  inv := public.post_sales_invoice(c2, '2031-04-03', null, jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1, 'unit_price', 1000000, 'vat_rate', 0)), null, null, true);
  perform public.reverse_sales_invoice((inv->>'invoice_id')::uuid, '2031-04-04', 'test void');

  select count(*) into n from public.report_monthly_pnl('2031-03-01', '2031-05-31');
  perform pg_temp.rec('RPT-pnl-months', 'control', pg_temp.ok(n = 3), format('3 months returned incl. empty one, got %s', n));
  select * into r from public.report_monthly_pnl('2031-03-01', '2031-05-31') where month = '2031-03-01';
  perform pg_temp.rec('RPT-pnl-march', 'control', pg_temp.ok(r.revenue = 2000000 and r.cogs = 2000 and r.gross_profit = 1998000), format('Mar revenue %s cogs %s gp %s', r.revenue, r.cogs, r.gross_profit));
  select * into r from public.report_monthly_pnl('2031-03-01', '2031-05-31') where month = '2031-04-01';
  perform pg_temp.rec('RPT-pnl-april-void-netted', 'control', pg_temp.ok(r.revenue = 500000 and r.cogs = 1000), format('Apr revenue %s (sale 1M reversed -> net 500k) cogs %s', r.revenue, r.cogs));
  select * into r from public.report_monthly_pnl('2031-03-01', '2031-05-31') where month = '2031-05-01';
  perform pg_temp.rec('RPT-pnl-empty-month', 'control', pg_temp.ok(r.revenue = 0 and r.cogs = 0), 'May has no activity -> zeros');

  select * into r from public.report_top_products('2031-03-01', '2031-04-30', 10) where product_id = p1;
  perform pg_temp.rec('RPT-top-products-excl-void', 'control', pg_temp.ok(r.qty = 2 and r.revenue = 2000000 and r.margin = 1998000), format('P1 qty %s revenue %s (voided sale of 1 excluded)', r.qty, r.revenue));
  select count(*) into n from public.report_top_products('2031-03-01', '2031-04-30', 10) where product_id in (p1, p2);
  perform pg_temp.rec('RPT-top-products-grouped', 'control', pg_temp.ok(n = 2), format('one row per product, got %s', n));
  select * into r from public.report_top_products('2031-03-01', '2031-04-30', 1);
  perform pg_temp.rec('RPT-top-products-limit-order', 'control', pg_temp.ok(r.product_id = p1), 'limit 1 returns the highest-revenue product');

  select * into r from public.report_top_customers('2031-03-01', '2031-04-30', 10) where customer_id = c1;
  perform pg_temp.rec('RPT-top-customers', 'control', pg_temp.ok(r.invoices = 2 and r.revenue = 2500000 and r.outstanding = 2500000), format('c1: %s invoices, revenue %s, outstanding %s', r.invoices, r.revenue, r.outstanding));
  select count(*) into n from public.report_top_customers('2031-03-01', '2031-04-30', 10) where customer_id = c2;
  perform pg_temp.rec('RPT-top-customers-excl-void', 'control', pg_temp.ok(n = 0), 'customer whose only invoice was voided is absent');

  d0 := public.report_dashboard();
  perform public.post_sales_invoice(c1, (now() at time zone 'Asia/Ho_Chi_Minh')::date, null, jsonb_build_array(jsonb_build_object('product_id', p2, 'qty', 1, 'unit_price', 700000, 'vat_rate', 0)), null, null, true);
  d1 := public.report_dashboard();
  perform pg_temp.rec('RPT-dashboard-month-revenue', 'control', pg_temp.ok((d1->>'month_revenue')::numeric - (d0->>'month_revenue')::numeric = 700000
      and (d1->>'ar_balance')::numeric - (d0->>'ar_balance')::numeric = 700000), format('current-month revenue %s -> %s, AR %s -> %s', d0->>'month_revenue', d1->>'month_revenue', d0->>'ar_balance', d1->>'ar_balance'));
  perform pg_temp.rec('RPT-dashboard-keys', 'control', pg_temp.ok(d1 ?& array['products','low_stock','customers','business_customers','open_tickets','pending_quotations','month_revenue','month_cogs','ar_balance','ap_balance','stock_value','overdue_invoices']),
    'all dashboard keys present');

  perform pg_temp.act_as('authenticated', nu);
  e := pg_temp.try('select public.report_dashboard()');
  perform pg_temp.rec('RPT-dashboard-non-staff', 'control', pg_temp.ok(e = 'forbidden'), e);
  e := pg_temp.try('select * from public.report_top_products(''2031-01-01'', ''2031-12-31'', 5)');
  perform pg_temp.rec('RPT-top-products-non-staff', 'control', pg_temp.ok(e = 'forbidden'), e);
  perform pg_temp.act_as('anon');
  e := pg_temp.try('select public.report_dashboard()');
  reset role;
  perform pg_temp.rec('RPT-dashboard-anon', 'control', pg_temp.ok(e like 'permission denied%'), e);
end $$;
select current_setting('harness.out');
rollback;
