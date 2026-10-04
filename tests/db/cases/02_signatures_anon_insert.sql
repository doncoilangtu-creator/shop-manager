-- F3b: anon inserting signatures without any token; abuse variants
\ir ../_lib.sql
begin;
do $$
declare t_nt uuid; t_used uuid; ok1 bool := false; ok2 bool := false; ok3 bool := false; ok4 bool := false;
        err1 text; sqlst text; sig_cnt int; can_read bool; can_ret bool := false; ret_st text;
begin
  t_nt := pg_temp.mk_ticket();                      -- ticket with NO token at all
  t_used := pg_temp.mk_ticket();
  perform pg_temp.mk_token(t_used, interval '7 days', true);   -- ticket whose only token is already used
  perform pg_temp.act_as('anon');
  begin  -- (1) arbitrary ticket, no token
    insert into public.signatures(ticket_id, signer_name, signer_role, signature_png)
    values (t_nt, 'Attacker', 'customer', 'data:image/png;base64,AAAA'); ok1 := true;
  exception when others then err1 := sqlerrm; end;
  begin  -- (2) ticket whose token was already used
    insert into public.signatures(ticket_id, signer_name, signer_role, signature_png)
    values (t_used, 'Attacker', 'customer', 'x'); ok2 := true;
  exception when others then null; end;
  begin  -- (3) forge the TECHNICIAN signature
    insert into public.signatures(ticket_id, signer_name, signer_role, signature_png)
    values (t_nt, 'Fake Tech', 'technician', 'x'); ok3 := true;
  exception when others then null; end;
  begin  -- (4) arbitrary signed_at (backdating) / ip spoof
    insert into public.signatures(ticket_id, signer_name, signer_role, signature_png, signed_at, ip_address)
    values (t_nt, 'Backdated', 'customer', 'x', '2000-01-01', '1.2.3.4'); ok4 := true;
  exception when others then null; end;
  begin  -- (5) control: anon cannot read back (no select policy / no privilege for anon on signatures)
    select count(*) into sig_cnt from public.signatures; can_read := sig_cnt > 0;
  exception when insufficient_privilege then can_read := false; end;
  begin  -- (6) INSERT ... RETURNING needs SELECT policy -> fails for anon (matters for PostgREST return=representation)
    insert into public.signatures(ticket_id, signer_name, signer_role, signature_png)
    values (t_nt, 'Ret', 'customer', 'x') returning id into strict sqlst; can_ret := true;
  exception when others then ret_st := sqlstate; end;
  reset role;
  perform pg_temp.rec('F3b', 'weakness', case when ok1 then 'CONFIRMED' else 'NOT_REPRODUCIBLE' end,
    format('anon INSERT into signatures for a ticket with no token: %s%s', case when ok1 then 'ACCEPTED' else 'rejected' end, coalesce(' ('||err1||')','')));
  perform pg_temp.rec('F3b-used', 'weakness', case when ok2 then 'CONFIRMED' else 'NOT_REPRODUCIBLE' end, 'anon can sign a ticket whose token was already used (token never checked by DB)');
  perform pg_temp.rec('F3b-tech', 'weakness', case when ok3 then 'CONFIRMED' else 'NOT_REPRODUCIBLE' end, 'anon can insert signer_role=technician (forged technician signature)');
  perform pg_temp.rec('F3b-spoof', 'weakness', case when ok4 then 'CONFIRMED' else 'NOT_REPRODUCIBLE' end, 'anon can set arbitrary signed_at/ip_address (evidence fields client-controlled)');
  perform pg_temp.rec('F3b-ctl1', 'control', case when not can_read then 'OK' else 'FAIL' end, 'anon cannot SELECT signatures (no anon select policy)');
  perform pg_temp.rec('F3b-ret', 'info', 'INFO', format('anon INSERT ... RETURNING: %s (sqlstate %s). With PostgREST default return=minimal the plain insert works.', case when can_ret then 'works' else 'fails' end, coalesce(ret_st,'-')));
end $$;
select current_setting('harness.out');
rollback;
