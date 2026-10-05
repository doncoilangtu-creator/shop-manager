-- 0012 (A1): hồ sơ HKD, địa điểm, nhóm ngành thuế, ngưỡng doanh thu 1 tỷ (rolled back)
\ir ../_lib.sql
begin;
do $$
declare
  owner_u uuid := pg_temp.mk_staff('owner'); staff_u uuid := pg_temp.mk_staff('staff'); nobody uuid;
  c uuid := pg_temp.mk_customer(); p uuid := pg_temp.mk_product(0, 0);
  e text; j jsonb; n int; r numeric; s jsonb; loc1 jsonb; loc2 jsonb; rec record;
begin
  insert into auth.users(id, email) values (gen_random_uuid(), 'nobody@test.local') returning id into nobody;

  -- ---------------------------------------------------------------- seed config
  perform pg_temp.rec('HKD-seed-threshold', 'control', pg_temp.ok(public.legal_threshold('exempt_revenue', date '2026-06-30') = 1000000000 and public.legal_threshold('exempt_revenue', date '2025-12-31') is null),
    '1 tỷ từ 2026-01-01 (ND141/2026), chưa cấu hình trước đó');
  perform pg_temp.rec('HKD-seed-tax-rates', 'control', pg_temp.ok((select count(*) from public.tax_rates where effective_from = date '2026-01-01' and ((tax_group = 'goods' and vat_pct = 1 and pit_pct = 0.5) or (tax_group = 'service' and vat_pct = 5 and pit_pct = 2) or (tax_group = 'production_service' and vat_pct = 3 and pit_pct = 1.5) or (tax_group = 'other' and vat_pct = 2 and pit_pct = 1))) = 4),
    '4 nhóm ngành: goods 1/0.5, service 5/2, production_service 3/1.5, other 2/1');

  -- ---------------------------------------------------------------- profile: owner edits, staff reads (no CCCD), others denied
  perform pg_temp.act_as('authenticated', owner_u);
  j := public.set_business_profile(jsonb_build_object('business_name', '  HKD Máy tính ABC ', 'owner_name', 'Bùi Sĩ Hoàng', 'tax_code', '001234567890', 'citizen_id', '001234567890',
          'residence_address', '1 Lê Lợi, Q1', 'phone', '0900000001', 'email', 'abc@shop.vn', 'industries', 'Bán lẻ máy vi tính, linh kiện', 'main_tax_group', 'goods',
          'tax_method', 'exempt_notice', 'start_date', '2024-03-01', 'ledger_signer', 'Bùi Sĩ Hoàng'));
  perform pg_temp.rec('HKD-profile-save', 'control', pg_temp.ok((j->>'exists')::boolean and (j->'profile'->>'business_name') = 'HKD Máy tính ABC' and (j->'profile'->>'citizen_id') = '001234567890' and (j->>'is_owner')::boolean),
    'owner lưu hồ sơ (tên được trim), nhận lại CCCD: ' || (j->'profile'->>'business_name'));
  j := public.set_business_profile(jsonb_build_object('business_name', 'HKD ABC (đổi tên)', 'tax_code', '0123456789-001'));
  select count(*) into n from public.business_profile;
  reset role;
  perform pg_temp.rec('HKD-profile-single-row', 'control', pg_temp.ok(n = 1 and (select business_name from public.business_profile) = 'HKD ABC (đổi tên)' and (select citizen_id from public.business_profile) is null), 'lưu lần 2 ghi đè dòng duy nhất (không tạo dòng mới); trường bỏ trống thành null');
  perform pg_temp.rec('HKD-profile-audit', 'control', pg_temp.ok((select count(*) from public.accounting_audit where action = 'set_business_profile') = 2 and not exists (select 1 from public.accounting_audit where action = 'set_business_profile' and detail::text like '%001234567890%')),
    '2 dòng nhật ký, không chứa số CCCD');

  perform pg_temp.act_as('authenticated', owner_u);
  perform public.set_business_profile(jsonb_build_object('business_name', 'HKD ABC', 'citizen_id', '001234567890', 'main_tax_group', 'goods'));
  perform pg_temp.act_as('authenticated', staff_u);
  j := public.get_business_profile();
  perform pg_temp.rec('HKD-profile-staff-read-no-cccd', 'control', pg_temp.ok((j->>'exists')::boolean and not (j->>'is_owner')::boolean and not (j->'profile' ? 'citizen_id') and (j->'profile'->>'business_name') = 'HKD ABC'),
    'staff đọc được tên/MST nhưng không thấy citizen_id');
  select count(*) into n from public.business_profile;
  perform pg_temp.rec('HKD-profile-staff-no-direct-select', 'control', pg_temp.ok(n = 0), format('staff select trực tiếp bảng business_profile thấy %s dòng (RLS owner-only)', n));
  e := pg_temp.try($q$select public.set_business_profile(jsonb_build_object('business_name', 'Hack'))$q$);
  perform pg_temp.rec('HKD-profile-staff-cannot-edit', 'control', pg_temp.ok(e = 'forbidden'), 'staff gọi set_business_profile: ' || e);
  e := pg_temp.try($q$update public.business_profile set business_name = 'Hack'$q$);
  perform pg_temp.rec('HKD-profile-no-direct-dml', 'control', pg_temp.ok(e like 'permission denied%'), 'UPDATE trực tiếp: ' || e);
  e := pg_temp.try($q$select public.set_legal_threshold('exempt_revenue', 1, date '2027-01-01', 'x')$q$);
  perform pg_temp.rec('HKD-threshold-staff-cannot-edit', 'control', pg_temp.ok(e = 'forbidden'), 'staff đổi ngưỡng: ' || e);

  perform pg_temp.act_as('authenticated', nobody);
  e := pg_temp.try('select public.get_business_profile()');
  perform pg_temp.rec('HKD-profile-non-staff-denied', 'control', pg_temp.ok(e = 'forbidden'), 'user không thuộc app_users: ' || e);
  e := pg_temp.try($q$select public.set_business_profile(jsonb_build_object('business_name', 'Hack'))$q$);
  perform pg_temp.rec('HKD-profile-non-staff-cannot-edit', 'control', pg_temp.ok(e = 'forbidden'), e);
  select count(*) into n from public.tax_rates;
  perform pg_temp.rec('HKD-config-non-staff-rls', 'control', pg_temp.ok(n = 0), format('non-staff thấy %s dòng tax_rates', n));

  perform pg_temp.act_as('anon');
  e := pg_temp.try('select public.get_business_profile()');
  perform pg_temp.rec('HKD-profile-anon-denied', 'control', pg_temp.ok(e like 'permission denied%'), e);
  e := pg_temp.try('select count(*) from public.business_profile');
  perform pg_temp.rec('HKD-profile-anon-table', 'control', pg_temp.ok(e like 'permission denied%'), e);

  perform pg_temp.act_as('service_role');
  e := pg_temp.try($q$select public.set_business_profile(jsonb_build_object('business_name', 'Bot'))$q$);
  perform pg_temp.rec('HKD-profile-service-role-cannot-edit', 'control', pg_temp.ok(e = 'forbidden'), 'service_role không sửa hồ sơ (chỉ owner): ' || e);
  j := public.get_business_profile();
  perform pg_temp.rec('HKD-profile-service-role-read', 'control', pg_temp.ok(not (j->'profile' ? 'citizen_id')), 'bot đọc được hồ sơ, không có CCCD');

  -- ---------------------------------------------------------------- validation
  perform pg_temp.act_as('authenticated', owner_u);
  e := pg_temp.try($q$select public.set_business_profile(jsonb_build_object('business_name', '   '))$q$);
  perform pg_temp.rec('HKD-profile-name-required', 'control', pg_temp.ok(e = 'business_name_required'), e);
  e := pg_temp.try($q$select public.set_business_profile(jsonb_build_object('business_name', 'A', 'tax_code', '12345'))$q$);
  perform pg_temp.rec('HKD-profile-tax-code-format', 'control', pg_temp.ok(e = 'tax_code_invalid'), e);
  e := pg_temp.try($q$select public.set_business_profile(jsonb_build_object('business_name', 'A', 'citizen_id', '12ab'))$q$);
  perform pg_temp.rec('HKD-profile-citizen-id-format', 'control', pg_temp.ok(e = 'citizen_id_invalid'), e);
  e := pg_temp.try($q$select public.set_business_profile(jsonb_build_object('business_name', 'A', 'email', 'not-an-email'))$q$);
  perform pg_temp.rec('HKD-profile-email-format', 'control', pg_temp.ok(e = 'email_invalid'), e);
  e := pg_temp.try($q$select public.set_business_profile(jsonb_build_object('business_name', 'A', 'tax_method', 'khoan'))$q$);
  perform pg_temp.rec('HKD-profile-tax-method-enum', 'control', pg_temp.ok(e = 'tax_method_invalid'), e);
  e := pg_temp.try($q$select public.set_business_profile(jsonb_build_object('business_name', 'A', 'main_tax_group', 'nope'))$q$);
  perform pg_temp.rec('HKD-profile-tax-group-fk', 'control', pg_temp.ok(e = 'tax_group_unknown'), e);
  e := pg_temp.try($q$select public.set_business_profile(jsonb_build_object('business_name', 'A', 'start_date', '31/02/2024'))$q$);
  perform pg_temp.rec('HKD-profile-start-date', 'control', pg_temp.ok(e = 'start_date_invalid'), e);
  e := pg_temp.try($q$select public.set_business_profile('[]'::jsonb)$q$);
  perform pg_temp.rec('HKD-profile-not-object', 'control', pg_temp.ok(e = 'profile_invalid'), e);

  -- ---------------------------------------------------------------- locations
  loc1 := public.upsert_business_location(jsonb_build_object('name', 'Cửa hàng chính', 'address', '1 Lê Lợi, Q1', 'is_hq', true, 'main_tax_group', 'goods', 'opened_on', '2024-03-01'));
  loc2 := public.upsert_business_location(jsonb_build_object('name', 'Kho Q7', 'address', '9 Nguyễn Thị Thập, Q7'));
  perform pg_temp.rec('HKD-location-create', 'control', pg_temp.ok((loc1->>'is_hq')::boolean and not (loc2->>'is_hq')::boolean and loc2->>'status' = 'active'), 'tạo 2 địa điểm: trụ sở + kho');
  -- move HQ to the second one: the first is demoted in the same call
  loc2 := public.upsert_business_location(jsonb_build_object('id', loc2->>'id', 'name', 'Kho Q7', 'address', '9 Nguyễn Thị Thập, Q7', 'is_hq', true));
  reset role;
  perform pg_temp.rec('HKD-location-single-hq', 'control', pg_temp.ok((select count(*) from public.business_locations where is_hq) = 1 and (select is_hq from public.business_locations where id = (loc2->>'id')::uuid)),
    'chuyển trụ sở: trụ sở cũ tự hạ, luôn chỉ có 1 trụ sở');
  e := pg_temp.try(format($q$insert into public.business_locations(name, address, is_hq) values ('X', 'Y', true)$q$));
  perform pg_temp.rec('HKD-location-hq-unique-index', 'control', pg_temp.ok(e like '%uq_business_locations_hq%'), 'chèn trụ sở thứ 2 trực tiếp bị chặn: ' || left(e, 80));
  perform pg_temp.act_as('authenticated', owner_u);
  loc1 := public.upsert_business_location(jsonb_build_object('id', loc1->>'id', 'name', 'Cửa hàng chính', 'address', '1 Lê Lợi, Q1', 'status', 'closed', 'is_hq', true, 'opened_on', '2024-03-01', 'closed_on', '2026-09-30'));
  perform pg_temp.rec('HKD-location-close', 'control', pg_temp.ok(loc1->>'status' = 'closed' and not (loc1->>'is_hq')::boolean and (loc1->>'closed_on') = '2026-09-30'), 'đóng địa điểm: bỏ cờ trụ sở, giữ ngày đóng');
  e := pg_temp.try(format($q$select public.upsert_business_location(jsonb_build_object('name', 'Z', 'address', 'A', 'opened_on', '2026-05-01', 'closed_on', '2026-04-01', 'status', 'closed'))$q$));
  perform pg_temp.rec('HKD-location-dates', 'control', pg_temp.ok(e = 'location_dates_invalid'), e);
  e := pg_temp.try($q$select public.upsert_business_location(jsonb_build_object('name', '', 'address', 'A'))$q$);
  perform pg_temp.rec('HKD-location-name-required', 'control', pg_temp.ok(e = 'location_name_required'), e);
  perform pg_temp.act_as('authenticated', staff_u);
  e := pg_temp.try($q$select public.upsert_business_location(jsonb_build_object('name', 'Z', 'address', 'A'))$q$);
  select count(*) into n from public.business_locations;
  perform pg_temp.rec('HKD-location-staff-read-only', 'control', pg_temp.ok(e = 'forbidden' and n = 2), format('staff không sửa được (%s) nhưng đọc được %s địa điểm', e, n));

  -- ---------------------------------------------------------------- revenue vs threshold (year 2034 -> threshold from 2026 row)
  reset role;
  perform pg_temp.act_as('authenticated', owner_u);
  perform public.set_legal_threshold('revenue_warn_pct', 80, date '2026-01-01', 'cấu hình ứng dụng');
  s := public.threshold_status(2034);
  perform pg_temp.rec('HKD-threshold-ok-empty', 'control', pg_temp.ok(s->>'level' = 'ok' and (s->>'revenue')::numeric = 0 and (s->>'threshold')::numeric = 1000000000 and (s->>'remaining')::numeric = 1000000000), 'chưa có doanh thu: ' || s::text);

  -- product with large stock via opening, sell 700M (70 %), then to 85 % -> warning, then 100 % -> exceeded
  reset role;
  update public.products set stock_qty = 0 where id = p;
  insert into public.stock_movements(product_id, type, qty, unit_cost, value_delta, ref_type, notes) values (p, 'in', 10, 1, 10, 'opening', 'fixture');
  perform pg_temp.act_as('authenticated', owner_u);
  perform public.post_sales_invoice(c, date '2034-02-10', null, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1, 'unit_price', 700000000, 'vat_rate', 0)), null, null, true);
  s := public.threshold_status(2034);
  perform pg_temp.rec('HKD-threshold-70pct', 'control', pg_temp.ok(s->>'level' = 'ok' and (s->>'pct')::numeric = 70 and (s->>'revenue')::numeric = 700000000), s::text);
  perform public.post_sales_invoice(c, date '2034-03-05', null, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1, 'unit_price', 100000000, 'vat_rate', 0)), null, null, true);
  s := public.threshold_status(2034);
  perform pg_temp.rec('HKD-threshold-80pct-warning', 'control', pg_temp.ok(s->>'level' = 'warning' and (s->>'pct')::numeric = 80), 'đúng 80 % => warning: ' || s::text);
  perform public.post_sales_invoice(c, date '2034-04-05', null, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1, 'unit_price', 199999999, 'vat_rate', 0)), null, null, true);
  s := public.threshold_status(2034);
  perform pg_temp.rec('HKD-threshold-just-below', 'control', pg_temp.ok(s->>'level' = 'warning' and (s->>'revenue')::numeric = 999999999), '999.999.999 đ vẫn là warning, chưa exceeded: ' || s::text);
  perform public.post_sales_invoice(c, date '2034-05-05', null, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1, 'unit_price', 1, 'vat_rate', 0)), null, null, true);
  s := public.threshold_status(2034);
  perform pg_temp.rec('HKD-threshold-100pct-exceeded', 'control', pg_temp.ok(s->>'level' = 'exceeded' and (s->>'pct')::numeric = 100 and (s->>'remaining')::numeric = 0), 'đạt 1 tỷ => exceeded: ' || s::text);

  -- other years are independent; by-month report adds up and is cumulative
  perform pg_temp.rec('HKD-revenue-year-isolation', 'control', pg_temp.ok(public.revenue_ytd(2033) = 0 and public.revenue_ytd(2035) = 0 and public.revenue_ytd(2034) = 1000000000), 'revenue_ytd tách theo năm');
  select * into rec from public.revenue_by_month(2034) where month = date '2034-03-01';
  perform pg_temp.rec('HKD-revenue-by-month', 'control', pg_temp.ok(rec.revenue = 100000000 and rec.cumulative = 800000000 and (select count(*) from public.revenue_by_month(2034)) = 12 and (select max(cumulative) from public.revenue_by_month(2034)) = 1000000000),
    format('tháng 3: %s, lũy kế %s; 12 dòng', rec.revenue, rec.cumulative));

  -- voided invoice no longer counts
  reset role;
  perform pg_temp.act_as('authenticated', owner_u);
  perform public.reverse_sales_invoice((select id from public.sales_invoices where invoice_date = date '2034-05-05' and customer_id = c), date '2034-05-06', 'test');
  s := public.threshold_status(2034);
  perform pg_temp.rec('HKD-revenue-void-excluded', 'control', pg_temp.ok(s->>'level' = 'warning' and (s->>'revenue')::numeric = 999999999), 'hóa đơn hủy không tính vào doanh thu: ' || s::text);

  -- VAT-inclusive total counts (legacy invoices with VAT): taxable revenue = tổng tiền ghi trên hóa đơn
  perform public.post_sales_invoice(c, date '2035-01-10', null, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1, 'unit_price', 1000000, 'vat_rate', 10)), null, null, true);
  perform pg_temp.rec('HKD-revenue-uses-gross-total', 'control', pg_temp.ok(public.revenue_ytd(2035) = 1100000), 'doanh thu = tổng tiền hóa đơn gồm VAT 10 %: ' || public.revenue_ytd(2035));

  -- changing the threshold = one row, no code change
  perform public.set_legal_threshold('exempt_revenue', 2000000000, date '2034-01-01', 'test: ngưỡng mới');
  s := public.threshold_status(2034);
  perform pg_temp.rec('HKD-threshold-configurable', 'control', pg_temp.ok((s->>'threshold')::numeric = 2000000000 and s->>'level' = 'ok' and (s->>'pct')::numeric = 49.99 and s->>'source' = 'test: ngưỡng mới'),
    'ngưỡng mới hiệu lực 2034 => 49,99 % (cắt, không làm tròn): ' || s::text);
  e := pg_temp.try($q$select public.set_legal_threshold('Bad Key', 1, date '2034-01-01', 'x')$q$);
  perform pg_temp.rec('HKD-threshold-key-validated', 'control', pg_temp.ok(e = 'threshold_key_invalid'), e);
  e := pg_temp.try($q$select public.set_legal_threshold('exempt_revenue', 1, date '2034-01-01', ' ')$q$);
  perform pg_temp.rec('HKD-threshold-source-required', 'control', pg_temp.ok(e = 'source_required'), e);
  -- year without any configured threshold
  s := public.threshold_status(2020);
  perform pg_temp.rec('HKD-threshold-none-before-2026', 'control', pg_temp.ok(s->>'level' = 'none' and s->'threshold' = 'null'::jsonb), s::text);

  -- non-staff cannot read revenue; anon denied
  perform pg_temp.act_as('authenticated', nobody);
  e := pg_temp.try('select public.threshold_status(2034)');
  perform pg_temp.rec('HKD-threshold-non-staff', 'control', pg_temp.ok(e = 'forbidden'), e);
  perform pg_temp.act_as('anon');
  e := pg_temp.try('select public.revenue_ytd(2034)');
  reset role;
  perform pg_temp.rec('HKD-revenue-anon', 'control', pg_temp.ok(e like 'permission denied%'), e);

  -- hygiene: new SECURITY DEFINER functions pin search_path; helper not callable
  select count(*) into n from pg_proc p join pg_namespace s2 on s2.oid = p.pronamespace
   where s2.nspname = 'public' and p.proname in ('set_business_profile','upsert_business_location','set_legal_threshold','get_business_profile','revenue_ytd','revenue_by_month','threshold_status','legal_threshold','_clean_text')
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%');
  perform pg_temp.rec('HKD-fns-search-path', 'control', pg_temp.ok(n = 0), format('%s hàm 0012 thiếu search_path', n));
  perform pg_temp.rec('HKD-helper-not-exposed', 'control', pg_temp.ok(not has_function_privilege('authenticated', 'public._clean_text(text)', 'execute') and not has_function_privilege('anon', 'public.set_business_profile(jsonb)', 'execute')),
    '_clean_text không gọi được qua RPC; anon không có quyền set_business_profile');
  perform pg_temp.rec('HKD-rls-enabled', 'control', pg_temp.ok((select count(*) from pg_class c join pg_namespace s3 on s3.oid = c.relnamespace where s3.nspname = 'public' and c.relname in ('business_profile','business_locations','tax_groups','tax_rates','legal_thresholds') and c.relrowsecurity) = 5),
    '5 bảng mới đều bật RLS');
  perform pg_temp.rec('HKD-no-auth-uid-bare', 'control', pg_temp.ok((select count(*) from pg_policies where schemaname = 'public' and tablename in ('business_profile','business_locations','tax_groups','tax_rates','legal_thresholds') and qual ~* 'auth\.uid\(\)' and qual !~* 'select auth\.uid\(\)') = 0),
    'policy mới không gọi auth.uid() trần');
end $$;
select current_setting('harness.out', true);
rollback;
