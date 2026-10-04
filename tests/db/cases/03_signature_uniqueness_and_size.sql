-- F7: missing unique (ticket_id, signer_role); no size limit on signature_png
\ir ../_lib.sql
begin;
do $$
declare t uuid; has_unique bool; dup_ok bool := false; dup_anon bool := false; big_ok bool := false; n int; big_len int := 5*1024*1024;
begin
  select exists (
    select 1 from pg_index i join pg_class c on c.oid = i.indrelid
    where c.oid = 'public.signatures'::regclass and i.indisunique and not i.indisprimary
      and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
           where a.attrelid = c.oid and a.attnum = any(i.indkey)) @> array['signer_role','ticket_id']) into has_unique;
  t := pg_temp.mk_ticket();
  begin  -- as owner/service_role-equivalent (bypasses RLS) -> only constraints can stop it
    insert into public.signatures(ticket_id, signer_name, signer_role, signature_png) values (t,'A','customer','x'),(t,'B','customer','y');
    select count(*) into n from public.signatures where ticket_id = t and signer_role = 'customer'; dup_ok := n = 2;
  exception when unique_violation then dup_ok := false; end;
  begin  -- privileged insert (bypasses RLS/grants): only the CHECK constraint can stop an oversized PNG
    insert into public.signatures(ticket_id, signer_name, signer_role, signature_png) values (t,'Big','technician', repeat('A', big_len)); big_ok := true;
  exception when others then null; end;
  perform pg_temp.act_as('anon');
  begin
    insert into public.signatures(ticket_id, signer_name, signer_role, signature_png) values (t,'C','customer','z'); dup_anon := true;
  exception when others then null; end;
  reset role;
  perform pg_temp.rec('F7-unique', 'weakness', case when not has_unique and dup_ok then 'CONFIRMED' else 'NOT_REPRODUCIBLE' end,
    format('unique(ticket_id,signer_role) exists=%s; two customer signatures on same ticket inserted (privileged)=%s; third inserted by anon=%s', has_unique, dup_ok, dup_anon));
  perform pg_temp.rec('F7-size', 'weakness', case when big_ok then 'CONFIRMED' else 'NOT_REPRODUCIBLE' end,
    format('privileged insert of a %s MB signature_png: %s (CHECK on length)', big_len/1024/1024, case when big_ok then 'ACCEPTED' else 'rejected' end));
end $$;
select current_setting('harness.out');
rollback;
