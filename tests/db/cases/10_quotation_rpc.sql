-- C2/C6: save_quotation() atomicity + totals computed in SQL
\ir ../_lib.sql
begin;
select pg_temp.set_mode('enterprise'); -- legacy (pre-0014) behaviour under test; the HKD default is covered by case 32
do $$
declare u uuid := pg_temp.mk_staff(); p uuid; c uuid; r jsonb; qid uuid; e text; n int; n_items int; tot numeric; code text := 'BG-' || substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.products(sku, name) values ('Q-' || gen_random_uuid(), 'QP') returning id into p;
  c := pg_temp.mk_customer();
  perform pg_temp.act_as('authenticated', u);
  r := public.save_quotation(null, code, c, 'draft', current_date + 7, 'ghi chu', 100000, 10,
    jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 2, 'unit_price', 1000000, 'discount', 10),
                      jsonb_build_object('product_id', p, 'qty', 1, 'unit_price', 500000, 'discount', 0)));
  reset role;
  qid := (r->>'id')::uuid;
  -- subtotal = 1,800,000 + 500,000 = 2,300,000; discount 100,000; vat = 2,200,000*10% = 220,000; total 2,420,000
  perform pg_temp.rec('QUO-create-totals', 'control', case when (r->>'subtotal')::numeric = 2300000 and (r->>'vat')::numeric = 220000 and (r->>'total')::numeric = 2420000 and (r->>'items')::int = 2 then 'OK' else 'FAIL' end, r::text);

  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try(format($q$select public.save_quotation(%L, null, %L, 'draft', null, null, 0, 10,
    '[{"product_id":"%s","qty":1,"unit_price":100,"discount":0},{"product_id":"%s","qty":-1,"unit_price":100,"discount":0}]'::jsonb)$q$, qid, c, p, p));
  reset role;
  select count(*) into n_items from public.quotation_items where quotation_id = qid; select total into tot from public.quotations where id = qid;
  perform pg_temp.rec('QUO-update-atomic', 'control', case when e = 'item_invalid' and n_items = 2 and tot = 2420000 then 'OK' else 'FAIL' end, format('invalid 2nd line -> %s; items still %s, total still %s (nothing lost)', e, n_items, tot));

  perform pg_temp.act_as('authenticated', u);
  r := public.save_quotation(qid, null, c, 'draft', null, null, 0, 0,
    jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 3, 'unit_price', 1000, 'discount', 0)));
  reset role;
  select count(*) into n_items from public.quotation_items where quotation_id = qid;
  perform pg_temp.rec('QUO-update-replace', 'control', case when n_items = 1 and (r->>'total')::numeric = 3000 then 'OK' else 'FAIL' end, format('draft update replaces items: %s item(s), total %s', n_items, r->>'total'));

  -- duplicate code on create: whole call fails, no orphan rows
  select count(*) into n from public.quotations;
  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try(format($q$select public.save_quotation(null, %L, %L, 'draft', null, null, 0, 0,
    '[{"product_id":"%s","qty":1,"unit_price":5,"discount":0}]'::jsonb)$q$, code, c, p));
  reset role;
  perform pg_temp.rec('QUO-dup-code', 'control', case when e like '%duplicate key%' and (select count(*) from public.quotations) = n then 'OK' else 'FAIL' end, 'duplicate code -> ' || left(e, 60));

  update public.quotations set status = 'sent' where id = qid;
  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try(format($q$select public.save_quotation(%L, null, %L, 'draft', null, null, 0, 0,
    '[{"product_id":"%s","qty":1,"unit_price":5,"discount":0}]'::jsonb)$q$, qid, c, p));
  perform pg_temp.rec('QUO-not-draft', 'control', case when e = 'quotation_not_draft' then 'OK' else 'FAIL' end, e);
  e := pg_temp.try(format('select public.save_quotation(null, ''X1'', %L, ''draft'', null, null, 0, 0, ''[]''::jsonb)', c));
  perform pg_temp.rec('QUO-empty-items', 'control', case when e = 'items_required' then 'OK' else 'FAIL' end, e);
  reset role;

  perform pg_temp.act_as('authenticated', gen_random_uuid());   -- not staff
  e := pg_temp.try(format($q$select public.save_quotation(null, 'NS1', %L, 'draft', null, null, 0, 0,
    '[{"product_id":"%s","qty":1,"unit_price":5,"discount":0}]'::jsonb)$q$, c, p));
  reset role;
  perform pg_temp.rec('QUO-nonstaff-denied', 'control', case when e like '%row-level security%' then 'OK' else 'FAIL' end, 'non-staff -> ' || left(e, 70));

  -- table CHECKs reject inconsistent rows even for privileged inserts (since 0009 the frozen-content trigger may fire first)
  e := pg_temp.try(format('insert into public.quotation_items(quotation_id, product_id, qty, unit_price, discount, line_total) values (%L, %L, 1, 100, 0, 5)', qid, p));
  perform pg_temp.rec('QUO-check-line', 'control', case when e like '%quotation_items_values_ok%' or e like 'quotation_not_draft%' then 'OK' else 'FAIL' end, left(e, 90));
  e := pg_temp.try(format('update public.quotations set total = 1 where id = %L', qid));
  perform pg_temp.rec('QUO-check-total', 'control', case when e like '%quotations_totals_ok%' or e like 'quotation_not_draft%' then 'OK' else 'FAIL' end, left(e, 90));
end $$;
select current_setting('harness.out');
rollback;
