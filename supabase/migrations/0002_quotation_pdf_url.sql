-- ============================================================================
-- 0002_quotation_pdf_url.sql
-- 1. Adds pdf_url column to quotations (URL of generated PDF in Storage).
-- 2. Adds CRUD RLS policies for authenticated users on core domain tables
--    (quotations, quotation_items, products, customers, suppliers).
--    The single-user shop app assumes any logged-in user can manage data.
-- Idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. pdf_url column
-- ----------------------------------------------------------------------------
alter table public.quotations
  add column if not exists pdf_url text;

comment on column public.quotations.pdf_url is
  'Public/signed URL of the generated PDF stored in the quotations Storage bucket.';

-- ----------------------------------------------------------------------------
-- 2. RLS write policies for authenticated users
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  -- Tables that need full CRUD for the authenticated shop owner.
  for t in select unnest(array[
    'products','customers','suppliers',
    'quotations','quotation_items'
  ]) loop
    execute format('drop policy if exists "auth_insert_%I" on public.%I', t, t);
    execute format('drop policy if exists "auth_update_%I" on public.%I', t, t);
    execute format('drop policy if exists "auth_delete_%I" on public.%I', t, t);
    execute format(
      'create policy "auth_insert_%I" on public.%I for insert to authenticated with check (true)', t, t);
    execute format(
      'create policy "auth_update_%I" on public.%I for update to authenticated using (true) with check (true)', t, t);
    execute format(
      'create policy "auth_delete_%I" on public.%I for delete to authenticated using (true)', t, t);
  end loop;
end$$;
