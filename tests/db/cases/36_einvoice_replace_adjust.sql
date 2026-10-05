-- 0019 (A8): hóa đơn điện tử THAY THẾ / ĐIỀU CHỈNH qua record_sale_einvoice(uuid, jsonb) (rolled back)
\ir ../_lib.sql
begin;
do $$
declare
  u uuid := pg_temp.mk_staff('owner'); u2 uuid := pg_temp.mk_staff('staff'); nobody uuid;
  p uuid := pg_temp.mk_product(0, 0);
  sa uuid; sb uuid; sc uuid; sd uuid; o1 jsonb; r1 jsonb; r2 jsonb; a1 jsonb; ob jsonb; rb jsonb; oc jsonb; old jsonb;
  e text; n int; n_je int; m0 int;
begin
  insert into auth.users(id, email) values (gen_random_uuid(), 'nobody36@test.local') returning id into nobody;
  perform pg_temp.act_as('authenticated', u);
  perform public.post_purchase_bill(pg_temp.mk_supplier(), '2026-02-02', null, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 20, 'unit_cost', 100000, 'vat_rate', 0)), 'NCC-36');
  sa := (public.post_sale_hkd(null, '2026-05-10', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1, 'unit_price', 500000)), jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 500000)))->>'invoice_id')::uuid;
  sb := (public.post_sale_hkd(null, '2026-05-11', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1, 'unit_price', 400000)), jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 400000)))->>'invoice_id')::uuid;
  sc := (public.post_sale_hkd(null, '2026-05-12', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1, 'unit_price', 300000)), jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 300000)))->>'invoice_id')::uuid;
  sd := (public.post_sale_hkd(null, '2026-05-13', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1, 'unit_price', 200000)), jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 200000)))->>'invoice_id')::uuid;
  m0 := (select count(*) from public.v_sales_missing_einvoice);

  -- ------------------------------------------------------------ payload cũ vẫn chạy
  old := public.record_sale_einvoice(sd, '{"symbol":"C26TBB","number":"0000900","lookup_code":"OLD1","provider":"NCC"}'::jsonb);
  perform pg_temp.rec('EI8-old-payload', 'control', pg_temp.ok((old->>'kind') = 'original' and (old->>'status') = 'issued' and (old->>'replaces_id') is null and (old->>'adjust_amount') is null
        and (old->>'cqt_code') is null and (old->>'pdf_url') is null), 'payload cũ (không trường mới) -> original/issued, cột mới null');
  perform pg_temp.rec('EI8-old-no-audit', 'control', pg_temp.ok(not exists (select 1 from public.accounting_audit where detail->>'einvoice_id' = old->>'id')), 'ghi mới không ghi accounting_audit (như cũ)');

  -- ------------------------------------------------------------ thay thế hóa đơn đang hiệu lực
  o1 := public.record_sale_einvoice(sa, '{"symbol":"C26TBB","number":"0000901","cqt_code":"M1-26-ABC12","pdf_url":"https://hd.example.vn/901.pdf"}'::jsonb);
  perform pg_temp.rec('EI8-new-fields', 'control', pg_temp.ok((o1->>'cqt_code') = 'M1-26-ABC12' and (o1->>'pdf_url') = 'https://hd.example.vn/901.pdf'), 'lưu mã CQT + PDF');
  r1 := public.record_sale_einvoice(sa, jsonb_build_object('kind', 'replace', 'symbol', 'C26TBB', 'number', '0000902', 'replaces_id', o1->>'id'));
  perform pg_temp.rec('EI8-replace-active', 'control', pg_temp.ok((select status from public.einvoices where id = (o1->>'id')::uuid) = 'replaced' and (r1->>'status') = 'issued'
        and (r1->>'replaces_id') = (o1->>'id') and (select count(*) from public.einvoices where sale_id = sa and status = 'issued') = 1),
        'thay thế HĐ hiệu lực: gốc -> replaced, bản thay thế trỏ replaces_id, đúng 1 bản hiệu lực');
  perform pg_temp.rec('EI8-replace-audit', 'control', pg_temp.ok(exists (select 1 from public.accounting_audit where action = 'record_sale_einvoice_replace' and detail->>'einvoice_id' = r1->>'id' and detail->>'replaces_id' = o1->>'id')),
        'thay thế ghi accounting_audit');
  -- thay thế lại bản đã bị thay thế -> từ chối
  e := pg_temp.try(format($q$select public.record_sale_einvoice(%L, jsonb_build_object('kind','replace','number','0000903','replaces_id',%L))$q$, sa, o1->>'id'));
  perform pg_temp.rec('EI8-reject-already-replaced', 'control', pg_temp.ok(e = 'einvoice_already_replaced'), e);
  -- replace không chỉ định gốc -> thay bản đang hiệu lực (hành vi cũ)
  r2 := public.record_sale_einvoice(sa, '{"kind":"replace","number":"0000904"}'::jsonb);
  perform pg_temp.rec('EI8-replace-implicit', 'control', pg_temp.ok((r2->>'replaces_id') = (r1->>'id') and (select status from public.einvoices where id = (r1->>'id')::uuid) = 'replaced'),
        'replace không có replaces_id -> thay bản đang hiệu lực (thay thế chuỗi)');
  e := pg_temp.try(format($q$select public.record_sale_einvoice(%L, '{"kind":"replace","number":"0000905"}'::jsonb)$q$, sb));
  perform pg_temp.rec('EI8-replace-nothing', 'control', pg_temp.ok(e = 'einvoice_nothing_to_replace'), 'đơn chưa có HĐ: ' || e);
  e := pg_temp.try(format($q$select public.record_sale_einvoice(%L, jsonb_build_object('kind','replace','number','0000906','replaces_id',%L))$q$, sb, r2->>'id'));
  perform pg_temp.rec('EI8-replace-other-sale', 'control', pg_temp.ok(e = 'einvoice_original_not_found'), 'gốc thuộc đơn khác: ' || e);
  e := pg_temp.try(format($q$select public.record_sale_einvoice(%L, jsonb_build_object('kind','original','number','0000907','replaces_id',%L))$q$, sa, r2->>'id'));
  perform pg_temp.rec('EI8-original-with-replaces', 'control', pg_temp.ok(e = 'einvoice_invalid'), 'original kèm replaces_id: ' || e);

  -- ------------------------------------------------------------ thay thế HĐ đã hủy khi không còn bản hiệu lực
  ob := public.record_sale_einvoice(sb, '{"symbol":"C26TBB","number":"0000910"}'::jsonb);
  perform public.cancel_sale_einvoice((ob->>'id')::uuid, 'Sai thông tin người mua');
  rb := public.record_sale_einvoice(sb, jsonb_build_object('kind', 'replace', 'symbol', 'C26TBB', 'number', '0000911', 'replaces_id', ob->>'id'));
  perform pg_temp.rec('EI8-replace-cancelled', 'control', pg_temp.ok((rb->>'status') = 'issued' and (rb->>'replaces_id') = (ob->>'id') and (select status from public.einvoices where id = (ob->>'id')::uuid) = 'cancelled'),
        'thay thế HĐ đã hủy (không còn bản hiệu lực): gốc giữ cancelled, bản mới issued');
  e := pg_temp.try(format($q$select public.record_sale_einvoice(%L, jsonb_build_object('kind','replace','number','0000912','replaces_id',%L))$q$, sb, ob->>'id'));
  perform pg_temp.rec('EI8-cancelled-active-exists', 'control', pg_temp.ok(e = 'einvoice_already_recorded'), 'thay HĐ đã hủy khi đã có bản hiệu lực: ' || e);
  perform public.cancel_sale_einvoice((rb->>'id')::uuid, 'Hủy bản thay thế');
  e := pg_temp.try(format($q$select public.record_sale_einvoice(%L, jsonb_build_object('kind','replace','number','0000913','replaces_id',%L))$q$, sb, ob->>'id'));
  perform pg_temp.rec('EI8-cancelled-replaced-again', 'control', pg_temp.ok(e = 'OK'), 'bản thay thế trước đã hủy -> được thay thế lại: ' || e);

  -- ------------------------------------------------------------ điều chỉnh
  n_je := (select count(*) from public.journal_entries);
  e := pg_temp.try(format($q$select public.record_sale_einvoice(%L, '{"kind":"adjust","number":"0000920","adjust_amount":-50000,"adjust_reason":"Giảm giá sau bán"}'::jsonb)$q$, sc));
  perform pg_temp.rec('EI8-adjust-needs-active', 'control', pg_temp.ok(e = 'einvoice_nothing_to_adjust'), 'chưa có HĐ hiệu lực: ' || e);
  e := pg_temp.try(format($q$select public.record_sale_einvoice(%L, jsonb_build_object('kind','adjust','number','0000921','adjust_amount',-50000,'adjust_reason','Giảm giá sau bán','replaces_id',%L))$q$, sa, o1->>'id'));
  perform pg_temp.rec('EI8-adjust-replaced-original', 'control', pg_temp.ok(e = 'einvoice_original_not_active'), 'điều chỉnh HĐ đã bị thay thế: ' || e);
  oc := public.record_sale_einvoice(sc, '{"symbol":"C26TBB","number":"0000922"}'::jsonb);
  e := pg_temp.try(format($q$select public.record_sale_einvoice(%L, '{"kind":"adjust","number":"0000923","adjust_reason":"Giảm giá sau bán"}'::jsonb)$q$, sc));
  perform pg_temp.rec('EI8-adjust-amount-required', 'control', pg_temp.ok(e = 'einvoice_adjust_amount_required'), 'thiếu số tiền: ' || e);
  e := pg_temp.try(format($q$select public.record_sale_einvoice(%L, '{"kind":"adjust","number":"0000923","adjust_amount":0,"adjust_reason":"Giảm giá sau bán"}'::jsonb)$q$, sc));
  perform pg_temp.rec('EI8-adjust-amount-nonzero', 'control', pg_temp.ok(e = 'einvoice_adjust_amount_required'), 'số tiền 0: ' || e);
  e := pg_temp.try(format($q$select public.record_sale_einvoice(%L, '{"kind":"adjust","number":"0000923","adjust_amount":-50000,"adjust_reason":"sai"}'::jsonb)$q$, sc));
  perform pg_temp.rec('EI8-adjust-reason-min5', 'control', pg_temp.ok(e = 'einvoice_adjust_reason_required'), 'lý do < 5 ký tự: ' || e);
  e := pg_temp.try(format($q$select public.record_sale_einvoice(%L, '{"kind":"adjust","number":"0000923","adjust_amount":-50000}'::jsonb)$q$, sc));
  perform pg_temp.rec('EI8-adjust-reason-required', 'control', pg_temp.ok(e = 'einvoice_adjust_reason_required'), 'thiếu lý do: ' || e);
  a1 := public.record_sale_einvoice(sc, jsonb_build_object('kind', 'adjust', 'symbol', 'C26TBB', 'number', '0000924', 'adjust_amount', -50000, 'adjust_reason', 'Giảm giá sau bán', 'replaces_id', oc->>'id'));
  perform pg_temp.rec('EI8-adjust-ok', 'control', pg_temp.ok((a1->>'kind') = 'adjust' and (a1->>'adjust_amount')::numeric = -50000 and (a1->>'replaces_id') = (oc->>'id')
        and (select status from public.einvoices where id = (oc->>'id')::uuid) = 'issued'), 'điều chỉnh: gốc vẫn issued, lưu số tiền/lý do/replaces_id');
  perform pg_temp.rec('EI8-adjust-no-journal', 'control', pg_temp.ok((select count(*) from public.journal_entries) = n_je), 'điều chỉnh chỉ tham chiếu, không sinh bút toán');
  perform pg_temp.rec('EI8-adjust-audit', 'control', pg_temp.ok(exists (select 1 from public.accounting_audit where action = 'record_sale_einvoice_adjust' and detail->>'einvoice_id' = a1->>'id' and (detail->>'adjust_amount')::numeric = -50000)),
        'điều chỉnh ghi accounting_audit');
  e := pg_temp.try(format($q$select public.record_sale_einvoice(%L, jsonb_build_object('kind','replace','number','0000925','replaces_id',%L))$q$, sc, a1->>'id'));
  perform pg_temp.rec('EI8-no-replace-adjust', 'control', pg_temp.ok(e = 'einvoice_original_invalid'), 'không thay thế HĐ điều chỉnh: ' || e);
  e := pg_temp.try(format($q$select public.record_sale_einvoice(%L, '{"number":"0000926","cqt_code":"bad code!"}'::jsonb)$q$, sb));
  perform pg_temp.rec('EI8-cqt-format', 'control', pg_temp.ok(e = 'einvoice_cqt_code_invalid'), e);
  e := pg_temp.try(format($q$select public.record_sale_einvoice(%L, '{"number":"0000926","pdf_url":"javascript:alert(1)"}'::jsonb)$q$, sb));
  perform pg_temp.rec('EI8-pdf-url-safe', 'control', pg_temp.ok(e = 'einvoice_pdf_url_invalid'), e);
  -- danh sách thiếu HĐ: sa, sc, sd có HĐ hiệu lực; sb có bản thay thế lần 2 hiệu lực; HĐ điều chỉnh không tính
  perform pg_temp.rec('EI8-missing-view', 'control', pg_temp.ok((select count(*) from public.v_sales_missing_einvoice) = m0 - 4), 'v_sales_missing_einvoice giảm đúng 4 (adjust không tính)');

  -- ------------------------------------------------------------ quyền (theo quy tắc HĐĐT hiện có: chủ + nhân viên)
  reset role;
  perform pg_temp.act_as('authenticated', u2);
  e := pg_temp.try(format($q$select public.record_sale_einvoice(%L, '{"kind":"adjust","number":"0000930","adjust_amount":10000,"adjust_reason":"Tăng giá bổ sung"}'::jsonb)$q$, sc));
  perform pg_temp.rec('EI8-staff-adjust', 'control', pg_temp.ok(e = 'OK'), 'nhân viên ghi được HĐ điều chỉnh (như ghi/thay thế HĐ): ' || e);
  e := pg_temp.try(format($q$select public.record_sale_einvoice(%L, '{"kind":"replace","number":"0000931"}'::jsonb)$q$, sd));
  perform pg_temp.rec('EI8-staff-replace', 'control', pg_temp.ok(e = 'OK'), 'nhân viên thay thế HĐ: ' || e);
  reset role;
  perform pg_temp.act_as('authenticated', nobody);
  e := pg_temp.try(format($q$select public.record_sale_einvoice(%L, '{"kind":"replace","number":"0000932"}'::jsonb)$q$, sd));
  n := (select count(*) from public.einvoices);
  reset role;
  perform pg_temp.rec('EI8-non-staff', 'control', pg_temp.ok(e = 'forbidden' and n = 0), 'không phải nhân viên: ' || e || '; đọc einvoices = ' || n);
  perform pg_temp.act_as('anon');
  e := pg_temp.try(format($q$select public.record_sale_einvoice(%L, '{"kind":"replace","number":"0000933"}'::jsonb)$q$, sd));
  reset role;
  perform pg_temp.rec('EI8-anon', 'control', pg_temp.ok(e like 'permission denied%'), 'anon: ' || e);
  perform pg_temp.rec('EI8-grants', 'control', pg_temp.ok(not has_function_privilege('anon', 'public.record_sale_einvoice(uuid, jsonb)', 'execute')
        and has_function_privilege('authenticated', 'public.record_sale_einvoice(uuid, jsonb)', 'execute')
        and (select count(*) from pg_proc where proname = 'record_sale_einvoice' and pronamespace = 'public'::regnamespace) = 1
        and exists (select 1 from pg_proc where proname = 'record_sale_einvoice' and pronamespace = 'public'::regnamespace and prosecdef and exists (select 1 from unnest(proconfig) cfg(v) where cfg.v like 'search_path=%'))),
        'chỉ 1 overload; anon không execute; security definer + search_path');
  perform pg_temp.rec('EI8-columns', 'control', pg_temp.ok((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'einvoices' and column_name in ('replaces_id', 'cqt_code', 'pdf_url', 'adjust_amount', 'adjust_reason')) = 5),
        'migration 0019 đã áp dụng (5 cột mới)');
end $$;
select current_setting('harness.out');
rollback;
