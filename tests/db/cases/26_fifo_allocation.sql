-- C5: FIFO settlement of receipts / disbursements
\ir ../_lib.sql
begin;
do $$
declare u uuid := pg_temp.mk_staff(); c uuid := pg_temp.mk_customer(); s uuid := pg_temp.mk_supplier(); p uuid := pg_temp.mk_product(0, 0);
  i1 jsonb; i2 jsonb; i3 jsonb; r jsonb; b1 jsonb; b2 jsonb; e text; o1 numeric; o2 numeric; o3 numeric;
begin
  perform pg_temp.act_as('authenticated', u);
  perform public.post_purchase_bill(s, '2025-02-01', null, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 100, 'unit_cost', 1000)));
  i1 := public.post_sales_invoice(c, '2025-03-01', null, '[{"description":"A","qty":1,"unit_price":1000000}]'::jsonb, null, null, true);
  i2 := public.post_sales_invoice(c, '2025-03-05', null, '[{"description":"B","qty":1,"unit_price":2000000}]'::jsonb, null, null, true);
  i3 := public.post_sales_invoice(c, '2025-03-09', null, '[{"description":"C","qty":1,"unit_price":3000000}]'::jsonb, null, null, true);
  r := public.post_receipt_fifo(c, 3500000, 'bank', '2025-03-20');
  reset role;
  select outstanding into o1 from public.v_sales_invoice_open where invoice_id = (i1->>'invoice_id')::uuid;
  select outstanding into o2 from public.v_sales_invoice_open where invoice_id = (i2->>'invoice_id')::uuid;
  select outstanding into o3 from public.v_sales_invoice_open where invoice_id = (i3->>'invoice_id')::uuid;
  perform pg_temp.rec('FIFO-receipt', 'control', pg_temp.ok(o1 = 0 and o2 = 0 and o3 = 2500000 and (r->>'unapplied')::numeric = 0),
    format('3.5M against 1M/2M/3M -> outstanding %s / %s / %s (expect 0 / 0 / 2.5M)', o1, o2, o3));
  perform pg_temp.act_as('authenticated', u);
  r := public.post_receipt_fifo(c, 4000000, 'cash', '2025-03-21');
  reset role;
  perform pg_temp.rec('FIFO-overpay-unapplied', 'control', pg_temp.ok((r->>'unapplied')::numeric = 1500000 and (select balance = gl_balance and balance = -1500000 from public.v_ar_by_customer where customer_id = c)),
    format('4M against 2.5M open -> unapplied %s, AR balance %s (credit)', r->>'unapplied', (select balance from public.v_ar_by_customer where customer_id = c)));
  perform pg_temp.act_as('authenticated', u);
  b1 := public.post_purchase_bill(s, '2025-04-01', null, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 5, 'unit_cost', 1000)));
  b2 := public.post_purchase_bill(s, '2025-04-02', null, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 5, 'unit_cost', 3000)));
  r := public.post_disbursement_fifo(s, 7000, 'bank', '2025-04-05');
  reset role;
  select outstanding into o1 from public.v_purchase_bill_open where bill_id = (b1->>'bill_id')::uuid;
  select outstanding into o2 from public.v_purchase_bill_open where bill_id = (b2->>'bill_id')::uuid;
  perform pg_temp.rec('FIFO-disbursement', 'control', pg_temp.ok(o1 = 0 and o2 = 13000), format('7,000 against bills 5,000 / 15,000 -> outstanding %s / %s (expect 0 / 13,000)', o1, o2));
  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try(format('select public.post_receipt_fifo(%L, 1, ''cash'', ''2025-03-21'')', gen_random_uuid()));
  perform pg_temp.rec('FIFO-unknown-customer', 'control', pg_temp.ok(e = 'customer_not_found'), e);
  e := pg_temp.try(format('select public.post_receipt_fifo(%L, 0, ''cash'', ''2025-03-21'')', c));
  perform pg_temp.rec('FIFO-zero-amount', 'control', pg_temp.ok(e is not null and e <> 'OK'), 'zero receipt -> ' || e);
  perform pg_temp.act_as('anon');
  e := pg_temp.try(format('select public.post_receipt_fifo(%L, 1, ''cash'', ''2025-03-21'')', c));
  reset role;
  perform pg_temp.rec('FIFO-anon', 'control', pg_temp.ok(e like 'permission denied%'), e);
  perform pg_temp.rec('FIFO-recon', 'control', pg_temp.ok((select bool_and(diff = 0) from public.accounting_reconciliation())), 'reconciliation after FIFO operations');
end $$;
select current_setting('harness.out');
rollback;
