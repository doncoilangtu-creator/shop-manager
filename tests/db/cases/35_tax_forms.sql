-- 0017 (A6): 01/TKN-CNKD (chỉ tiêu doanh thu theo nhóm ngành × kênh) và 01/BK-STK (số tài khoản đầy đủ chỉ chủ hộ đọc, trạng thái khai) (rolled back)
\ir ../_lib.sql
begin;
create or replace function pg_temp.tkn(y int, h int, k text) returns numeric language sql as $f$
  select revenue from public.tkn_cnkd_data(y, h) where code = k $f$;
do $$
declare
  u uuid := pg_temp.mk_staff('owner'); u2 uuid := pg_temp.mk_staff('staff');
  s uuid := pg_temp.mk_supplier(); p uuid := pg_temp.mk_product(0, 0);
  hq uuid; l2 uuid; sa jsonb; sb jsonb; sc jsonb; sd jsonb; line uuid; e text; n int; x numeric; bank uuid; momo uuid; vcb uuid; cash uuid; r record; j jsonb;
begin
  perform pg_temp.act_as('authenticated', u);
  perform public.set_business_profile(jsonb_build_object('business_name', 'HKD Máy tính TK', 'owner_name', 'Bùi Sĩ Hoàng', 'tax_code', '0123456789', 'main_tax_group', 'goods'));
  perform public.upsert_business_location(jsonb_build_object('name', 'Trụ sở', 'address', '1 Lê Lợi', 'is_hq', true, 'tax_location_code', '00001'));
  perform public.upsert_business_location(jsonb_build_object('name', 'Chi nhánh 2', 'address', '2 Trần Phú'));
  reset role;
  select id into hq from public.business_locations where name = 'Trụ sở';
  select id into l2 from public.business_locations where name = 'Chi nhánh 2';

  -- ------------------------------------------------------------ 01/TKN-CNKD
  perform pg_temp.act_as('authenticated', u);
  perform public.post_purchase_bill(s, '2026-02-02', null, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 20, 'unit_cost', 100000, 'vat_rate', 0)), 'NCC-TK');
  -- cửa hàng: hàng 2tr + dịch vụ 500k (tháng 3)
  sa := public.post_sale_hkd(null, '2026-03-10', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 2, 'unit_price', 1000000), jsonb_build_object('description', 'Công cài đặt', 'qty', 1, 'unit_price', 500000, 'tax_group', 'service')),
                             jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 2500000)));
  -- sàn TMĐT: hàng 1,2tr (tháng 4), trả 1 phần 200k (tháng 8)
  sb := public.post_sale_hkd(null, '2026-04-15', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1, 'unit_price', 1200000)), jsonb_build_array(jsonb_build_object('method', 'bank', 'amount', 1200000)), 'marketplace');
  select id into line from public.sales_invoice_lines where invoice_id = (sb->>'invoice_id')::uuid;
  perform public.post_sale_return((sb->>'invoice_id')::uuid, '2026-08-06', jsonb_build_array(jsonb_build_object('sale_line_id', line, 'qty', 0, 'amount', 200000)), null, 'giảm giá');
  -- online: sản xuất/dịch vụ gắn hàng hóa 300k (tháng 9), "khác" 100k tại chi nhánh 2 (tháng 9)
  sc := public.post_sale_hkd(null, '2026-09-01', jsonb_build_array(jsonb_build_object('description', 'Lắp ráp PC', 'qty', 1, 'unit_price', 300000, 'tax_group', 'production_service')), jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 300000)), 'online');
  sd := public.post_sale_hkd(null, '2026-09-02', jsonb_build_array(jsonb_build_object('description', 'Cho mượn máy', 'qty', 1, 'unit_price', 100000, 'tax_group', 'other')), jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 100000)), 'store', l2);
  -- bán 30/06, hủy 02/07 -> +H1, −H2, cả năm = 0
  sa := public.post_sale_hkd(null, '2026-06-30', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1, 'unit_price', 700000)), jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 700000)));
  perform public.reverse_sales_invoice((sa->>'invoice_id')::uuid, '2026-07-02', 'khách đổi ý');
  reset role;

  perform pg_temp.act_as('authenticated', u2);
  perform pg_temp.rec('TKN-08a', 'control', pg_temp.ok(pg_temp.tkn(2026, null, '08a') = 2000000), '[08a] hàng hóa tại địa điểm cố định = ' || pg_temp.tkn(2026, null, '08a'));
  perform pg_temp.rec('TKN-08b', 'control', pg_temp.ok(pg_temp.tkn(2026, null, '08b') = 500000), '[08b] dịch vụ = ' || pg_temp.tkn(2026, null, '08b'));
  perform pg_temp.rec('TKN-08g', 'control', pg_temp.ok(pg_temp.tkn(2026, null, '08g') = 100000), '[08g] khác (gộp mọi địa điểm) = ' || pg_temp.tkn(2026, null, '08g'));
  perform pg_temp.rec('TKN-08-sum', 'control', pg_temp.ok(pg_temp.tkn(2026, null, '08') = 2600000), '[08] = 08a+08b+08g = ' || pg_temp.tkn(2026, null, '08'));
  perform pg_temp.rec('TKN-09a-net-return', 'control', pg_temp.ok(pg_temp.tkn(2026, null, '09a') = 1000000), '[09a] sàn TMĐT trừ giảm giá = ' || pg_temp.tkn(2026, null, '09a'));
  perform pg_temp.rec('TKN-09d-online', 'control', pg_temp.ok(pg_temp.tkn(2026, null, '09d') = 300000 and pg_temp.tkn(2026, null, '09') = 1300000), 'online -> [09d]; [09] = ' || pg_temp.tkn(2026, null, '09'));
  perform pg_temp.rec('TKN-unused-zero', 'control', pg_temp.ok(pg_temp.tkn(2026, null, '08c') = 0 and pg_temp.tkn(2026, null, '08e') = 0 and pg_temp.tkn(2026, null, '10') = 0 and (select count(*) from public.tkn_cnkd_data(2026)) = 16), '16 chỉ tiêu, chỉ tiêu không dùng = 0');
  x := (select coalesce(sum(amount), 0) from public.book_s1a('2026-01-01', '2026-12-31'));
  perform pg_temp.rec('TKN-11-equals-S1a', 'control', pg_temp.ok(pg_temp.tkn(2026, null, '11') = 3900000 and pg_temp.tkn(2026, null, '11') = x), '[11] tổng cộng = tổng sổ S1a cả năm = ' || x);
  perform pg_temp.rec('TKN-half', 'control', pg_temp.ok(pg_temp.tkn(2026, 1, '11') = 4400000 and pg_temp.tkn(2026, 2, '11') = -500000 and pg_temp.tkn(2026, 1, '08a') = 2700000),
                      '6 tháng đầu = ' || pg_temp.tkn(2026, 1, '11') || ' (gồm đơn hủy tháng 7); 6 tháng cuối = ' || pg_temp.tkn(2026, 2, '11'));
  e := pg_temp.try($q$select * from public.tkn_cnkd_data(2026, 3)$q$);
  perform pg_temp.rec('TKN-half-invalid', 'control', pg_temp.ok(e like 'period_invalid%'), e);
  reset role;
  perform pg_temp.act_as('anon');
  e := pg_temp.try($q$select * from public.tkn_cnkd_data(2026)$q$);
  reset role;
  perform pg_temp.rec('TKN-anon', 'control', pg_temp.ok(e like 'permission denied%'), 'anon: ' || e);

  -- ------------------------------------------------------------ số tài khoản đầy đủ
  perform pg_temp.act_as('authenticated', u);
  bank := (public.upsert_money_account(null, '{"kind":"bank","label":"MB chính","provider":"MB Bank","account_no":"0123 4567 89","holder":"Bùi Sĩ Hoàng"}'::jsonb)->>'id')::uuid;
  momo := (public.upsert_money_account(null, jsonb_build_object('kind', 'ewallet', 'label', 'Ví MoMo', 'provider', 'MoMo', 'account_no', '0909123456', 'location_id', l2))->>'id')::uuid;
  vcb := (public.upsert_money_account(null, '{"kind":"bank","label":"VCB cũ","provider":"Vietcombank","account_no":"9990001234","tax_notified":true,"tax_notified_at":"2026-01-10"}'::jsonb)->>'id')::uuid;
  e := pg_temp.try($q$select public.upsert_money_account(null, '{"kind":"cash","label":"Quỹ 2","account_no":"123456"}'::jsonb)$q$);
  perform pg_temp.rec('BK-cash-no-number', 'control', pg_temp.ok(e like 'money_account_invalid%'), 'tiền mặt không nhận số tài khoản: ' || e);
  perform pg_temp.rec('BK-owner-sees-full', 'control', pg_temp.ok((select account_no from public.money_account_numbers where account_id = bank) = '0123456789'), 'chủ hộ đọc được số đầy đủ (đã bỏ khoảng trắng)');
  reset role;
  perform pg_temp.rec('BK-masked-kept', 'control', pg_temp.ok((select account_no_masked from public.money_accounts where id = bank) = '****6789'), 'money_accounts vẫn chỉ giữ bản che');
  perform pg_temp.rec('BK-audit-no-full-number', 'control', pg_temp.ok(not exists (select 1 from public.accounting_audit where action = 'upsert_money_account' and detail::text like '%0123456789%')), 'nhật ký không chứa số tài khoản đầy đủ');
  perform pg_temp.act_as('authenticated', u2);
  n := (select count(*) from public.money_account_numbers);
  perform pg_temp.rec('BK-staff-no-full', 'control', pg_temp.ok(n = 0 and (select account_no_masked from public.money_accounts where id = bank) = '****6789'), 'nhân viên: 0 dòng số đầy đủ, thấy bản che');
  e := pg_temp.try($q$select * from public.bk_stk_data()$q$);
  perform pg_temp.rec('BK-staff-no-data', 'control', pg_temp.ok(e = 'forbidden'), 'nhân viên gọi bk_stk_data: ' || e);
  e := pg_temp.try(format($q$insert into public.money_account_numbers(account_id, account_no) values (%L, '11112222')$q$, bank));
  perform pg_temp.rec('BK-no-direct-write', 'control', pg_temp.ok(e like 'permission denied%'), e);
  reset role;
  perform pg_temp.act_as('anon');
  e := pg_temp.try($q$select count(*) from public.money_account_numbers$q$);
  reset role;
  perform pg_temp.rec('BK-anon', 'control', pg_temp.ok(e like 'permission denied%'), e);

  -- ------------------------------------------------------------ bảng kê 01/BK-STK
  perform pg_temp.act_as('authenticated', u);
  perform pg_temp.rec('BK-pending-first', 'control', pg_temp.ok((select count(*) from public.bk_stk_data() where status = 'first') = 2 and not exists (select 1 from public.bk_stk_data() where account_id = vcb)),
                      'chưa thông báo -> khai lần đầu (2); VCB đã thông báo không có trong danh sách cần khai');
  select * into r from public.bk_stk_data('all') where account_id = bank;
  perform pg_temp.rec('BK-row-fields', 'control', pg_temp.ok(r.account_no = '0123456789' and r.location_id = hq and r.location_code = '00001' and r.holder = 'Bùi Sĩ Hoàng' and r.provider = 'MB Bank' and cardinality(r.missing) = 0),
                      'dòng kê có số đầy đủ, địa điểm (mặc định trụ sở) + mã địa điểm, chủ TK, ngân hàng');
  perform pg_temp.rec('BK-location-explicit', 'control', pg_temp.ok((select location_id from public.bk_stk_data() where account_id = momo) = l2), 'ví gắn chi nhánh 2');
  perform pg_temp.rec('BK-unchanged', 'control', pg_temp.ok((select status from public.bk_stk_data('all') where account_id = vcb) = 'unchanged'), 'đã thông báo, chưa đổi -> unchanged');
  -- đổi số tài khoản sau khi đã thông báo -> "thay đổi thông tin"
  perform public.upsert_money_account(vcb, '{"account_no":"9990005678"}'::jsonb);
  perform pg_temp.rec('BK-changed', 'control', pg_temp.ok((select status from public.bk_stk_data() where account_id = vcb) = 'changed'), 'đổi số tài khoản sau khi thông báo -> thay đổi thông tin');
  perform public.upsert_money_account(bank, '{"label":"MB chính (đổi tên)"}'::jsonb);
  perform pg_temp.rec('BK-label-not-change', 'control', pg_temp.ok((select status from public.bk_stk_data() where account_id = bank) = 'first'), 'đổi tên hiển thị không phải thay đổi thông tin khai thuế');
  -- nộp bảng kê
  n := public.mark_bk_stk_filed(array[bank, momo, vcb], '2026-10-01');
  perform pg_temp.rec('BK-filed', 'control', pg_temp.ok(n = 3 and not exists (select 1 from public.bk_stk_data())
        and (select bool_and(tax_notified and tax_notified_at = '2026-10-01' and info_changed_at is null) from public.money_accounts where id in (bank, momo, vcb))), 'sau khi nộp: không còn dòng cần khai');
  -- ngừng dùng -> "đóng"
  perform public.upsert_money_account(momo, '{"active":false}'::jsonb);
  perform pg_temp.rec('BK-closed', 'control', pg_temp.ok((select status from public.bk_stk_data() where account_id = momo) = 'closed'), 'ngừng tài khoản đã thông báo -> khai đóng');
  perform public.mark_bk_stk_filed(array[momo], '2026-10-02');
  perform pg_temp.rec('BK-closed-reported', 'control', pg_temp.ok((select status from public.bk_stk_data('all') where account_id = momo) = 'closed_reported' and not exists (select 1 from public.bk_stk_data())), 'đã khai đóng');
  perform public.upsert_money_account(momo, '{"active":true}'::jsonb);
  perform pg_temp.rec('BK-reopen-first', 'control', pg_temp.ok((select status from public.bk_stk_data() where account_id = momo) = 'first'), 'mở lại tài khoản đã khai đóng -> khai lần đầu');
  -- xóa số tài khoản
  perform public.upsert_money_account(vcb, '{"account_no":""}'::jsonb);
  perform pg_temp.rec('BK-number-cleared', 'control', pg_temp.ok(not exists (select 1 from public.money_account_numbers where account_id = vcb) and (select 'account_no' = any(missing) from public.bk_stk_data('all') where account_id = vcb)),
                      'xóa số -> thiếu số tài khoản được báo trong missing');
  e := pg_temp.try($q$select public.mark_bk_stk_filed(array[]::uuid[], '2026-10-01')$q$);
  perform pg_temp.rec('BK-mark-empty', 'control', pg_temp.ok(e = 'bk_stk_empty'), e);
  select id into cash from public.money_accounts where kind = 'cash' limit 1;
  e := pg_temp.try(format($q$select public.mark_bk_stk_filed(array[%L]::uuid[], '2026-10-01')$q$, cash));
  perform pg_temp.rec('BK-mark-cash-invalid', 'control', pg_temp.ok(e like 'bk_stk_invalid%'), 'tiền mặt không có trong bảng kê: ' || e);
  reset role;
  perform pg_temp.act_as('authenticated', u2);
  e := pg_temp.try(format($q$select public.mark_bk_stk_filed(array[%L]::uuid[], '2026-10-01')$q$, bank));
  reset role;
  perform pg_temp.rec('BK-mark-staff', 'control', pg_temp.ok(e = 'forbidden'), e);
  perform pg_temp.rec('A6-fn-search-path', 'control', pg_temp.ok(not exists (select 1 from pg_proc where proname in ('tkn_cnkd_data', 'bk_stk_data', 'mark_bk_stk_filed', '_bk_stk_status', 'upsert_money_account') and pronamespace = 'public'::regnamespace and (proconfig is null or not exists (select 1 from unnest(proconfig) cfg(v) where cfg.v like 'search_path=%')))), 'mọi hàm mới có search_path');
  perform pg_temp.rec('A6-anon-no-exec', 'control', pg_temp.ok(not has_function_privilege('anon', 'public.bk_stk_data(text)', 'execute') and not has_function_privilege('anon', 'public.mark_bk_stk_filed(uuid[], date)', 'execute')
        and not has_function_privilege('authenticated', 'public._bk_stk_status(public.money_accounts)', 'execute')), 'anon không gọi được; helper nội bộ không cấp cho authenticated');
end $$;
select current_setting('harness.out');
rollback;
