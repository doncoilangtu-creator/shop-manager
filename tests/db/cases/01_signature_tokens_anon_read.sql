-- F3a: anon (public anon key) reading signature_tokens
\ir ../_lib.sql
begin;
do $$
declare t uuid; tok_ok text; tok_exp text; tok_used text;
        seen_ok bool; seen_exp bool; seen_used bool; n_all int; n_other int; other_t uuid;
begin
  t := pg_temp.mk_ticket(); other_t := pg_temp.mk_ticket();
  tok_ok   := pg_temp.mk_token(t, interval '7 days');
  tok_exp  := pg_temp.mk_token(t, interval '-1 day');
  tok_used := pg_temp.mk_token(t, interval '7 days', true);
  perform pg_temp.mk_token(other_t, interval '7 days');
  perform pg_temp.act_as('anon');
  select count(*) into n_all from public.signature_tokens;                      -- no WHERE: enumerate everything
  select count(*) into n_other from public.signature_tokens where ticket_id = other_t;
  select exists(select 1 from public.signature_tokens where token = tok_ok)   into seen_ok;
  select exists(select 1 from public.signature_tokens where token = tok_exp)  into seen_exp;
  select exists(select 1 from public.signature_tokens where token = tok_used) into seen_used;
  reset role;
  perform pg_temp.rec('F3a', 'weakness', case when seen_ok and n_all >= 2 then 'CONFIRMED' else 'NOT_REPRODUCIBLE' end,
    format('anon SELECT with no filter returned %s token rows (incl. tokens of another ticket: %s); valid token visible=%s',
           n_all, n_other, seen_ok));
  perform pg_temp.rec('F3a-ctl1', 'control', case when not seen_exp then 'OK' else 'FAIL' end, 'expired token hidden from anon (policy filter works)');
  perform pg_temp.rec('F3a-ctl2', 'control', case when not seen_used then 'OK' else 'FAIL' end, 'used token hidden from anon (policy filter works)');
end $$;
select current_setting('harness.out');
rollback;
