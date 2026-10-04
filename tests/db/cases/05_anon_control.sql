-- Controls: anon must NOT reach anything except the two over-broad policies; service_role bypasses RLS
\ir ../_lib.sql
begin;
do $$
declare t text; n int; tk uuid; leaked text[] := '{}'; ins_leak text[] := '{}'; r record; sr_bypass bool; cnt int;
begin
  tk := pg_temp.mk_ticket();   -- ensure rows exist in several tables
  insert into public.bot_users(telegram_chat_id) values ('c_' || gen_random_uuid());
  insert into public.products(sku, name) values ('S' || gen_random_uuid(), 'P');
  insert into public.notifications(type) values ('x');
  perform pg_temp.act_as('anon');
  for t in select tablename from pg_tables where schemaname = 'public' and tablename <> 'signature_tokens' and tablename <> 'signatures' loop
    begin
      execute format('select count(*) from public.%I', t) into n;
      if n > 0 then leaked := leaked || t; end if;
    exception when insufficient_privilege then null; end;   -- no privilege at all = nothing leaked
  end loop;
  for r in select * from (values
      ('customers',     'insert into public.customers(name) values (''x'')'),
      ('products',      'insert into public.products(sku,name) values (''a'',''b'')'),
      ('notifications', 'insert into public.notifications(type) values (''x'')'),
      ('bot_users',     'insert into public.bot_users(telegram_chat_id, role) values (''1'',''owner'')'),
      ('categories',    'insert into public.categories(name,slug) values (''a'',''b'')'),
      ('quotations',    'insert into public.quotations(code) values (''Q'')'),
      ('signature_tokens', format('insert into public.signature_tokens(ticket_id, token, expires_at) values (%L, ''t'', now())', tk))
    ) v(tbl, stmt) loop
    begin
      execute r.stmt; ins_leak := ins_leak || r.tbl;
    exception when others then null; end;
  end loop;
  reset role;
  perform pg_temp.rec('ANON-read-ctl', 'control', case when cardinality(leaked) = 0 then 'OK' else 'FAIL' end,
    'anon sees 0 rows in every other public table' || case when cardinality(leaked)>0 then ' LEAKED: '||array_to_string(leaked,',') else '' end);
  perform pg_temp.rec('ANON-insert-ctl', 'control', case when cardinality(ins_leak) = 0 then 'OK' else 'FAIL' end,
    'anon cannot insert into customers/products/notifications/bot_users/categories/quotations/signature_tokens' || case when cardinality(ins_leak)>0 then ' INSERTED: '||array_to_string(ins_leak,',') else '' end);
  perform pg_temp.act_as('service_role');
  select count(*) into cnt from public.bot_users;
  reset role;
  perform pg_temp.rec('SVC-bypass-ctl', 'control', case when cnt > 0 then 'OK' else 'FAIL' end, 'service_role reads RLS-protected table (BYPASSRLS), as the admin client does');
  -- policies actually present for anon
  perform pg_temp.rec('ANON-policies', 'info', 'INFO', 'anon policies: ' || coalesce((select string_agg(tablename || '.' || policyname || '[' || cmd || ']', ', ') from pg_policies where 'anon' = any(roles)), 'none'));
end $$;
select current_setting('harness.out');
rollback;
