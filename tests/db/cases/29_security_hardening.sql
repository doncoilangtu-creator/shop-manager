-- 0011: advisor hardening (trigger fns not callable via RPC, pinned search_path, business RPCs/RLS helpers untouched)
\ir ../_lib.sql
begin;
do $$
declare n int; f text; bad text := '';
begin
  -- (a) trigger-only SECURITY DEFINER functions: not executable by anon/authenticated
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname in ('trg_je_period','trg_jl_rules','trg_products_opening_stock','trg_stock_movement_apply','trg_stock_movement_costing')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  perform pg_temp.rec('HARD-trigger-fns-revoked', 'control', pg_temp.ok(n = 0), format('%s trigger SECURITY DEFINER functions still executable by anon/authenticated', n));

  -- (b) every public function in the hardening list has a pinned search_path
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname in ('set_updated_at','ticket_transition_allowed','_method_account','trg_je_balanced','trg_signatures_immutable','trg_ticket_status_guard','trg_stock_ledger_append_only','trg_products_stock_guard','trg_ledger_immutable','trg_doc_immutable','trg_quotation_guard','trg_quotation_items_guard')
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
  perform pg_temp.rec('HARD-search-path-pinned', 'control', pg_temp.ok(n = 0), format('%s of the 12 functions without a pinned search_path', n));

  -- business RPCs + RLS helpers must stay callable by authenticated
  foreach f in array array['post_journal(date,text,jsonb,text,uuid,uuid)','reverse_sales_invoice(uuid,date,text)','stock_adjust(uuid,stock_movement_type,integer,numeric,text,uuid,text)','is_staff()','is_owner()','has_app_access()'] loop
    if not has_function_privilege('authenticated', ('public.' || f)::regprocedure, 'execute') then bad := bad || f || ' '; end if;
  end loop;
  perform pg_temp.rec('HARD-business-rpcs-kept', 'control', pg_temp.ok(bad = ''), 'authenticated can still execute business RPCs/helpers; missing: ' || coalesce(nullif(bad, ''), 'none'));

  -- (c) policy wraps auth.uid() in a sub-select
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'app_users' and policyname = 'app_users_self_read' and qual ~* 'select auth\.uid\(\)';
  perform pg_temp.rec('HARD-policy-initplan', 'control', pg_temp.ok(n = 1), 'app_users_self_read uses (select auth.uid())');
end $$;
select current_setting('harness.out', true);
rollback;
