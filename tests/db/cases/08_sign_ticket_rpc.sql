-- C2/C7: sign_ticket() RPC behaviour (atomic, single use, state-aware, service_role only)
\ir ../_lib.sql
begin;
do $$
declare t uuid; t2 uuid; t3 uuid; tk1 text; tk2 text; tk_exp text; tk_other text; r jsonb; e text; st text; n int;
  png text := repeat('A', 60);
begin
  t := pg_temp.ticket_in('completed');
  tk1 := pg_temp.mk_token(t, interval '7 days'); tk2 := pg_temp.mk_token(t, interval '7 days');
  perform pg_temp.act_as('service_role');
  r := public.sign_ticket(tk1, t, 'Khach', 'customer', png, '1.2.3.4', 'UA');
  reset role;
  select status::text into st from public.maintenance_tickets where id = t;
  perform pg_temp.rec('SIGN-first', 'control', case when r->>'status' = 'awaiting_signature' and st = 'awaiting_signature' and (r->>'both_signed')::bool = false then 'OK' else 'FAIL' end,
    format('first signature moves completed -> awaiting_signature (rpc=%s, row=%s)', r->>'status', st));
  select count(*) into n from public.signature_tokens where ticket_id = t and used_at is not null;
  perform pg_temp.rec('SIGN-token-consumed', 'control', case when n = 2 then 'OK' else 'FAIL' end, format('used token + all other unused tokens of the ticket consumed (%s of 2)', n));

  perform pg_temp.act_as('service_role');
  e := pg_temp.try(format('select public.sign_ticket(%L, %L, ''K2'', ''customer'', %L)', tk1, t, png));
  perform pg_temp.rec('SIGN-reuse', 'control', case when e = 'token_used' then 'OK' else 'FAIL' end, 'reusing a consumed token -> ' || e);
  reset role;

  -- second role with a fresh token -> signed
  tk2 := pg_temp.mk_token(t, interval '7 days');
  perform pg_temp.act_as('service_role');
  r := public.sign_ticket(tk2, t, 'KTV', 'technician', png);
  e := pg_temp.try(format('select public.sign_ticket(%L, %L, ''Dup'', ''technician'', %L)', pg_temp.mk_token(t, interval '1 day'), t, png));
  reset role;
  select status::text into st from public.maintenance_tickets where id = t;
  perform pg_temp.rec('SIGN-both', 'control', case when r->>'status' = 'signed' and st = 'signed' then 'OK' else 'FAIL' end, 'second role -> signed: ' || st);
  perform pg_temp.rec('SIGN-ticket-final', 'control', case when e in ('already_signed','ticket_not_signable') then 'OK' else 'FAIL' end, 'signing a signed ticket again -> ' || e);

  -- duplicate role on awaiting_signature ticket -> already_signed (unique constraint, not a 500)
  t2 := pg_temp.ticket_in('completed');
  perform pg_temp.act_as('service_role');
  perform public.sign_ticket(pg_temp.mk_token(t2, interval '1 day'), t2, 'A', 'customer', png);
  e := pg_temp.try(format('select public.sign_ticket(%L, %L, ''B'', ''customer'', %L)', (select pg_temp.mk_token(t2, interval '1 day')), t2, png));
  reset role;
  perform pg_temp.rec('SIGN-dup-role', 'control', case when e = 'already_signed' then 'OK' else 'FAIL' end, 'same role twice -> ' || e);

  -- expired / mismatch / not signable / unknown token / too large
  t3 := pg_temp.ticket_in('completed');
  tk_exp := pg_temp.mk_token(t3, interval '-1 hour');
  tk_other := pg_temp.mk_token(pg_temp.ticket_in('completed'), interval '1 day');
  perform pg_temp.act_as('service_role');
  e := pg_temp.try(format('select public.sign_ticket(%L, %L, ''x'', ''customer'', %L)', tk_exp, t3, png));
  perform pg_temp.rec('SIGN-expired', 'control', case when e = 'token_expired' then 'OK' else 'FAIL' end, e);
  e := pg_temp.try(format('select public.sign_ticket(%L, %L, ''x'', ''customer'', %L)', tk_other, t3, png));
  perform pg_temp.rec('SIGN-mismatch', 'control', case when e = 'token_ticket_mismatch' then 'OK' else 'FAIL' end, e);
  e := pg_temp.try(format('select public.sign_ticket(%L, %L, ''x'', ''customer'', %L)', 'nope', t3, png));
  perform pg_temp.rec('SIGN-unknown', 'control', case when e = 'token_not_found' then 'OK' else 'FAIL' end, e);
  e := pg_temp.try(format('select public.sign_ticket(%L, %L, ''x'', ''customer'', %L)', pg_temp.mk_token(t3, interval '1 day'), t3, repeat('A', 300001)));
  perform pg_temp.rec('SIGN-toolarge', 'control', case when e = 'signature_too_large' then 'OK' else 'FAIL' end, e);
  reset role;
  t3 := pg_temp.mk_ticket();      -- status received
  perform pg_temp.act_as('service_role');
  e := pg_temp.try(format('select public.sign_ticket(%L, %L, ''x'', ''customer'', %L)', pg_temp.mk_token(t3, interval '1 day'), t3, png));
  reset role;
  select count(*) into n from public.signatures where ticket_id = t3;
  perform pg_temp.rec('SIGN-notready', 'control', case when e = 'ticket_not_signable' and n = 0 then 'OK' else 'FAIL' end, 'ticket still in "received": ' || e);

  -- not callable by anon / authenticated(staff)
  t3 := pg_temp.ticket_in('completed'); tk1 := pg_temp.mk_token(t3, interval '1 day');
  perform pg_temp.act_as('anon');
  e := pg_temp.try(format('select public.sign_ticket(%L, %L, ''x'', ''customer'', %L)', tk1, t3, png));
  perform pg_temp.rec('SIGN-anon-denied', 'control', case when e like 'permission denied%' then 'OK' else 'FAIL' end, 'anon: ' || e);
  reset role;
  perform pg_temp.act_as('authenticated', pg_temp.mk_staff());
  e := pg_temp.try(format('select public.sign_ticket(%L, %L, ''x'', ''customer'', %L)', tk1, t3, png));
  perform pg_temp.rec('SIGN-staff-denied', 'control', case when e like 'permission denied%' then 'OK' else 'FAIL' end, 'authenticated staff (must go through the API route): ' || e);
  reset role;

  -- evidence immutable
  e := pg_temp.try(format('update public.signatures set signer_name = ''hacked'' where ticket_id = %L', t));
  perform pg_temp.rec('SIGN-immutable-upd', 'control', case when e like 'signatures are immutable%' then 'OK' else 'FAIL' end, e);
  e := pg_temp.try(format('delete from public.signatures where ticket_id = %L', t));
  perform pg_temp.rec('SIGN-immutable-del', 'control', case when e like 'signatures are immutable%' then 'OK' else 'FAIL' end, e);
  e := pg_temp.try(format('delete from public.maintenance_tickets where id = %L', t));
  perform pg_temp.rec('SIGN-ticket-delete-blocked', 'control', case when e like '%violates foreign key%' then 'OK' else 'FAIL' end, 'deleting a ticket that has signatures: ' || left(e, 80));
end $$;
select current_setting('harness.out');
rollback;
