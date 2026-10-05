-- Sales / purchases / receipts / allocations / VAT / reconciliation (rolled back)
\ir ../_lib.sql
begin;
select pg_temp.set_mode('enterprise'); -- legacy (pre-0014) behaviour under test; the HKD default is covered by case 32
create or replace function pg_temp.recon_ok() returns boolean language sql as $f$
  select coalesce(bool_and(diff = 0), false) from public.accounting_reconciliation() $f$;
do $$
declare u uuid := pg_temp.mk_staff(); c uuid := pg_temp.mk_customer(); s uuid := pg_temp.mk_supplier();
  p uuid := pg_temp.mk_product(0, 0); r jsonb; inv1 jsonb; inv2 jsonb; pb1 jsonb; pb2 jsonb; rc jsonb; e text; q int; v numeric; n int; n0 int;
  open_amt numeric; pay jsonb; cnt_before int;
begin
  perform pg_temp.act_as('authenticated', u);
  -- 1) purchase 10 @ 1,000,000 + 10% VAT
  pb1 := public.post_purchase_bill(s, '2025-05-02', '2025-06-01', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 10, 'unit_cost', 1000000, 'vat_rate', 10)), 'NCC-001');
  reset role;
  select stock_qty, stock_value into q, v from public.products where id = p;
  perform pg_temp.rec('ACC-purchase', 'control', pg_temp.ok((pb1->>'total')::numeric = 11000000 and q = 10 and v = 10000000 and pg_temp.bal('156') = 10000000 and pg_temp.bal('133') = 1000000 and pg_temp.bal('331') = 11000000),
    format('bill total %s; stock %s value %s; GL 156=%s 133=%s 331=%s', pb1->>'total', q, v, pg_temp.bal('156'), pg_temp.bal('133'), pg_temp.bal('331')));
  perform pg_temp.rec('ACC-recon-1', 'control', pg_temp.ok(pg_temp.recon_ok()), 'subledgers == GL after purchase');

  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try(format($q$select public.post_purchase_bill(%L, '2025-05-03', null, jsonb_build_array(jsonb_build_object('product_id', %L, 'qty', 1, 'unit_cost', 5, 'vat_rate', 10)), 'NCC-001')$q$, s, p));
  reset role;
  perform pg_temp.rec('ACC-dup-supplier-ref', 'control', pg_temp.ok(e like '%uq_pb_supplier_ref%'), 'same supplier invoice number twice -> ' || left(e, 70));

  -- 2) sale 4 @ 1,500,000, VAT 10%  => net 6,000,000 vat 600,000 total 6,600,000 cogs 4,000,000
  perform pg_temp.act_as('authenticated', u);
  inv1 := public.post_sales_invoice(c, '2025-05-10', '2025-06-10', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 4, 'unit_price', 1500000, 'vat_rate', 10)));
  reset role;
  select stock_qty, stock_value into q, v from public.products where id = p;
  perform pg_temp.rec('ACC-sale-amounts', 'control', pg_temp.ok((inv1->>'total')::numeric = 6600000 and (inv1->>'cogs')::numeric = 4000000 and q = 6 and v = 6000000),
    format('invoice total %s cogs %s; stock %s value %s', inv1->>'total', inv1->>'cogs', q, v));
  perform pg_temp.rec('ACC-sale-gl', 'control', pg_temp.ok(pg_temp.bal('131') = 6600000 and pg_temp.bal('511') = 6000000 and pg_temp.bal('3331') = 600000 and pg_temp.bal('632') = 4000000 and pg_temp.bal('156') = 6000000),
    format('GL after sale: 131=%s 511=%s 3331=%s 632=%s 156=%s', pg_temp.bal('131'), pg_temp.bal('511'), pg_temp.bal('3331'), pg_temp.bal('632'), pg_temp.bal('156')));
  perform pg_temp.rec('ACC-sale-entry-balanced', 'control',
    pg_temp.ok((select sum(debit) = sum(credit) and sum(debit) = 10600000 from public.journal_lines where entry_id = (inv1->>'entry_id')::uuid)),
    'single entry: Dr 131 6.6M + Dr 632 4.0M = Cr 511 6.0M + Cr 3331 0.6M + Cr 156 4.0M');
  perform pg_temp.rec('ACC-recon-2', 'control', pg_temp.ok(pg_temp.recon_ok()), 'reconciliation after sale');
  perform pg_temp.rec('ACC-invoice-no', 'control', pg_temp.ok(inv1->>'invoice_no' ~ '^INV-2025-[0-9]{6}$'), inv1->>'invoice_no');

  -- 3) moving average: buy 10 more @ 1,200,000 => qty 16, value 18,000,000 ; sell 3 => cogs round(18,000,000*3/16,2)=3,375,000
  perform pg_temp.act_as('authenticated', u);
  pb2 := public.post_purchase_bill(s, '2025-05-12', '2025-06-12', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 10, 'unit_cost', 1200000, 'vat_rate', 0)));
  inv2 := public.post_sales_invoice(c, '2025-05-15', '2025-06-15', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 3, 'unit_price', 2000000, 'discount_pct', 10, 'vat_rate', 8)));
  reset role;
  select stock_qty, stock_value into q, v from public.products where id = p;
  -- net = 3*2,000,000*0.9 = 5,400,000 ; vat 8% = 432,000 ; total 5,832,000 ; cogs 3,375,000 ; stock 13 value 14,625,000
  perform pg_temp.rec('ACC-moving-average', 'control', pg_temp.ok((inv2->>'cogs')::numeric = 3375000 and q = 13 and v = 14625000 and (inv2->>'total')::numeric = 5832000),
    format('avg-cost sale: cogs %s (expect 3,375,000); stock %s value %s (expect 13 / 14,625,000); total %s (discount 10%% + VAT 8%%)', inv2->>'cogs', q, v, inv2->>'total'));
  perform pg_temp.rec('ACC-recon-3', 'control', pg_temp.ok(pg_temp.recon_ok() and not exists (select 1 from public.v_stock_value_mismatch)), 'reconciliation + stock value mismatch view empty');

  -- 4) oversell is refused and leaves no trace
  select count(*) into n0 from public.journal_entries; select count(*) into cnt_before from public.stock_movements;
  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try(format($q$select public.post_sales_invoice(%L, '2025-05-16', null, jsonb_build_array(jsonb_build_object('product_id', %L, 'qty', 14, 'unit_price', 1)))$q$, c, p));
  reset role;
  perform pg_temp.rec('ACC-oversell-blocked', 'control', pg_temp.ok(e like 'insufficient_stock%' and (select count(*) from public.journal_entries) = n0 and (select count(*) from public.stock_movements) = cnt_before),
    'selling 14 of 13: ' || left(e, 60) || ' ; no journal/stock rows left behind');

  -- 5) receipt 3,000,000 allocated to invoice 1; outstanding falls; unapplied stays at 0
  perform pg_temp.act_as('authenticated', u);
  rc := public.post_receipt(c, 3000000, 'bank', '2025-05-20', jsonb_build_array(jsonb_build_object('invoice_id', inv1->>'invoice_id', 'amount', 3000000)));
  reset role;
  select outstanding into open_amt from public.v_sales_invoice_open where invoice_id = (inv1->>'invoice_id')::uuid;
  perform pg_temp.rec('ACC-receipt-allocated', 'control', pg_temp.ok(open_amt = 3600000 and (rc->>'unapplied')::numeric = 0 and pg_temp.bal('112') = 3000000 and pg_temp.bal('131') = 6600000 + 5832000 - 3000000),
    format('invoice 1 outstanding %s (expect 3,600,000); bank 112=%s; AR 131=%s', open_amt, pg_temp.bal('112'), pg_temp.bal('131')));
  perform pg_temp.rec('ACC-ar-balance', 'control', pg_temp.ok((select balance = gl_balance and balance = 9432000 from public.v_ar_by_customer where customer_id = c)),
    (select format('customer AR subledger %s = GL %s (expect 9,432,000)', balance, gl_balance) from public.v_ar_by_customer where customer_id = c));
  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try(format($q$select public.post_receipt(%L, 9000000, 'cash', '2025-05-21', jsonb_build_array(jsonb_build_object('invoice_id', %L, 'amount', 3600001)))$q$, c, inv1->>'invoice_id'));
  perform pg_temp.rec('ACC-overallocate-invoice', 'control', pg_temp.ok(e like 'allocation_exceeds_outstanding%'), e);
  e := pg_temp.try(format($q$select public.post_receipt(%L, 1000, 'cash', '2025-05-21', jsonb_build_array(jsonb_build_object('invoice_id', %L, 'amount', 2000)))$q$, c, inv1->>'invoice_id'));
  perform pg_temp.rec('ACC-overallocate-payment', 'control', pg_temp.ok(e like 'allocation_exceeds_payment%'), e);
  e := pg_temp.try(format($q$select public.post_receipt(%L, 1000, 'cash', '2025-05-21', jsonb_build_array(jsonb_build_object('invoice_id', %L, 'amount', 10)))$q$, pg_temp.mk_customer(), inv1->>'invoice_id'));
  perform pg_temp.rec('ACC-allocate-other-customer', 'control', pg_temp.ok(e = 'invoice_not_found_for_customer'), 'receipt of another customer against this invoice: ' || e);
  -- advance payment, allocate later
  pay := public.post_receipt(c, 5832000, 'cash', '2025-05-25');
  perform pg_temp.rec('ACC-unapplied', 'control', pg_temp.ok((pay->>'unapplied')::numeric = 5832000), 'receipt without allocation keeps unapplied credit');
  perform public.allocate_payment((pay->>'payment_id')::uuid, jsonb_build_array(jsonb_build_object('invoice_id', inv2->>'invoice_id', 'amount', 5832000)));
  reset role;
  select count(*) into n from public.v_sales_invoice_open where outstanding = 0 and invoice_id = (inv2->>'invoice_id')::uuid;
  perform pg_temp.rec('ACC-allocate-later', 'control', pg_temp.ok(n = 1 and (select unapplied from public.v_payment_unapplied where payment_id = (pay->>'payment_id')::uuid) = 0), 'later allocation settles invoice 2');
  perform pg_temp.rec('ACC-recon-4', 'control', pg_temp.ok(pg_temp.recon_ok()), 'reconciliation after receipts');

  -- 6) void rules
  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try(format($q$select public.reverse_sales_invoice(%L, '2025-05-30')$q$, inv1->>'invoice_id'));
  perform pg_temp.rec('ACC-void-blocked-by-allocation', 'control', pg_temp.ok(e = 'invoice_has_allocations'), e);
  perform public.reverse_payment((rc->>'payment_id')::uuid, '2025-05-30', 'nhập sai');
  r := public.reverse_sales_invoice((inv1->>'invoice_id')::uuid, '2025-05-30', 'khách trả hàng');
  e := pg_temp.try(format($q$select public.reverse_sales_invoice(%L, '2025-05-30')$q$, inv1->>'invoice_id'));
  reset role;
  select stock_qty, stock_value into q, v from public.products where id = p;
  perform pg_temp.rec('ACC-void-restores-stock-at-cost', 'control', pg_temp.ok(q = 17 and v = 14625000 + 4000000 and pg_temp.recon_ok()),
    format('after voiding invoice 1: stock %s value %s (expect 17 / 18,625,000 = original cost restored); reconciliation ok=%s', q, v, pg_temp.recon_ok()));
  perform pg_temp.rec('ACC-void-twice', 'control', pg_temp.ok(e = 'already_voided'), e);
  perform pg_temp.rec('ACC-void-ar', 'control', pg_temp.ok((select balance = gl_balance and balance = 0 from public.v_ar_by_customer where customer_id = c)),
    format('AR after voiding invoice 1 and receipt 1 and paying invoice 2: %s', (select balance from public.v_ar_by_customer where customer_id = c)));
  perform pg_temp.rec('ACC-void-immutable', 'control', pg_temp.ok(pg_temp.try(format('update public.sales_invoices set total = 1 where id = %L', inv1->>'invoice_id')) like 'accounting documents are immutable%'
                                                                  and pg_temp.try(format('delete from public.sales_invoice_lines where invoice_id = %L', inv1->>'invoice_id')) like 'accounting documents are immutable%'),
    'documents cannot be edited/deleted (only the void marker may be set by reverse_*)');

  -- 7) supplier payment + AP
  perform pg_temp.act_as('authenticated', u);
  pay := public.post_disbursement(s, 5000000, 'bank', '2025-06-02', jsonb_build_array(jsonb_build_object('bill_id', pb1->>'bill_id', 'amount', 5000000)));
  reset role;
  select outstanding into open_amt from public.v_purchase_bill_open where bill_id = (pb1->>'bill_id')::uuid;
  perform pg_temp.rec('ACC-ap', 'control', pg_temp.ok(open_amt = 6000000 and (select balance = gl_balance and balance = 6000000 + 12000000 from public.v_ap_by_supplier where supplier_id = s) and pg_temp.recon_ok()),
    format('bill 1 outstanding %s; supplier AP %s', open_amt, (select balance from public.v_ap_by_supplier where supplier_id = s)));

  -- 8) VAT
  select output_vat, input_vat into v, open_amt from public.vat_report(2025, 5);
  -- May: output = 600,000 (inv1) + 432,000 (inv2) - 600,000 (inv1 reversed 30/05) = 432,000 ; input = 1,000,000
  perform pg_temp.rec('ACC-vat-report', 'control', pg_temp.ok(v = 432000 and open_amt = 1000000 and (select payable from public.vat_report(2025, 5)) = -568000),
    format('May VAT: output %s input %s payable %s (negative = carry forward credit)', v, open_amt, (select payable from public.vat_report(2025, 5))));
  perform pg_temp.rec('ACC-vat-by-rate', 'control', pg_temp.ok((select count(*) = 3 and sum(vat) filter (where direction = 'output') = 432000 and sum(vat) filter (where direction = 'input') = 1000000
                                                     from public.vat_by_rate('2025-05-01', '2025-05-31'))), 'vat_by_rate lists output 8% and input 10% / 0% (voided documents excluded)');

  -- 9) debt limit
  update public.customers set debt_limit = 5000000 where id = c;
  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try(format($q$select public.post_sales_invoice(%L, '2025-06-03', null, jsonb_build_array(jsonb_build_object('product_id', %L, 'qty', 5, 'unit_price', 1500000)))$q$, c, p));
  perform pg_temp.rec('ACC-debt-limit', 'control', pg_temp.ok(e = 'debt_limit_exceeded'), 'AR 0 + 7.5M > limit 5M -> ' || e);
  r := public.post_sales_invoice(c, '2025-06-03', null, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 5, 'unit_price', 1500000)), null, null, true);
  reset role;
  perform pg_temp.rec('ACC-debt-limit-override', 'control', pg_temp.ok((r->>'total')::numeric = 7500000), 'override flag allows it');

  -- 10) service line (no product), purchase void blocked when stock was sold
  perform pg_temp.act_as('authenticated', u);
  r := public.post_sales_invoice(c, '2025-06-04', null, jsonb_build_array(jsonb_build_object('description', 'Công cài đặt', 'qty', 1, 'unit_price', 300000, 'vat_rate', 10)), null, null, true);
  reset role;
  perform pg_temp.rec('ACC-service-line', 'control', pg_temp.ok((r->>'cogs')::numeric = 0 and (r->>'total')::numeric = 330000 and pg_temp.recon_ok()), 'service line: revenue + VAT, no COGS / no stock');
  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try(format($q$select public.reverse_purchase_bill(%L, '2025-06-05')$q$, pb2->>'bill_id'));
  reset role;
  perform pg_temp.rec('ACC-void-purchase-ok', 'control', pg_temp.ok(e = 'OK' and (select stock_qty from public.products where id = p) = 2 and pg_temp.recon_ok()), 'voiding bill 2 (stock 12 -> 2) -> ' || e);
  perform pg_temp.act_as('authenticated', u);
  pb2 := public.post_purchase_bill(s, '2025-06-06', null, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 5, 'unit_cost', 900000)));
  perform public.post_sales_invoice(c, '2025-06-06', null, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 6, 'unit_price', 1)), null, null, true);
  e := pg_temp.try(format($q$select public.reverse_purchase_bill(%L, '2025-06-07')$q$, pb2->>'bill_id'));
  reset role;
  perform pg_temp.rec('ACC-void-purchase-needs-stock', 'control', pg_temp.ok(e like 'insufficient_stock_to_void%' and pg_temp.recon_ok()), 'goods already sold -> ' || left(e, 70));

  -- 11) permissions
  perform pg_temp.act_as('authenticated', gen_random_uuid());
  e := pg_temp.try(format($q$select public.post_sales_invoice(%L, '2025-06-03', null, '[{"description":"x","qty":1,"unit_price":1}]'::jsonb)$q$, c));
  perform pg_temp.rec('ACC-nonstaff-denied', 'control', pg_temp.ok(e = 'forbidden'), e);
  reset role;
  perform pg_temp.act_as('anon');
  e := pg_temp.try(format($q$select public.post_receipt(%L, 1, 'cash', '2025-06-03')$q$, c));
  reset role;
  perform pg_temp.rec('ACC-anon-denied', 'control', pg_temp.ok(e like 'permission denied%'), e);
  perform pg_temp.rec('ACC-final-recon', 'control', pg_temp.ok(pg_temp.recon_ok()), (select string_agg(check_name || '=' || diff, '; ') from public.accounting_reconciliation()));
end $$;
select current_setting('harness.out');
rollback;
