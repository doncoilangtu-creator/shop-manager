-- 0016 (A5): sổ S1a-HKD sinh từ chứng từ — địa điểm, nhóm ngành, trả hàng, hủy cùng tháng / tháng sau, tổng hợp theo ngày, khớp sổ cái, nhật ký xuất (rolled back)
\ir ../_lib.sql
begin;
create or replace function pg_temp.s1a_sum(f date, t date, loc uuid default null) returns numeric language sql as $f$
  select coalesce(sum(amount), 0) from public.book_s1a(f, t, loc) $f$;
do $$
declare
  u uuid := pg_temp.mk_staff('owner'); u2 uuid := pg_temp.mk_staff('staff');
  c uuid := pg_temp.mk_customer(); s uuid := pg_temp.mk_supplier(); p uuid := pg_temp.mk_product(0, 0);
  hq uuid; l2 uuid; sa jsonb; sb jsonb; sc jsonb; sd jsonb; se jsonb; line uuid; rt jsonb; rt2 jsonb; e text; n int; x numeric; chk record; ex uuid;
begin
  perform pg_temp.act_as('authenticated', u);
  perform public.set_business_profile(jsonb_build_object('business_name', 'HKD Máy tính S1a', 'owner_name', 'Bùi Sĩ Hoàng', 'tax_code', '0123456789', 'main_tax_group', 'goods'));
  perform public.upsert_business_location(jsonb_build_object('name', 'Trụ sở', 'address', '1 Lê Lợi', 'is_hq', true));
  perform public.upsert_business_location(jsonb_build_object('name', 'Chi nhánh 2', 'address', '2 Trần Phú'));
  reset role;
  select id into hq from public.business_locations where name = 'Trụ sở';
  select id into l2 from public.business_locations where name = 'Chi nhánh 2';

  perform pg_temp.act_as('authenticated', u);
  perform public.post_purchase_bill(s, '2026-05-02', null, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 20, 'unit_cost', 100000, 'vat_rate', 0)), 'NCC-S1A');
  -- A: khách lẻ, trụ sở (mặc định), hàng + dịch vụ, thu đủ
  sa := public.post_sale_hkd(null, '2026-05-10', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 2, 'unit_price', 1000000), jsonb_build_object('description', 'Công cài đặt', 'qty', 1, 'unit_price', 500000, 'tax_group', 'service')),
                             jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 2500000)));
  -- B: khách có tên ở chi nhánh 2, ghi nợ
  sb := public.post_sale_hkd(c, '2026-05-15', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1, 'unit_price', 1200000)), '[]'::jsonb, 'store', l2);
  -- C: hủy cùng tháng -> không lên sổ
  sc := public.post_sale_hkd(null, '2026-05-20', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1, 'unit_price', 300000)), jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 300000)));
  perform public.reverse_sales_invoice((sc->>'invoice_id')::uuid, '2026-05-25', 'nhầm');
  -- D: bán 28/05, hủy 03/06 -> +400k tháng 5, -400k tháng 6
  sd := public.post_sale_hkd(null, '2026-05-28', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1, 'unit_price', 400000)), jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 400000)));
  perform public.reverse_sales_invoice((sd->>'invoice_id')::uuid, '2026-06-03', 'khách đổi ý');
  -- trả hàng 1 cái của B (06/06) + giảm giá 100k, có HĐĐT cho A
  select id into line from public.sales_invoice_lines where invoice_id = (sb->>'invoice_id')::uuid;
  rt := public.post_sale_return((sb->>'invoice_id')::uuid, '2026-06-06', jsonb_build_array(jsonb_build_object('sale_line_id', line, 'qty', 0, 'amount', 100000)), null, 'giảm giá');
  perform public.record_sale_einvoice((sa->>'invoice_id')::uuid, '{"symbol":"C26TAA","number":"0000777","lookup_code":"X1"}'::jsonb);
  -- E: tháng 6, khách lẻ; phiếu trả hàng tạo rồi hủy cùng tháng
  se := public.post_sale_hkd(null, '2026-06-10', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 2, 'unit_price', 250000)), jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 500000)));
  select id into line from public.sales_invoice_lines where invoice_id = (se->>'invoice_id')::uuid;
  rt2 := public.post_sale_return((se->>'invoice_id')::uuid, '2026-06-11', jsonb_build_array(jsonb_build_object('sale_line_id', line, 'qty', 1)), null, 'trả');
  perform public.reverse_sales_return((rt2->>'return_id')::uuid, '2026-06-12', 'nhập nhầm');
  reset role;

  -- ------------------------------------------------------------ tháng 5
  perform pg_temp.act_as('authenticated', u2);
  select count(*) into n from public.book_s1a('2026-05-01', '2026-05-31');
  x := pg_temp.s1a_sum('2026-05-01', '2026-05-31');
  perform pg_temp.rec('S1A-may-total', 'control', pg_temp.ok(x = 2500000 + 1200000 + 400000 and n = 4), format('tổng tháng 5 = %s, %s dòng (A hàng, A dịch vụ, B, D; C hủy cùng tháng bị bỏ)', x, n));
  perform pg_temp.rec('S1A-same-month-void-excluded', 'control', pg_temp.ok(not exists (select 1 from public.book_s1a('2026-05-01', '2026-06-30') where doc_id = (sc->>'invoice_id')::uuid)), 'đơn hủy cùng tháng không có dòng nào');
  perform pg_temp.rec('S1A-groups-split', 'control', pg_temp.ok((select count(*) from public.book_s1a('2026-05-01', '2026-05-31') where doc_id = (sa->>'invoice_id')::uuid) = 2
      and (select amount from public.book_s1a('2026-05-01', '2026-05-31') where doc_id = (sa->>'invoice_id')::uuid and tax_group = 'service') = 500000), 'đơn nhiều nhóm ngành tách dòng theo nhóm');
  perform pg_temp.rec('S1A-einvoice-in-text', 'control', pg_temp.ok(exists (select 1 from public.book_s1a('2026-05-01', '2026-05-31') where doc_id = (sa->>'invoice_id')::uuid and description like 'Bán hàng HĐ C26TAA-0000777 (đơn %' and description like '%khách lẻ%')), 'diễn giải có ký hiệu-số HĐĐT và "khách lẻ"');
  perform pg_temp.rec('S1A-location-filter', 'control', pg_temp.ok(pg_temp.s1a_sum('2026-05-01', '2026-05-31', l2) = 1200000 and pg_temp.s1a_sum('2026-05-01', '2026-05-31', hq) = 2900000), 'lọc địa điểm: CN2 = 1,2tr; trụ sở (gồm đơn không gắn địa điểm) = 2,9tr');

  -- ------------------------------------------------------------ tháng 6: hủy đơn tháng trước, trả hàng, phiếu trả hủy cùng tháng
  x := pg_temp.s1a_sum('2026-06-01', '2026-06-30');
  perform pg_temp.rec('S1A-june-total', 'control', pg_temp.ok(x = -400000 - 100000 + 500000), format('tháng 6 = %s (−400k hủy D, −100k giảm giá B, +500k E; phiếu trả E hủy cùng tháng bị bỏ)', x));
  perform pg_temp.rec('S1A-prior-month-void-row', 'control', pg_temp.ok(exists (select 1 from public.book_s1a('2026-06-01', '2026-06-30') where doc_type = 'sale_void' and line_date = '2026-06-03' and amount = -400000 and description like 'Hủy đơn bán % ngày 28/05/2026%')), 'hủy đơn tháng trước = dòng điều chỉnh giảm vào ngày hủy');
  perform pg_temp.rec('S1A-return-row', 'control', pg_temp.ok(exists (select 1 from public.book_s1a('2026-06-01', '2026-06-30') where doc_type = 'return' and amount = -100000 and description like 'Hàng bán bị trả lại / giảm giá — phiếu %')), 'trả hàng/giảm giá ghi âm');
  perform pg_temp.rec('S1A-voided-return-excluded', 'control', pg_temp.ok(not exists (select 1 from public.book_s1a('2026-06-01', '2026-06-30') where doc_id = (rt2->>'return_id')::uuid)), 'phiếu trả hủy cùng tháng không lên sổ');
  perform pg_temp.rec('S1A-ordered', 'control', pg_temp.ok((select bool_and(ok) from (select line_date >= lag(line_date, 1, line_date) over () as ok from public.book_s1a('2026-05-01', '2026-06-30')) z)), 'sắp theo ngày');

  -- ------------------------------------------------------------ khớp sổ cái, doanh thu năm
  select * into chk from public.book_s1a_check('2026-05-01', '2026-05-31');
  perform pg_temp.rec('S1A-gl-may', 'control', pg_temp.ok(chk.diff = 0 and chk.s1a_total = 4100000), format('S1a %s vs sổ cái %s', chk.s1a_total, chk.gl_total));
  select * into chk from public.book_s1a_check('2026-06-01', '2026-06-30');
  perform pg_temp.rec('S1A-gl-june', 'control', pg_temp.ok(chk.diff = 0), format('S1a %s vs sổ cái %s', chk.s1a_total, chk.gl_total));
  select * into chk from public.book_s1a_check('2026-01-01', '2026-12-31');
  perform pg_temp.rec('S1A-gl-year-vs-revenue-ytd', 'control', pg_temp.ok(chk.diff = 0 and chk.s1a_total = public.revenue_ytd(2026)), format('năm: S1a %s, sổ cái %s, revenue_ytd %s', chk.s1a_total, chk.gl_total, public.revenue_ytd(2026)));

  -- ------------------------------------------------------------ tổng hợp theo ngày
  select count(*), sum(amount) into n, x from public.book_s1a('2026-05-01', '2026-05-31', null, 'daily');
  perform pg_temp.rec('S1A-daily', 'control', pg_temp.ok(n = 4 and x = 4100000 and exists (select 1 from public.book_s1a('2026-05-01', '2026-05-31', null, 'daily') where line_date = '2026-05-10' and tax_group = 'goods' and amount = 2000000 and description like 'Doanh thu bán hàng hóa, dịch vụ ngày 10/05/2026 — %(1 chứng từ)')),
    format('theo ngày: %s dòng, tổng %s', n, x));
  select count(*), sum(amount) into n, x from public.book_s1a('2026-06-01', '2026-06-30', null, 'daily');
  perform pg_temp.rec('S1A-daily-adjust', 'control', pg_temp.ok(x = 0 and exists (select 1 from public.book_s1a('2026-06-01', '2026-06-30', null, 'daily') where doc_type = 'daily_adjust' and amount < 0)), format('tháng 6 theo ngày: tổng %s, có dòng điều chỉnh giảm', x));

  -- ------------------------------------------------------------ tham số sai, quyền
  e := pg_temp.try($q$select * from public.book_s1a('2026-06-01', '2026-05-01')$q$);
  perform pg_temp.rec('S1A-period-invalid', 'control', pg_temp.ok(e like 'period_invalid%'), e);
  e := pg_temp.try($q$select * from public.book_s1a('2020-01-01', '2026-05-01')$q$);
  perform pg_temp.rec('S1A-period-too-long', 'control', pg_temp.ok(e like 'period_invalid%'), e);
  e := pg_temp.try($q$select * from public.book_s1a('2026-05-01', '2026-05-31', null, 'weekly')$q$);
  perform pg_temp.rec('S1A-mode-invalid', 'control', pg_temp.ok(e like 'mode_invalid%'), e);
  reset role;
  perform pg_temp.act_as('anon');
  e := pg_temp.try($q$select * from public.book_s1a('2026-05-01', '2026-05-31')$q$);
  reset role;
  perform pg_temp.rec('S1A-anon', 'control', pg_temp.ok(e like 'permission denied%'), 'anon: ' || e);

  -- ------------------------------------------------------------ nhật ký xuất
  perform pg_temp.act_as('authenticated', u2);
  ex := public.record_book_export(jsonb_build_object('kind', 's1a', 'period_from', '2026-05-01', 'period_to', '2026-05-31', 'format', 'xlsx', 'file_name', 'S1a-HKD_0123456789_2026-05.xlsx',
          'sha256', repeat('ab', 32), 'row_count', 4, 'total', 4100000, 'template_version', 'TT152/2025 S1a-HKD'));
  e := pg_temp.try($q$select public.record_book_export('{"kind":"s1a","period_from":"2026-05-01","period_to":"2026-05-31","format":"xlsx","file_name":"x","sha256":"nothex"}'::jsonb)$q$);
  perform pg_temp.rec('S1A-export-sha-check', 'control', pg_temp.ok(e = 'export_invalid'), e);
  e := pg_temp.try($q$select public.record_book_export('{"kind":"s2a","period_from":"2026-05-01","period_to":"2026-05-31","format":"xlsx","file_name":"x","sha256":"abababababababababababababababababababababababababababababababab"}'::jsonb)$q$);
  perform pg_temp.rec('S1A-export-kind-check', 'control', pg_temp.ok(e = 'export_invalid'), e);
  e := pg_temp.try($q$insert into public.book_exports(kind, period_from, period_to, format, file_name, sha256, template_version) values ('s1a','2026-05-01','2026-05-31','xlsx','x',repeat('ab',32),'v')$q$);
  perform pg_temp.rec('S1A-export-no-direct-insert', 'control', pg_temp.ok(e like 'permission denied%'), e);
  reset role;
  e := pg_temp.try(format($q$update public.book_exports set file_name = 'y' where id = %L$q$, ex));
  perform pg_temp.rec('S1A-export-immutable', 'control', pg_temp.ok(e like 'immutable%'), 'kể cả superuser: ' || e);
  perform pg_temp.rec('S1A-export-row', 'control', pg_temp.ok((select exported_by = u2 and row_count = 4 and total = 4100000 from public.book_exports where id = ex)), 'ghi người xuất, số dòng, tổng');
  perform pg_temp.act_as('anon');
  e := pg_temp.try($q$select count(*) from public.book_exports$q$);
  reset role;
  perform pg_temp.rec('S1A-export-anon', 'control', pg_temp.ok(e like 'permission denied%'), e);
  perform pg_temp.rec('S1A-fn-search-path', 'control', pg_temp.ok(not exists (select 1 from pg_proc where proname in ('book_s1a', 'book_s1a_check', 'record_book_export', 'trg_book_exports_immutable') and pronamespace = 'public'::regnamespace and (proconfig is null or not exists (select 1 from unnest(proconfig) cfg(v) where cfg.v like 'search_path=%')))), 'mọi hàm mới có search_path');
end $$;
select current_setting('harness.out');
rollback;
