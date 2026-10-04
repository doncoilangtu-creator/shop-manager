-- Constraint / data-integrity gaps verifiable in SQL (F6/F7/F12/F13/F14)
\ir ../_lib.sql
begin;
do $$
declare p uuid; q uuid; c uuid; t uuid; owner uuid := pg_temp.mk_staff();
        neg_stock bool := false; stock_after int; no_mv int; qty_neg bool := false; total_incons bool := false;
        status_back text; ct_bad bool := false; ct_neg bool := false; mv_type text; stock_type text; dash_err text; dash_state text;
        tok_dup bool := false; upd1 timestamptz; upd2 timestamptz; sig_ok bool := false; disc_ok bool := false;
        dup_phone bool := false; lowcnt int; frac_mv numeric; frac_after int; ticket_signed bool := false;
begin
  -- F7: authenticated can overwrite products.stock_qty directly; no stock_movements row; negative stock allowed
  insert into public.products(sku, name, stock_qty) values ('SKU-' || gen_random_uuid(), 'P', 5) returning id into p;
  perform pg_temp.act_as('authenticated', owner);
  begin update public.products set stock_qty = -3 where id = p; exception when others then null; end;
  reset role;
  select stock_qty into stock_after from public.products where id = p;
  select count(*) into no_mv from public.stock_movements where product_id = p;
  perform pg_temp.rec('F7-stock', 'weakness', case when stock_after = -3 and no_mv = 0 then 'CONFIRMED' else 'NOT_REPRODUCIBLE' end,
    format('stock_qty set to %s directly by authenticated; stock_movements rows for product=%s (no CHECK stock_qty>=0, no ledger trigger)', stock_after, no_mv));

  -- F6/F7: type mismatch between ledger qty (numeric(12,2)) and stock_qty (integer): fractions silently rounded
  select data_type || '(' || coalesce(numeric_precision::text,'') || ',' || coalesce(numeric_scale::text,'') || ')' into mv_type
    from information_schema.columns where table_schema='public' and table_name='stock_movements' and column_name='qty';
  select data_type into stock_type from information_schema.columns where table_schema='public' and table_name='products' and column_name='stock_qty';
  -- direct mutation of the cache column is now blocked; use app.stock_internal as the triggers do, to test only the TYPE issue
  perform set_config('app.stock_internal', '1', true);
  update public.products set stock_qty = 10 where id = p;
  update public.products set stock_qty = stock_qty + 1.5::numeric where id = p;
  perform set_config('app.stock_internal', '0', true);
  select stock_qty into frac_after from public.products where id = p;
  begin insert into public.stock_movements(product_id, type, qty) values (p, 'in', 1.5); exception when others then null; end;
  select qty into frac_mv from public.stock_movements where product_id = p and type = 'in' order by created_at desc limit 1;
  perform pg_temp.rec('F6-qtytype', 'weakness', case when mv_type like 'numeric%' and stock_type = 'integer' and frac_after = 12 then 'CONFIRMED' else 'NOT_REPRODUCIBLE' end,
    format('stock_movements.qty=%s vs products.stock_qty=%s; 10 + 1.5 stored as %s (silent rounding); movement qty 1.5 stored as %s', mv_type, stock_type, frac_after, coalesce(frac_mv::text, 'rejected')));

  -- Quotations: no CHECKs on qty/discount/totals; totals not derived from items
  insert into public.quotations(code, total, subtotal) values ('BG-' || gen_random_uuid(), 1, 1) returning id into q;
  perform pg_temp.act_as('authenticated', owner);
  begin insert into public.quotation_items(quotation_id, product_id, qty, unit_price, discount, line_total) values (q, p, -5, 100, 100000, 999999); qty_neg := true; exception when others then null; end;
  reset role;
  select (select sum(line_total) from public.quotation_items where quotation_id = q) <> (select total from public.quotations where id = q) into total_incons;
  perform pg_temp.rec('QUO-checks', 'weakness', case when qty_neg and total_incons then 'CONFIRMED' else 'NOT_REPRODUCIBLE' end,
    format('quotation_items accepted qty=-5, discount>>price, line_total unrelated to qty*price=%s; quotations.total not tied to items=%s (no CHECK/trigger)', qty_neg, total_incons));

  -- F12: ticket status transitions not enforced by DB
  t := pg_temp.mk_ticket();
  update public.maintenance_tickets set status = 'closed' where id = t;
  begin update public.maintenance_tickets set status = 'received' where id = t; exception when others then null; end;
  select status::text into status_back from public.maintenance_tickets where id = t;
  perform pg_temp.rec('F12-status', 'weakness', case when status_back = 'received' then 'CONFIRMED' else 'NOT_REPRODUCIBLE' end,
    format('ticket moved closed -> %s with a plain UPDATE; no transition trigger/CHECK (state machine lives only in app code, in 2 divergent copies)', status_back));

  -- F13: contract data sanity
  c := pg_temp.mk_customer();
  begin insert into public.maintenance_contracts(customer_id, code, start_date, end_date) values (c, 'HD-' || gen_random_uuid(), '2026-12-31', '2026-01-01'); ct_bad := true; exception when others then null; end;
  begin insert into public.maintenance_contracts(customer_id, code, start_date, end_date, monthly_fee, sla_hours) values (c, 'HD-' || gen_random_uuid(), '2026-01-01', '2026-12-31', -1, -5); ct_neg := true; exception when others then null; end;
  perform pg_temp.rec('F13-contract', 'weakness', case when ct_bad and ct_neg then 'CONFIRMED' else 'NOT_REPRODUCIBLE' end,
    format('contract with end_date < start_date accepted=%s; negative monthly_fee/sla_hours accepted=%s', ct_bad, ct_neg));

  -- F14: dashboard "low stock" filter. Old app code compared the column to the literal string 'min_stock' (SQL error 22P02).
  -- Fixed: a column-vs-column view low_stock_products exists and returns exactly the rows with stock_qty <= min_stock.
  begin
    perform count(*) from public.products where stock_qty <= 'min_stock';
    dash_state := 'no error';
  exception when others then dash_state := sqlstate; dash_err := sqlerrm; end;
  perform pg_temp.rec('F14-literal-info', 'info', 'INFO', format('SQL `stock_qty <= ''min_stock''` -> %s (still invalid SQL; the app must not use it)', dash_state));
  begin
    perform set_config('app.skip_stock_apply', '0', true);
    insert into public.products(sku, name, min_stock) values ('LOW-' || gen_random_uuid(), 'low', 5) returning id into q;
    if to_regclass('public.low_stock_products') is null then
      dash_state := 'no view';
    else
      execute 'select count(*) from public.low_stock_products where id = $1' into lowcnt using q;
      dash_state := case when lowcnt = 1 then 'view ok' else 'view wrong (' || lowcnt || ')' end;
    end if;
  end;
  perform pg_temp.rec('F14-lowstock', 'weakness', case when dash_state = 'view ok' then 'NOT_REPRODUCIBLE' else 'CONFIRMED' end,
    format('low-stock view check: %s (product stock 0 <= min_stock 5 must be listed)', dash_state));
  perform pg_temp.rec('F14-lowstock-ctl', 'control', case when (select count(*) >= 0 from public.products where stock_qty <= min_stock) then 'OK' else 'FAIL' end, 'the correct column-vs-column comparison `stock_qty <= min_stock` runs fine');

  -- Control: updated_at trigger works (now() is frozen inside a txn, so force an old value and check the trigger overrides it)
  update public.products set name = 'renamed', updated_at = '2000-01-01' where id = p;
  select updated_at into upd2 from public.products where id = p;
  perform pg_temp.rec('TRG-updated_at-ctl', 'control', case when upd2 > '2020-01-01' then 'OK' else 'FAIL' end, 'set_updated_at trigger overrides updated_at on UPDATE');

  -- Control: token uniqueness + FK cascade (ticket delete removes tokens/signatures)
  t := pg_temp.mk_ticket();
  perform pg_temp.mk_token(t, interval '1 day');
  begin insert into public.signature_tokens(ticket_id, token, expires_at) select ticket_id, token, now() from public.signature_tokens where ticket_id = t; tok_dup := true; exception when unique_violation then null; end;
  perform pg_temp.rec('TOKEN-unique-ctl', 'control', case when not tok_dup then 'OK' else 'FAIL' end, 'signature_tokens.token is UNIQUE (duplicate rejected)');
end $$;
select current_setting('harness.out');
rollback;
