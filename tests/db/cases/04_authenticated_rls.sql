-- authenticated-role behaviour: signing as logged-in owner, blanket read/delete, cascade data loss, no write policies
\ir ../_lib.sql
begin;
do $$
declare t uuid; c uuid; owner uuid := gen_random_uuid(); stranger uuid := gen_random_uuid();
        sign_ok bool := false; sign_err text; n_cust int; n_bot int; n_tok int; n_sig int;
        tk_ins bool := false; tk_upd int := -1; c_del int; tk_left int; sg_left int; ct_left int; prod_ok bool := false;
begin
  -- F3c: logged-in owner opens /sign/<token> in the same browser -> role authenticated, not anon
  t := pg_temp.mk_ticket();
  perform pg_temp.act_as('authenticated', owner);
  begin
    insert into public.signatures(ticket_id, signer_name, signer_role, signature_png) values (t,'Owner','customer','x'); sign_ok := true;
  exception when others then sign_err := sqlerrm; end;
  reset role;
  perform pg_temp.rec('F3c', 'weakness', case when not sign_ok then 'CONFIRMED' else 'NOT_REPRODUCIBLE' end,
    format('authenticated INSERT into signatures: %s%s', case when sign_ok then 'accepted' else 'REJECTED' end, coalesce(' ('||sign_err||')','')));

  -- Any authenticated account (no ownership/role notion) reads everything
  insert into public.customers(name) values ('PII ' || gen_random_uuid());
  insert into public.bot_users(telegram_chat_id, role) values ('chat_' || gen_random_uuid(), 'owner');
  perform pg_temp.mk_token(t, interval '7 days');
  perform pg_temp.act_as('authenticated', stranger);          -- a random uid that is NOT the shop owner
  select count(*) into n_cust from public.customers;
  select count(*) into n_bot  from public.bot_users;
  select count(*) into n_tok  from public.signature_tokens;
  reset role;
  perform pg_temp.rec('RLS-readall', 'weakness', case when n_cust > 0 and n_bot > 0 and n_tok > 0 then 'CONFIRMED' else 'NOT_REPRODUCIBLE' end,
    format('arbitrary authenticated uid (not an admin) read customers=%s bot_users(telegram ids)=%s signature_tokens=%s; policies are using(true), no owner/admin check', n_cust, n_bot, n_tok));

  -- Any authenticated user deletes a customer -> cascades to contracts/tickets/signatures (RLS does not apply to FK cascades)
  c := pg_temp.mk_customer();
  t := pg_temp.mk_ticket(c);
  insert into public.maintenance_contracts(customer_id, code, start_date, end_date) values (c, 'HD-' || substr(gen_random_uuid()::text,1,8), '2026-01-01', '2026-12-31');
  insert into public.signatures(ticket_id, signer_name, signer_role, signature_png) values (t, 'KH', 'customer', 'x');
  perform pg_temp.act_as('authenticated', stranger);
  with d as (delete from public.customers where id = c returning 1) select count(*) into c_del from d;
  reset role;
  select count(*) into tk_left from public.maintenance_tickets where customer_id = c;
  select count(*) into sg_left from public.signatures where ticket_id = t;
  select count(*) into ct_left from public.maintenance_contracts where customer_id = c;
  perform pg_temp.rec('RLS-cascade', 'weakness', case when c_del = 1 and tk_left = 0 and sg_left = 0 and ct_left = 0 then 'CONFIRMED' else 'NOT_REPRODUCIBLE' end,
    format('authenticated DELETE customer (rows=%s) also removed its tickets/signatures/contracts (left: tickets=%s signatures=%s contracts=%s) - signed maintenance records are destroyed by cascade', c_del, tk_left, sg_left, ct_left));

  -- Observation: no write policies for maintenance_* etc. (writes only via service role)
  t := pg_temp.mk_ticket();
  perform pg_temp.act_as('authenticated', owner);
  begin insert into public.maintenance_tickets(code, customer_id, title) select 'X-' || gen_random_uuid(), customer_id, 'x' from public.maintenance_tickets where id = t; tk_ins := true; exception when others then null; end;
  update public.maintenance_tickets set title = 'changed' where id = t; get diagnostics tk_upd = row_count;
  begin insert into public.products(sku, name) values ('SKU-' || gen_random_uuid(), 'P'); prod_ok := true; exception when others then null; end;
  reset role;
  perform pg_temp.rec('RLS-nowrite', 'info', 'INFO',
    format('authenticated on maintenance_tickets: insert allowed=%s, update rows affected=%s (matches plan: ticket writes only work via service-role admin client). Control: authenticated can insert products=%s (policy from 0002)', tk_ins, tk_upd, prod_ok));
  perform pg_temp.rec('RLS-nowrite-ctl', 'control', case when not tk_ins and tk_upd = 0 and prod_ok then 'OK' else 'FAIL' end, 'write policies exist exactly for the 5 tables of 0002 and not for maintenance_tickets');
end $$;
select current_setting('harness.out');
rollback;
