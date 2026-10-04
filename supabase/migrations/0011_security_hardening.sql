-- 0011_security_hardening.sql
-- Fixes Supabase advisor findings (security) without changing behaviour or touching indexes:
--   (a) trigger-only SECURITY DEFINER functions must not be callable through /rest/v1/rpc/*
--       (EXECUTE is not checked when a trigger fires, so triggers keep working);
--   (b) pin search_path on the 12 functions that had a role-mutable search_path
--       (all bodies reference tables schema-qualified; types/functions resolve via public);
--   (c) policy app_users_self_read: auth.uid() wrapped in (select ...) so it is evaluated once per statement.
-- Business RPCs (post_*, reverse_*, stock_*, ...) and RLS helpers (is_staff/is_owner/has_app_access) are NOT touched.

-- (a) ---------------------------------------------------------------------------------------------
revoke execute on function public.trg_je_period()              from public, anon, authenticated;
revoke execute on function public.trg_jl_rules()               from public, anon, authenticated;
revoke execute on function public.trg_products_opening_stock() from public, anon, authenticated;
revoke execute on function public.trg_stock_movement_apply()   from public, anon, authenticated;
revoke execute on function public.trg_stock_movement_costing() from public, anon, authenticated;

-- (b) ---------------------------------------------------------------------------------------------
alter function public.set_updated_at()                                         set search_path = public, pg_temp;
alter function public.ticket_transition_allowed(ticket_status, ticket_status)  set search_path = public, pg_temp;
alter function public._method_account(text)                                    set search_path = public, pg_temp;
alter function public.trg_je_balanced()                                        set search_path = public, pg_temp;
alter function public.trg_signatures_immutable()                               set search_path = public, pg_temp;
alter function public.trg_ticket_status_guard()                                set search_path = public, pg_temp;
alter function public.trg_stock_ledger_append_only()                           set search_path = public, pg_temp;
alter function public.trg_products_stock_guard()                               set search_path = public, pg_temp;
alter function public.trg_ledger_immutable()                                   set search_path = public, pg_temp;
alter function public.trg_doc_immutable()                                      set search_path = public, pg_temp;
alter function public.trg_quotation_guard()                                    set search_path = public, pg_temp;
alter function public.trg_quotation_items_guard()                              set search_path = public, pg_temp;

-- (c) ---------------------------------------------------------------------------------------------
alter policy "app_users_self_read" on public.app_users using (user_id = (select auth.uid()));
