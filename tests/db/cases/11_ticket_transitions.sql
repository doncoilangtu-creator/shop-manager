-- C2/C7: ticket status state machine enforced by the DB
\ir ../_lib.sql
begin;
do $$
declare t uuid; e text; bad int := 0; detail text := '';
  tos text[]; f text; x text;
begin
  -- every (from,to) pair: DB verdict must equal ticket_transition_allowed()
  for f in select unnest(enum_range(null::public.ticket_status)::text[]) loop
    for x in select unnest(enum_range(null::public.ticket_status)::text[]) loop
      t := pg_temp.mk_ticket();
      perform set_config('session_replication_role', 'replica', true);   -- fixture only: put ticket in state f without walking
      update public.maintenance_tickets set status = f::public.ticket_status where id = t;
      perform set_config('session_replication_role', 'origin', true);
      e := pg_temp.try(format('update public.maintenance_tickets set status = %L where id = %L', x, t));
      if (e = 'OK') <> public.ticket_transition_allowed(f::public.ticket_status, x::public.ticket_status) then
        bad := bad + 1; detail := detail || f || '->' || x || ' ';
      end if;
    end loop;
  end loop;
  perform pg_temp.rec('TKT-matrix', 'control', case when bad = 0 then 'OK' else 'FAIL' end, format('64 transitions checked, mismatches=%s %s', bad, detail));
  t := pg_temp.mk_ticket();
  e := pg_temp.try(format('update public.maintenance_tickets set status = ''signed'' where id = %L', t));
  perform pg_temp.rec('TKT-skip-blocked', 'control', case when e like 'invalid ticket status transition%' then 'OK' else 'FAIL' end, 'received -> signed: ' || e);
  e := pg_temp.try(format('update public.maintenance_tickets set title = ''new title'' where id = %L', t));
  perform pg_temp.rec('TKT-other-update-ok', 'control', case when e = 'OK' then 'OK' else 'FAIL' end, 'non-status updates unaffected');
end $$;
select current_setting('harness.out');
rollback;
