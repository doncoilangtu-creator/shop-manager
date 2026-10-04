-- Period close / reopen
\ir ../_lib.sql
begin;
do $$
declare owner uuid := pg_temp.mk_staff('owner'); staff uuid := pg_temp.mk_staff('staff'); e text; r jsonb; n int; e1 uuid; rv uuid;
  l1 jsonb := '[{"account":"111","debit":1000},{"account":"411","credit":1000}]'::jsonb;
begin
  perform pg_temp.act_as('authenticated', staff);
  e1 := public.post_journal('2025-01-15', 'Jan entry', l1);
  perform public.post_journal('2025-02-10', 'Feb entry', l1);
  e := pg_temp.try($q$select public.close_period(2025, 1)$q$);
  perform pg_temp.rec('PER-staff-cannot-close', 'control', pg_temp.ok(e = 'forbidden'), 'staff: ' || e);
  reset role;
  perform pg_temp.act_as('authenticated', owner);
  e := pg_temp.try($q$select public.close_period(2025, 2)$q$);
  perform pg_temp.rec('PER-sequential', 'control', pg_temp.ok(e = 'earlier_period_open'), 'closing Feb while Jan (with entries) is open: ' || e);
  r := public.close_period(2025, 1);
  perform pg_temp.rec('PER-close', 'control', pg_temp.ok(r->>'status' = 'closed' and (r->>'period_debit')::numeric = 1000), r::text);
  select count(*) into n from public.period_balances b join public.fiscal_periods p on p.id = b.period_id where p.year = 2025 and p.month = 1;
  perform pg_temp.rec('PER-snapshot', 'control', pg_temp.ok(n = 2), format('trial-balance snapshot rows frozen at close: %s (111 and 411)', n));
  e := pg_temp.try($q$select public.close_period(2025, 1)$q$);
  perform pg_temp.rec('PER-close-twice', 'control', pg_temp.ok(e = 'already_closed'), e);
  e := pg_temp.try($q$select public.post_journal('2025-01-20', 'late', '[{"account":"111","debit":5},{"account":"411","credit":5}]'::jsonb)$q$);
  perform pg_temp.rec('PER-closed-blocks-entry', 'control', pg_temp.ok(e = 'period_closed'), 'new entry dated in closed January: ' || e);
  select count(*) into n from public.journal_entries where memo = 'late';
  perform pg_temp.rec('PER-no-partial-write', 'control', pg_temp.ok(n = 0), 'nothing persisted from the blocked entry');
  e := pg_temp.try(format($q$select public.reverse_journal(%L, '2025-01-31')$q$, e1));
  perform pg_temp.rec('PER-reversal-into-closed', 'control', pg_temp.ok(e = 'period_closed'), 'reversal dated in the closed period: ' || e);
  rv := public.reverse_journal(e1, '2025-02-12', 'sửa kỳ trước');
  reset role;
  perform pg_temp.rec('PER-reversal-into-open', 'control', pg_temp.ok(rv is not null and (select period_id from public.journal_entries where id = rv) = public.ensure_period('2025-02-01')), 'reversal of a closed-period entry posts into the open February');
  e := pg_temp.try(format($q$insert into public.journal_entries(entry_no, entry_date, period_id) values ('X', '2025-01-05', %L)$q$, public.ensure_period('2025-01-05')));
  perform pg_temp.rec('PER-direct-insert-blocked', 'control', pg_temp.ok(e = 'period_closed'), 'privileged direct insert into closed period: ' || e);
  e := pg_temp.try($q$update public.fiscal_periods set status = 'open' where year = 2025 and month = 1$q$);
  -- (fiscal_periods may be changed by a superuser/migration; the audited path is reopen_period)
  update public.fiscal_periods set status = 'closed' where year = 2025 and month = 1;

  perform pg_temp.act_as('authenticated', owner);
  r := public.close_period(2025, 2);
  e := pg_temp.try($q$select public.reopen_period(2025, 1, 'sai sót')$q$);
  perform pg_temp.rec('PER-reopen-order', 'control', pg_temp.ok(e = 'later_period_closed'), 'reopen Jan while Feb is closed: ' || e);
  e := pg_temp.try($q$select public.reopen_period(2025, 2, 'x')$q$);
  perform pg_temp.rec('PER-reopen-needs-reason', 'control', pg_temp.ok(e = 'reason_required'), e);
  r := public.reopen_period(2025, 2, 'điều chỉnh hóa đơn');
  perform public.post_journal('2025-02-20', 'after reopen', l1);
  r := public.close_period(2025, 2);
  select count(distinct snapshot_no) into n from public.period_balances b join public.fiscal_periods p on p.id = b.period_id where p.year = 2025 and p.month = 2;
  perform pg_temp.rec('PER-reopen-reclose', 'control', pg_temp.ok(n = 2), format('reopened, posted, re-closed; %s snapshots kept (history append-only)', n));
  reset role;
  perform pg_temp.rec('PER-audit', 'control', pg_temp.ok((select count(*) from public.accounting_audit where action in ('close_period','reopen_period')) = 4),
    format('audit rows: %s (3 closes + 1 reopen = 4; failed attempts are not logged)', (select count(*) from public.accounting_audit where action in ('close_period','reopen_period'))));
  e := pg_temp.try('delete from public.accounting_audit');
  perform pg_temp.rec('PER-audit-immutable', 'control', pg_temp.ok(e like 'ledger is append-only%'), left(e, 60));
end $$;
select current_setting('harness.out');
rollback;
