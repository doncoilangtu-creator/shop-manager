-- ============================================================================
-- 0019 — Hóa đơn điện tử: THAY THẾ (hóa đơn thay thế) và ĐIỀU CHỈNH (hóa đơn điều chỉnh)
-- * Chỉ LƯU thông tin hóa đơn do nhà cung cấp bên ngoài phát hành (không tích hợp API).
-- * Thêm cột: replaces_id (hóa đơn gốc bị thay thế/điều chỉnh), cqt_code (mã của cơ quan thuế),
--   pdf_url (đường dẫn bản PDF), adjust_amount (số tiền điều chỉnh: âm = giảm, dương = tăng), adjust_reason.
-- * record_sale_einvoice(uuid, jsonb) giữ NGUYÊN chữ ký và hành vi cũ khi không truyền trường mới
--   (post_sale_hkd vẫn gọi được). Thay thế được chọn hóa đơn gốc còn hiệu lực HOẶC đã hủy của chính đơn bán.
-- * HĐĐT có bắt buộc hay không tùy Thuế cơ sở quản lý — ứng dụng chỉ nhắc, không chặn.
-- Forward-only, idempotent. Không tạo bảng mới → RLS của einvoices (0013) giữ nguyên. Cần 0013.
-- ============================================================================

alter table public.einvoices
  add column if not exists replaces_id   uuid references public.einvoices(id) on delete restrict,
  add column if not exists cqt_code      text,
  add column if not exists pdf_url       text,
  add column if not exists adjust_amount numeric(16,2),
  add column if not exists adjust_reason text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'einvoices_cqt_code_chk') then
    alter table public.einvoices add constraint einvoices_cqt_code_chk
      check (cqt_code is null or cqt_code ~ '^[A-Za-z0-9-]{1,50}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'einvoices_pdf_url_chk') then
    alter table public.einvoices add constraint einvoices_pdf_url_chk
      check (pdf_url is null or (pdf_url ~* '^https?://' and char_length(pdf_url) <= 500));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'einvoices_adjust_amount_chk') then
    alter table public.einvoices add constraint einvoices_adjust_amount_chk
      check (adjust_amount is null or (kind = 'adjust' and adjust_amount <> 0));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'einvoices_adjust_reason_chk') then
    alter table public.einvoices add constraint einvoices_adjust_reason_chk
      check (adjust_reason is null or char_length(adjust_reason) <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'einvoices_replaces_kind_chk') then
    alter table public.einvoices add constraint einvoices_replaces_kind_chk
      check (replaces_id is null or (kind in ('replace', 'adjust') and replaces_id <> id));
  end if;
end $$;
create index if not exists idx_einvoices_replaces on public.einvoices(replaces_id) where replaces_id is not null;

-- ---------------------------------------------------------------- RPC (cùng chữ ký với 0013)
-- p: {kind, number, symbol, provider, lookup_code, lookup_url, issued_on, note, return_id,
--     replaces_id, cqt_code, pdf_url, adjust_amount, adjust_reason}
create or replace function public.record_sale_einvoice(p_sale_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.sales_invoices%rowtype; o public.einvoices%rowtype;
  v_kind text := coalesce(public._clean_text(p->>'kind'), 'original');
  v_num text := public._clean_text(p->>'number'); v_sym text := public._clean_text(p->>'symbol');
  v_url text := public._clean_text(p->>'lookup_url'); v_pdf text := public._clean_text(p->>'pdf_url');
  v_cqt text := public._clean_text(p->>'cqt_code'); v_reason text := public._clean_text(left(p->>'adjust_reason', 500));
  v_ret uuid; v_issued date; v_old uuid; v_orig uuid; v_amt numeric; v_id uuid;
begin
  if not public.has_app_access() then raise exception 'forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'einvoice_invalid'; end if;
  select * into s from public.sales_invoices where id = p_sale_id for update;
  if not found then raise exception 'invoice_not_found'; end if;
  if s.voided_at is not null then raise exception 'invoice_voided'; end if;
  if v_kind not in ('original', 'replace', 'adjust') then raise exception 'einvoice_kind_invalid'; end if;
  if v_num is null then raise exception 'einvoice_number_required'; end if;
  if v_num !~ '^[A-Za-z0-9/_-]{1,30}$' then raise exception 'einvoice_number_invalid'; end if;
  if v_sym is not null and v_sym !~ '^[A-Za-z0-9]{1,15}$' then raise exception 'einvoice_symbol_invalid'; end if;
  if v_url is not null and (v_url !~* '^https?://' or char_length(v_url) > 500) then raise exception 'einvoice_url_invalid'; end if;
  if v_pdf is not null and (v_pdf !~* '^https?://' or char_length(v_pdf) > 500) then raise exception 'einvoice_pdf_url_invalid'; end if;
  if v_cqt is not null and v_cqt !~ '^[A-Za-z0-9-]{1,50}$' then raise exception 'einvoice_cqt_code_invalid'; end if;
  begin
    v_issued := coalesce(nullif(btrim(p->>'issued_on'), '')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
    v_ret    := nullif(btrim(p->>'return_id'), '')::uuid;
    v_orig   := nullif(btrim(p->>'replaces_id'), '')::uuid;
    v_amt    := nullif(btrim(p->>'adjust_amount'), '')::numeric;
  exception when others then raise exception 'einvoice_invalid'; end;

  if v_orig is not null then
    if v_kind = 'original' then raise exception 'einvoice_invalid'; end if;
    select * into o from public.einvoices where id = v_orig and sale_id = s.id for update;
    if not found then raise exception 'einvoice_original_not_found'; end if;
    if o.kind not in ('original', 'replace') then raise exception 'einvoice_original_invalid'; end if;
  end if;

  if v_kind = 'adjust' then
    if v_amt is null or v_amt = 0 then raise exception 'einvoice_adjust_amount_required'; end if;
    if abs(v_amt) > 99999999999999 then raise exception 'einvoice_invalid'; end if;
    if v_reason is null or char_length(v_reason) < 5 then raise exception 'einvoice_adjust_reason_required'; end if;
    if v_ret is not null then perform 1 from public.sales_returns where id = v_ret and sale_id = s.id; if not found then raise exception 'return_not_found'; end if; end if;
    if v_orig is null then
      select id into v_orig from public.einvoices where sale_id = s.id and kind in ('original', 'replace') and status = 'issued';
      if v_orig is null then raise exception 'einvoice_nothing_to_adjust'; end if;
    elsif o.status <> 'issued' then
      raise exception 'einvoice_original_not_active';
    end if;
  else
    v_ret := null; v_amt := null; v_reason := null;
    select id into v_old from public.einvoices where sale_id = s.id and kind in ('original', 'replace') and status = 'issued' for update;
    if v_kind = 'original' and v_old is not null then raise exception 'einvoice_already_recorded'; end if;
    if v_kind = 'replace' then
      if v_orig is null then
        if v_old is null then raise exception 'einvoice_nothing_to_replace'; end if;
        v_orig := v_old;                                   -- hành vi cũ: thay thế hóa đơn đang hiệu lực
      elsif o.status = 'replaced' then
        raise exception 'einvoice_already_replaced';
      elsif o.status = 'cancelled' then
        if v_old is not null then raise exception 'einvoice_already_recorded'; end if;
        perform 1 from public.einvoices where replaces_id = o.id and kind = 'replace' and status <> 'cancelled';
        if found then raise exception 'einvoice_already_replaced'; end if;
      end if;
      update public.einvoices set status = 'replaced' where id = v_orig and status = 'issued';
    end if;
  end if;

  begin
    insert into public.einvoices(sale_id, return_id, kind, provider, symbol, number, lookup_code, lookup_url, issued_on, note, created_by,
                                 replaces_id, cqt_code, pdf_url, adjust_amount, adjust_reason)
    values (s.id, v_ret, v_kind, public._clean_text(left(p->>'provider', 100)), v_sym, v_num, public._clean_text(left(p->>'lookup_code', 100)), v_url,
            v_issued, public._clean_text(left(p->>'note', 500)), (select auth.uid()),
            case when v_kind = 'original' then null else v_orig end, v_cqt, v_pdf, round(v_amt, 2), v_reason)
    returning id into v_id;
  exception when unique_violation then
    if sqlerrm like '%uq_einvoices_number%' then raise exception 'einvoice_number_duplicate'; end if;
    raise exception 'einvoice_already_recorded';
  end;
  if v_kind <> 'original' then
    insert into public.accounting_audit(actor, action, detail)
    values ((select auth.uid()), 'record_sale_einvoice_' || v_kind,
            jsonb_build_object('einvoice_id', v_id, 'sale_id', s.id, 'replaces_id', v_orig, 'number', v_num,
                               'adjust_amount', v_amt, 'reason', v_reason));
  end if;
  return (select to_jsonb(e) from public.einvoices e where e.id = v_id);
end $$;

revoke all on function public.record_sale_einvoice(uuid, jsonb) from public, anon;
grant execute on function public.record_sale_einvoice(uuid, jsonb) to authenticated, service_role;
