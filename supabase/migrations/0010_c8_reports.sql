-- C8: server-side aggregates for the dashboard and reports. All functions are SECURITY INVOKER (RLS applies) and
-- check is_staff() explicitly so a non-staff session gets an error, not a silently empty report.
-- Revenue / COGS come from the GL (accounts 511 / 632) so reversals and voided invoices net out automatically.
-- Month boundaries are Asia/Ho_Chi_Minh.

create or replace function public.report_dashboard()
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_start date := date_trunc('month', (now() at time zone 'Asia/Ho_Chi_Minh'))::date;
  v_end   date := (date_trunc('month', (now() at time zone 'Asia/Ho_Chi_Minh')) + interval '1 month - 1 day')::date;
  r jsonb;
begin
  if not public.is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  select jsonb_build_object(
    'products',            (select count(*) from public.products),
    'low_stock',           (select count(*) from public.low_stock_products),
    'customers',           (select count(*) from public.customers),
    'business_customers',  (select count(*) from public.customers where type = 'business'),
    'open_tickets',        (select count(*) from public.maintenance_tickets where status not in ('closed', 'signed')),
    'pending_quotations',  (select count(*) from public.quotations where status = 'sent'),
    'month_revenue',       coalesce((select sum(l.credit - l.debit) from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
                                      where l.account_code = '511' and e.entry_date between v_start and v_end), 0),
    'month_cogs',          coalesce((select sum(l.debit - l.credit) from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
                                      where l.account_code = '632' and e.entry_date between v_start and v_end), 0),
    'ar_balance',          public.account_balance('131'),
    'ap_balance',          public.account_balance('331'),
    'stock_value',         public.account_balance('156'),
    'overdue_invoices',    (select count(*) from public.v_sales_invoice_open where outstanding > 0 and due_date < (now() at time zone 'Asia/Ho_Chi_Minh')::date)
  ) into r;
  return r;
end $$;

create or replace function public.report_monthly_pnl(p_from date, p_to date)
returns table(month date, revenue numeric, cogs numeric, gross_profit numeric)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
  if not public.is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  with m as (select generate_series(date_trunc('month', p_from)::date, date_trunc('month', p_to)::date, interval '1 month')::date as d),
  s as (
    select date_trunc('month', e.entry_date)::date as d,
           coalesce(sum(l.credit - l.debit) filter (where l.account_code = '511'), 0) as rev,
           coalesce(sum(l.debit - l.credit) filter (where l.account_code = '632'), 0) as cg
      from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
     where l.account_code in ('511', '632') and e.entry_date between p_from and p_to
     group by 1)
  select m.d, coalesce(s.rev, 0)::numeric, coalesce(s.cg, 0)::numeric, (coalesce(s.rev, 0) - coalesce(s.cg, 0))::numeric
    from m left join s on s.d = m.d order by m.d;
end $$;

create or replace function public.report_top_products(p_from date, p_to date, p_limit int default 10)
returns table(product_id uuid, sku text, name text, qty bigint, revenue numeric, cogs numeric, margin numeric)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
  if not public.is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select l.product_id, p.sku, p.name, sum(l.qty)::bigint, sum(l.line_net)::numeric, sum(l.line_cogs)::numeric, (sum(l.line_net) - sum(l.line_cogs))::numeric
    from public.sales_invoice_lines l
    join public.sales_invoices i on i.id = l.invoice_id and i.voided_at is null
    left join public.products p on p.id = l.product_id
   where i.invoice_date between p_from and p_to and l.product_id is not null
   group by l.product_id, p.sku, p.name
   order by sum(l.line_net) desc, p.name
   limit greatest(1, least(coalesce(p_limit, 10), 100));
end $$;

create or replace function public.report_top_customers(p_from date, p_to date, p_limit int default 10)
returns table(customer_id uuid, name text, invoices bigint, revenue numeric, outstanding numeric)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
  if not public.is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select c.id, c.name, count(*)::bigint, sum(i.subtotal)::numeric,
         coalesce(sum(o.outstanding), 0)::numeric
    from public.sales_invoices i
    join public.customers c on c.id = i.customer_id
    left join public.v_sales_invoice_open o on o.invoice_id = i.id
   where i.voided_at is null and i.invoice_date between p_from and p_to
   group by c.id, c.name
   order by sum(i.subtotal) desc, c.name
   limit greatest(1, least(coalesce(p_limit, 10), 100));
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.report_dashboard()', 'public.report_monthly_pnl(date, date)',
                           'public.report_top_products(date, date, int)', 'public.report_top_customers(date, date, int)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
