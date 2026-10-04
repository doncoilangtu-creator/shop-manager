-- C6: quotation status FSM, frozen content, invoice_from_quotation
\ir ../_lib.sql
begin;
do $$
declare u uuid := pg_temp.mk_staff(); c uuid := pg_temp.mk_customer(); p uuid := pg_temp.mk_product(1000000, 20); s uuid := pg_temp.mk_supplier();
  q jsonb; qid uuid; e text; r jsonb; n int; qt numeric; st text;
begin
  perform pg_temp.act_as('authenticated', u);
  q := public.save_quotation(null, 'BG-WF-' || substr(gen_random_uuid()::text, 1, 6), c, 'draft', null, 'ghi chú', 500000, 10,
        jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 3, 'unit_price', 1500000, 'discount', 10),
                          jsonb_build_object('product_id', p, 'qty', 2, 'unit_price', 2000000)));
  qid := (q->>'id')::uuid;
  reset role;
  select total into qt from public.quotations where id = qid;
  -- subtotal = 3*1.5M*0.9 + 2*2M = 4.05M + 4M = 8.05M ; discount 0.5M ; base 7.55M ; vat 755k ; total 8.305M
  perform pg_temp.rec('QWF-totals', 'control', pg_temp.ok(qt = 8305000), 'quotation total ' || qt || ' (expect 8,305,000)');

  e := pg_temp.try(format('update public.quotations set status = ''approved'' where id = %L', qid));
  perform pg_temp.rec('QWF-skip-state', 'control', pg_temp.ok(e like 'quotation_status_transition%'), 'draft -> approved: ' || e);
  update public.quotations set status = 'sent' where id = qid;
  e := pg_temp.try(format('update public.quotations set total = 1 where id = %L', qid));
  perform pg_temp.rec('QWF-frozen-total', 'control', pg_temp.ok(e like 'quotation_not_draft%'), 'edit total after sending: ' || e);
  e := pg_temp.try(format('delete from public.quotation_items where quotation_id = %L', qid));
  perform pg_temp.rec('QWF-frozen-items-delete', 'control', pg_temp.ok(e like 'quotation_not_draft%'), 'delete item after sending: ' || e);
  e := pg_temp.try(format('insert into public.quotation_items(quotation_id, qty, unit_price, line_total) values (%L, 1, 1, 1)', qid));
  perform pg_temp.rec('QWF-frozen-items-insert', 'control', pg_temp.ok(e like 'quotation_not_draft%'), 'insert item after sending: ' || e);
  update public.quotations set pdf_path = 'x.pdf' where id = qid;
  perform pg_temp.rec('QWF-pdf-path-allowed', 'control', pg_temp.ok(true), 'pdf_path can still be set after sending');

  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try(format('select public.invoice_from_quotation(%L, ''2025-08-01'')', qid));
  perform pg_temp.rec('QWF-not-approved', 'control', pg_temp.ok(e = 'quotation_not_approved'), 'invoice from a sent quotation: ' || e);
  reset role;
  update public.quotations set status = 'approved' where id = qid;
  e := pg_temp.try(format('update public.quotations set status = ''draft'' where id = %L', qid));
  perform pg_temp.rec('QWF-approved-final', 'control', pg_temp.ok(e like 'quotation_status_transition%'), 'approved -> draft: ' || e);

  perform pg_temp.act_as('authenticated', u);
  perform public.post_stock_adjustments('2025-07-31');      -- book the opening stock of the fixture product to the GL
  r := public.invoice_from_quotation(qid, '2025-08-01', '2025-08-31');
  reset role;
  perform pg_temp.rec('QWF-invoice', 'control', pg_temp.ok(abs((r->>'total')::numeric - 8305000) <= 1 and (select quotation_id from public.sales_invoices where id = (r->>'invoice_id')::uuid) = qid),
    format('invoice total %s within 1 VND of quotation total (discount + VAT 10%% reproduced), linked by quotation_id', r->>'total'));
  perform pg_temp.rec('QWF-invoice-stock', 'control', pg_temp.ok((select stock_qty from public.products where id = p) = 15 and (r->>'cogs')::numeric = 5000000), 'stock 20 -> 15, COGS 5,000,000');
  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try(format('select public.invoice_from_quotation(%L, ''2025-08-02'')', qid));
  perform pg_temp.rec('QWF-invoice-once', 'control', pg_temp.ok(e = 'quotation_already_invoiced'), e);
  perform public.reverse_sales_invoice((r->>'invoice_id')::uuid, '2025-08-05', 'test');
  r := public.invoice_from_quotation(qid, '2025-08-06');
  reset role;
  perform pg_temp.rec('QWF-reinvoice-after-void', 'control', pg_temp.ok(abs((r->>'total')::numeric - 8305000) <= 1), 'after voiding, the quotation can be invoiced again');
  perform pg_temp.rec('QWF-recon', 'control', pg_temp.ok((select bool_and(diff = 0) from public.accounting_reconciliation())), (select string_agg(check_name || '=' || diff, '; ') from public.accounting_reconciliation()));

  -- deleting a rejected quotation cascades its items
  perform pg_temp.act_as('authenticated', u);
  q := public.save_quotation(null, 'BG-RJ-' || substr(gen_random_uuid()::text, 1, 6), c, 'draft', null, null, 0, 0,
        jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1, 'unit_price', 100)));
  reset role;
  update public.quotations set status = 'sent' where id = (q->>'id')::uuid;
  update public.quotations set status = 'rejected' where id = (q->>'id')::uuid;
  delete from public.quotations where id = (q->>'id')::uuid;
  select count(*) into n from public.quotation_items where quotation_id = (q->>'id')::uuid;
  perform pg_temp.rec('QWF-delete-rejected', 'control', pg_temp.ok(n = 0), 'rejected quotation + items deleted');
  perform pg_temp.act_as('anon');
  e := pg_temp.try(format('select public.invoice_from_quotation(%L, ''2025-08-01'')', qid));
  reset role;
  perform pg_temp.rec('QWF-anon', 'control', pg_temp.ok(e like 'permission denied%'), e);
end $$;
select current_setting('harness.out');
rollback;
