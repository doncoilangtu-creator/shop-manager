-- Accounting core: double entry, append-only, balanced, reversal, partner dimension
\ir ../_lib.sql
begin;
do $$
declare u uuid := pg_temp.mk_staff(); c uuid := pg_temp.mk_customer(); s uuid := pg_temp.mk_supplier();
  e1 uuid; e2 uuid; r uuid; e text; n int; d numeric; cr numeric; pid uuid;
begin
  perform pg_temp.act_as('authenticated', u);
  e1 := public.post_journal('2025-03-10', 'Góp vốn', jsonb_build_array(
    jsonb_build_object('account','111','debit',50000000), jsonb_build_object('account','411','credit',50000000)));
  e := pg_temp.try($q$select public.post_journal('2025-03-10','x','[{"account":"111","debit":100},{"account":"411","credit":99}]'::jsonb)$q$);
  perform pg_temp.rec('LED-unbalanced-rpc', 'control', pg_temp.ok(e like 'unbalanced:%'), e);
  e := pg_temp.try($q$select public.post_journal('2025-03-10','x','[{"account":"111","debit":100,"credit":100},{"account":"411","credit":0}]'::jsonb)$q$);
  perform pg_temp.rec('LED-line-both-sides', 'control', pg_temp.ok(e like 'line_invalid%'), e);
  e := pg_temp.try($q$select public.post_journal('2025-03-10','x','[{"account":"111","debit":100}]'::jsonb)$q$);
  perform pg_temp.rec('LED-one-line', 'control', pg_temp.ok(e = 'lines_required'), e);
  e := pg_temp.try($q$select public.post_journal('2025-03-10','x','[{"account":"999","debit":100},{"account":"411","credit":100}]'::jsonb)$q$);
  perform pg_temp.rec('LED-unknown-account', 'control', pg_temp.ok(e like '%foreign key%' or e like '%violates%'), left(e, 80));
  e := pg_temp.try(format($q$select public.post_journal('2025-03-10','x','[{"account":"131","debit":100},{"account":"511","credit":100}]'::jsonb)$q$));
  perform pg_temp.rec('LED-131-needs-customer', 'control', pg_temp.ok(e = 'customer_required_for_131'), e);
  e := pg_temp.try(format($q$select public.post_journal('2025-03-10','x','[{"account":"131","debit":100,"customer_id":"%s"},{"account":"511","credit":100,"customer_id":"%s"}]'::jsonb)$q$, c, c));
  perform pg_temp.rec('LED-customer-only-131', 'control', pg_temp.ok(e = 'customer_only_on_131'), e);
  e := pg_temp.try(format($q$select public.post_journal('2025-03-10','x','[{"account":"156","debit":100},{"account":"331","credit":100}]'::jsonb)$q$));
  perform pg_temp.rec('LED-331-needs-supplier', 'control', pg_temp.ok(e = 'supplier_required_for_331'), e);
  reset role;

  -- direct (privileged) inserts cannot bypass the balance rule: force the deferred constraint now
  insert into public.fiscal_periods(year, month, start_date, end_date) values (2025, 4, '2025-04-01', '2025-04-30') on conflict do nothing;
  begin
    insert into public.journal_entries(id, entry_no, entry_date, period_id) values ('00000000-0000-0000-0000-00000000aa01', 'JE-X-1', '2025-04-05', public.ensure_period('2025-04-05'));
    insert into public.journal_lines(entry_id, line_no, account_code, debit) values ('00000000-0000-0000-0000-00000000aa01', 1, '111', 100);
    insert into public.journal_lines(entry_id, line_no, account_code, credit) values ('00000000-0000-0000-0000-00000000aa01', 2, '411', 90);
    set constraints all immediate;
    e := 'accepted';
  exception when others then e := sqlerrm; end;
  set constraints all deferred;
  perform pg_temp.rec('LED-direct-unbalanced', 'control', pg_temp.ok(e like 'unbalanced journal entry%'), left(e, 90));
  begin
    insert into public.journal_entries(id, entry_no, entry_date, period_id) values ('00000000-0000-0000-0000-00000000aa02', 'JE-X-2', '2025-04-05', public.ensure_period('2025-04-05'));
    set constraints all immediate;
    e := 'accepted';
  exception when others then e := sqlerrm; end;
  set constraints all deferred;
  perform pg_temp.rec('LED-direct-no-lines', 'control', pg_temp.ok(e like '%needs at least 2 lines%'), left(e, 90));

  -- append-only
  e := pg_temp.try(format('update public.journal_lines set debit = 1 where entry_id = %L', e1));
  perform pg_temp.rec('LED-no-update', 'control', pg_temp.ok(e like 'ledger is append-only%'), left(e, 70));
  e := pg_temp.try(format('delete from public.journal_entries where id = %L', e1));
  perform pg_temp.rec('LED-no-delete', 'control', pg_temp.ok(e like 'ledger is append-only%'), left(e, 70));
  set constraints all immediate; set constraints all deferred;       -- flush pending deferred checks first
  e := pg_temp.try('truncate public.journal_lines cascade');
  perform pg_temp.rec('LED-no-truncate', 'control', pg_temp.ok(e like 'ledger is append-only%'), left(e, 70));
  pid := public.ensure_period('2025-03-10');
  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try(format($q$insert into public.journal_entries(entry_no, entry_date, period_id) values ('X', '2025-03-10', %L)$q$, pid));
  perform pg_temp.rec('LED-staff-no-direct-insert', 'control', pg_temp.ok(e like 'permission denied%' or e like '%row-level security%'), left(e, 70));
  reset role;
  perform pg_temp.act_as('anon');
  e := pg_temp.try($q$select public.post_journal('2025-03-10','x','[]'::jsonb)$q$);
  perform pg_temp.rec('LED-anon-denied', 'control', pg_temp.ok(e like 'permission denied%'), e);
  reset role;
  perform pg_temp.act_as('authenticated', gen_random_uuid());
  e := pg_temp.try($q$select public.post_journal('2025-03-10','x','[{"account":"111","debit":1},{"account":"411","credit":1}]'::jsonb)$q$);
  perform pg_temp.rec('LED-nonstaff-denied', 'control', pg_temp.ok(e = 'forbidden'), e);
  reset role;

  -- reversal
  perform pg_temp.act_as('authenticated', u);
  e1 := public.post_journal('2025-03-12', 'Bán chịu', jsonb_build_array(
    jsonb_build_object('account','131','debit',1100,'customer_id',c), jsonb_build_object('account','511','credit',1000), jsonb_build_object('account','3331','credit',100)));
  r := public.reverse_journal(e1, '2025-03-20', 'sai');
  e := pg_temp.try(format('select public.reverse_journal(%L)', e1));
  perform pg_temp.rec('LED-reverse-twice', 'control', pg_temp.ok(e = 'already_reversed'), e);
  e := pg_temp.try(format('select public.reverse_journal(%L)', r));
  perform pg_temp.rec('LED-reverse-of-reversal', 'control', pg_temp.ok(e = 'cannot_reverse_a_reversal'), e);
  reset role;
  select count(*) into n from public.journal_lines where entry_id = r;
  select sum(l2.debit - l1.credit) + sum(l2.credit - l1.debit) into d from public.journal_lines l1 join public.journal_lines l2 on l2.line_no = l1.line_no and l2.entry_id = r where l1.entry_id = e1;
  perform pg_temp.rec('LED-reversal-mirror', 'control', pg_temp.ok(n = 3 and d = 0 and (select reverses_id from public.journal_entries where id = r) = e1 and (select entry_date from public.journal_entries where id = r) = '2025-03-20'),
    format('reversal has %s lines, mirrors the original, dated 2025-03-20, links reverses_id', n));
  perform pg_temp.rec('LED-reversal-nets-to-zero', 'control', pg_temp.ok(pg_temp.bal('131') = 0 and pg_temp.bal('511') = 0 and pg_temp.bal('3331') = 0 and pg_temp.bal('111') = 50000000),
    format('after reversal: 131=%s 511=%s 3331=%s 111=%s', pg_temp.bal('131'), pg_temp.bal('511'), pg_temp.bal('3331'), pg_temp.bal('111')));
  select sum(debit), sum(credit) into d, cr from public.trial_balance();
  perform pg_temp.rec('LED-trial-balance', 'control', pg_temp.ok(d = cr and d > 0), format('trial balance debit=%s credit=%s', d, cr));
  e := pg_temp.try($q$select * from public.trial_balance('2025-03-11', '2025-03-31')$q$);
  perform pg_temp.rec('LED-entry-numbering', 'control', pg_temp.ok((select count(distinct entry_no) = count(*) from public.journal_entries) and (select entry_no from public.journal_entries where id = e1) ~ '^JE-2025-[0-9]{6}$'),
    'entry numbers unique and formatted JE-YYYY-NNNNNN');
end $$;
select current_setting('harness.out');
rollback;
