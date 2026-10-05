-- 0014 (A3): gỡ xung đột VAT ở chế độ HKD — 3331/133/711 không còn dùng cho luồng bán/mua; chế độ legacy 'enterprise' chỉ owner đổi được (rolled back)
\ir ../_lib.sql
begin;
create or replace function pg_temp.recon_ok() returns boolean language sql as $f$
  select coalesce(bool_and(diff = 0), false) from public.accounting_reconciliation() $f$;
do $$
declare
  u uuid := pg_temp.mk_staff('owner'); u2 uuid := pg_temp.mk_staff('staff'); nobody uuid;
  c uuid := pg_temp.mk_customer(); s uuid := pg_temp.mk_supplier(); p uuid := pg_temp.mk_product(0, 0); p2 uuid := pg_temp.mk_product(0, 0);
  b jsonb; b0 jsonb; q jsonb; qid uuid; qid2 uuid; inv jsonb; e text; n int; x numeric; v numeric; m text; sv numeric; sq int; adj jsonb; rv jsonb; old_entry uuid; old_rev uuid; cnt int;
begin
  insert into auth.users(id, email) values (gen_random_uuid(), 'nobody32@test.local') returning id into nobody;
  perform pg_temp.rec('VAT-default-hkd', 'control', pg_temp.ok(public.accounting_mode() = 'hkd'), 'chế độ mặc định = ' || public.accounting_mode());

  -- ------------------------------------------------------------ mua hàng: VAT cộng vào giá vốn
  perform pg_temp.act_as('authenticated', u);
  b := public.post_purchase_bill(s, '2026-06-02', null, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 10, 'unit_cost', 100000, 'vat_rate', 10)), 'HĐ-NCC-77');
  reset role;
  perform pg_temp.rec('VAT-purchase-folded', 'control', pg_temp.ok((b->>'total')::numeric = 1100000 and (b->>'vat')::numeric = 100000 and (b->>'vat_in_cost')::numeric = 100000
      and pg_temp.bal('156') = 1100000 and pg_temp.bal('331') = 1100000 and pg_temp.bal('133') = 0),
    format('total %s; 156=%s 331=%s 133=%s', b->>'total', pg_temp.bal('156'), pg_temp.bal('331'), pg_temp.bal('133')));
  select stock_qty, stock_value into sq, sv from public.products where id = p;
  perform pg_temp.rec('VAT-purchase-stock-value', 'control', pg_temp.ok(sq = 10 and sv = 1100000), format('tồn %s, giá trị %s (gồm VAT)', sq, sv));
  perform pg_temp.rec('VAT-purchase-no-133-line', 'control', pg_temp.ok(not exists (select 1 from public.journal_lines where entry_id = (b->>'entry_id')::uuid and account_code in ('133', '3331'))), 'không có dòng 133/3331');
  perform pg_temp.rec('VAT-purchase-ref', 'control', pg_temp.ok((select supplier_ref from public.purchase_bills where id = (b->>'bill_id')::uuid) = 'HĐ-NCC-77' and (select vat_amount from public.purchase_bills where id = (b->>'bill_id')::uuid) = 100000), 'lưu số chứng từ NCC và vat_amount để tra cứu');
  perform pg_temp.rec('VAT-recon-1', 'control', pg_temp.ok(pg_temp.recon_ok()), 'đối chiếu sau mua hàng');

  -- hủy phiếu mua trả đúng giá trị tồn
  perform pg_temp.act_as('authenticated', u);
  rv := public.reverse_purchase_bill((b->>'bill_id')::uuid, '2026-06-03', 'nhập nhầm');
  reset role;
  select stock_qty, stock_value into sq, sv from public.products where id = p;
  perform pg_temp.rec('VAT-void-restores-stock', 'control', pg_temp.ok(sq = 0 and sv = 0 and pg_temp.bal('156') = 0 and pg_temp.bal('331') = 0), format('sau hủy: tồn %s, giá trị %s, 156=%s, 331=%s', sq, sv, pg_temp.bal('156'), pg_temp.bal('331')));
  perform pg_temp.rec('VAT-recon-2', 'control', pg_temp.ok(pg_temp.recon_ok()), 'đối chiếu sau hủy phiếu mua');

  -- mua lại (không VAT) để có hàng bán
  perform pg_temp.act_as('authenticated', u);
  b0 := public.post_purchase_bill(s, '2026-06-04', null, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 10, 'unit_cost', 100000), jsonb_build_object('product_id', p2, 'qty', 5, 'unit_cost', 50000)));
  e := pg_temp.try(format($q$select public.post_purchase_bill(%L, '2026-06-05', '2026-06-01', jsonb_build_array(jsonb_build_object('product_id', %L, 'qty', 1, 'unit_cost', 1)))$q$, s, p));
  perform pg_temp.rec('VAT-due-before-bill', 'control', pg_temp.ok(e = 'due_before_bill_date'), e);
  reset role;

  -- ------------------------------------------------------------ nhập kho tay bị chặn; tồn đầu/kiểm kê vẫn chạy
  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try(format($q$select public.stock_adjust(%L, 'in', 1, 50000, 'manual')$q$, p));
  perform pg_temp.rec('VAT-manual-in-blocked', 'control', pg_temp.ok(e = 'stock_in_requires_purchase_bill'), e);
  e := pg_temp.try(format($q$select public.stock_adjust(%L, 'in', 1)$q$, p));
  perform pg_temp.rec('VAT-null-ref-in-blocked', 'control', pg_temp.ok(e = 'stock_in_requires_purchase_bill'), e);
  e := pg_temp.try(format($q$select public.stock_adjust(%L, 'in', 1, 50000, 'whatever')$q$, p));
  perform pg_temp.rec('VAT-other-ref-in-blocked', 'control', pg_temp.ok(e = 'stock_in_requires_purchase_bill'), 'ref lạ cũng bị chặn: ' || e);
  e := pg_temp.try(format($q$select public.stock_adjust(%L, 'in', 2, 70000, 'opening')$q$, p2));
  perform pg_temp.rec('VAT-opening-allowed', 'control', pg_temp.ok(e = 'OK'), 'tồn đầu kỳ vẫn nhập được: ' || e);
  e := pg_temp.try(format($q$select public.stock_adjust(%L, 'out', 1, null, 'manual', null, 'hỏng')$q$, p2));
  perform pg_temp.rec('VAT-manual-out-allowed', 'control', pg_temp.ok(e = 'OK'), 'xuất hỏng vẫn được: ' || e);
  reset role;

  -- post_stock_adjustments: hàng mua KHÔNG lên 711; chỉ kiểm kê thừa mới lên 711
  perform pg_temp.act_as('authenticated', u);
  adj := public.post_stock_adjustments('2026-06-10');
  reset role;
  perform pg_temp.rec('VAT-no-711-from-purchase', 'control', pg_temp.ok(pg_temp.bal('711') = 0 and pg_temp.recon_ok()), format('711=%s sau post_stock_adjustments: %s', pg_temp.bal('711'), adj::text));
  perform pg_temp.act_as('authenticated', u);
  perform public.stock_adjust(p, 'adjust', 1, null, 'stocktake', null, 'kiểm kê thừa');
  adj := public.post_stock_adjustments('2026-06-11');
  reset role;
  perform pg_temp.rec('VAT-stocktake-gain-711', 'control', pg_temp.ok(pg_temp.bal('711') > 0 and pg_temp.recon_ok()), format('kiểm kê thừa vẫn ghi 711 = %s', pg_temp.bal('711')));

  -- ------------------------------------------------------------ bán hàng
  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try(format($q$select public.post_sales_invoice(%L, '2026-06-12', null, jsonb_build_array(jsonb_build_object('product_id', %L, 'qty', 1, 'unit_price', 200000, 'vat_rate', 10)))$q$, c, p));
  perform pg_temp.rec('VAT-sales-invoice-vat-blocked', 'control', pg_temp.ok(e like 'vat_not_allowed_hkd%' or e like 'vat_account_not_allowed_hkd%'), 'post_sales_invoice VAT 10%: ' || e);
  e := pg_temp.try(format($q$select public.post_sales_invoice(%L, '2026-06-12', null, jsonb_build_array(jsonb_build_object('product_id', %L, 'qty', 1, 'unit_price', 200000, 'vat_rate', 0)))$q$, c, p));
  perform pg_temp.rec('VAT-sales-invoice-novat-ok', 'control', pg_temp.ok(e = 'OK'), 'post_sales_invoice VAT 0: ' || e);
  reset role;
  perform pg_temp.rec('VAT-sale-no-3331', 'control', pg_temp.ok(pg_temp.bal('3331') = 0 and pg_temp.bal('133') = 0), format('3331=%s 133=%s', pg_temp.bal('3331'), pg_temp.bal('133')));
  -- trực tiếp: post_journal vào 3331/133 bị chặn
  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try($q$select public.post_journal('2026-06-12', 'x', jsonb_build_array(jsonb_build_object('account', '111', 'debit', 100), jsonb_build_object('account', '3331', 'credit', 100)))$q$);
  perform pg_temp.rec('VAT-journal-3331-blocked', 'control', pg_temp.ok(e like 'vat_account_not_allowed_hkd%'), e);
  e := pg_temp.try($q$select public.post_journal('2026-06-12', 'x', jsonb_build_array(jsonb_build_object('account', '133', 'debit', 100), jsonb_build_object('account', '111', 'credit', 100)))$q$);
  perform pg_temp.rec('VAT-journal-133-blocked', 'control', pg_temp.ok(e like 'vat_account_not_allowed_hkd%'), e);
  reset role;

  -- ------------------------------------------------------------ báo giá không còn VAT
  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try(format($q$select public.save_quotation(null, 'BG-V-1', %L, 'draft', null, null, 0, 10, jsonb_build_array(jsonb_build_object('product_id', %L, 'qty', 1, 'unit_price', 1000)))$q$, c, p));
  perform pg_temp.rec('VAT-quotation-vat-blocked', 'control', pg_temp.ok(e like 'vat_not_allowed_hkd%'), 'báo giá VAT 10%: ' || e);
  q := public.save_quotation(null, 'BG-V-2', c, 'draft', null, null, 100000, 0,
        jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 3, 'unit_price', 1000000, 'discount', 10)));
  qid := (q->>'id')::uuid;
  reset role;
  select total, vat into x, v from public.quotations where id = qid;
  perform pg_temp.rec('VAT-quotation-total', 'control', pg_temp.ok(x = 2600000 and v = 0), format('báo giá VAT 0: tổng %s (3×1M×0,9 − 100k)', x));
  update public.quotations set status = 'sent' where id = qid;
  update public.quotations set status = 'approved' where id = qid;
  perform pg_temp.act_as('authenticated', u);
  inv := public.invoice_from_quotation(qid, '2026-06-15', '2026-07-15');
  reset role;
  perform pg_temp.rec('VAT-quotation-invoice-hkd', 'control', pg_temp.ok(abs((inv->>'total')::numeric - 2600000) <= 1
      and (select quotation_id from public.sales_invoices where id = (inv->>'invoice_id')::uuid) = qid
      and (select sale_source from public.sales_invoices where id = (inv->>'invoice_id')::uuid) = 'hkd_sale'
      and (select vat_amount from public.sales_invoices where id = (inv->>'invoice_id')::uuid) = 0
      and pg_temp.bal('3331') = 0 and pg_temp.recon_ok()), 'hóa đơn từ báo giá: ' || inv::text);
  perform pg_temp.rec('VAT-quotation-invoice-debt', 'control', pg_temp.ok((select due_date from public.sales_invoices where id = (inv->>'invoice_id')::uuid) = date '2026-07-15' and pg_temp.bal('131') >= 2599999), 'ghi công nợ đúng khách, hạn thanh toán lưu');
  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try(format('select public.invoice_from_quotation(%L, ''2026-06-16'')', qid));
  reset role;
  perform pg_temp.rec('VAT-quotation-once', 'control', pg_temp.ok(e = 'quotation_already_invoiced'), e);

  -- báo giá cũ (đã lưu với VAT trước khi chuyển chế độ) không xuất hóa đơn được ở HKD
  perform pg_temp.set_mode('enterprise');
  perform pg_temp.act_as('authenticated', u);
  q := public.save_quotation(null, 'BG-V-3', c, 'draft', null, null, 0, 10, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1, 'unit_price', 1000000)));
  reset role;
  qid2 := (q->>'id')::uuid;
  update public.quotations set status = 'sent' where id = qid2;
  update public.quotations set status = 'approved' where id = qid2;
  perform pg_temp.set_mode('hkd');
  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try(format('select public.invoice_from_quotation(%L, ''2026-06-17'')', qid2));
  reset role;
  perform pg_temp.rec('VAT-legacy-quotation-blocked', 'control', pg_temp.ok(e like 'vat_not_allowed_hkd%'), 'báo giá cũ có VAT: ' || e);

  -- ------------------------------------------------------------ chế độ: chỉ owner đổi, có lý do, có audit
  select count(*) into cnt from public.accounting_audit where action = 'set_accounting_mode';
  perform pg_temp.act_as('authenticated', u2);
  e := pg_temp.try($q$select public.set_accounting_mode('enterprise', 'thử đổi chế độ')$q$);
  reset role;
  perform pg_temp.rec('VAT-mode-staff-denied', 'control', pg_temp.ok(e = 'forbidden'), 'staff đổi chế độ: ' || e);
  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try($q$select public.set_accounting_mode('enterprise', 'x')$q$);
  perform pg_temp.rec('VAT-mode-reason-required', 'control', pg_temp.ok(e = 'reason_required'), e);
  e := pg_temp.try($q$select public.set_accounting_mode('foo', 'lý do hợp lệ')$q$);
  perform pg_temp.rec('VAT-mode-invalid', 'control', pg_temp.ok(e = 'accounting_mode_invalid'), e);
  m := public.set_accounting_mode('enterprise', 'doanh nghiệp, cần VAT');
  reset role;
  perform pg_temp.rec('VAT-mode-owner-switch', 'control', pg_temp.ok(m = 'enterprise' and public.accounting_mode() = 'enterprise'
      and (select count(*) from public.accounting_audit where action = 'set_accounting_mode') = cnt + 1), 'owner đổi sang enterprise và được audit');
  -- ở chế độ enterprise, luồng VAT cũ chạy lại bình thường
  perform pg_temp.act_as('authenticated', u);
  b := public.post_purchase_bill(s, '2026-06-20', null, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1, 'unit_cost', 100000, 'vat_rate', 10)));
  inv := public.post_sales_invoice(c, '2026-06-21', null, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1, 'unit_price', 200000, 'vat_rate', 10)));
  reset role;
  perform pg_temp.rec('VAT-enterprise-legacy-flow', 'control', pg_temp.ok(pg_temp.bal('133') = 10000 and pg_temp.bal('3331') = 20000 and pg_temp.recon_ok()), format('enterprise: 133=%s 3331=%s', pg_temp.bal('133'), pg_temp.bal('3331')));
  -- quay lại HKD: đảo bút toán 3331/133 cũ vẫn được phép (chứng từ cũ), nhưng không ghi mới
  perform pg_temp.act_as('authenticated', u);
  perform public.set_accounting_mode('hkd', 'quay lại hộ kinh doanh');
  rv := public.reverse_sales_invoice((inv->>'invoice_id')::uuid, '2026-06-22', 'hủy hóa đơn VAT cũ');
  reset role;
  perform pg_temp.rec('VAT-legacy-reversal-allowed', 'control', pg_temp.ok(pg_temp.bal('3331') = 0 and pg_temp.recon_ok()), 'đảo hóa đơn có 3331 ở chế độ HKD vẫn chạy; 3331 = ' || pg_temp.bal('3331'));
  perform pg_temp.act_as('authenticated', u);
  rv := public.reverse_purchase_bill((b->>'bill_id')::uuid, '2026-06-22', 'hủy phiếu mua có 133');
  reset role;
  perform pg_temp.rec('VAT-legacy-purchase-reversal', 'control', pg_temp.ok(pg_temp.bal('133') = 0 and pg_temp.recon_ok()), 'đảo phiếu mua có 133 ở chế độ HKD; 133 = ' || pg_temp.bal('133'));

  -- ------------------------------------------------------------ bảo mật
  select count(*) into n from pg_proc p join pg_namespace s2 on s2.oid = p.pronamespace
   where s2.nspname = 'public' and p.proname in ('accounting_mode', 'set_accounting_mode', 'trg_hkd_no_vat', 'trg_hkd_no_vat_accounts', 'stock_adjust', 'post_purchase_bill', 'reverse_purchase_bill', 'post_sale_hkd', 'invoice_from_quotation')
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%');
  perform pg_temp.rec('VAT-fns-search-path', 'control', pg_temp.ok(n = 0), format('%s hàm 0014 thiếu search_path', n));
  perform pg_temp.rec('VAT-trigger-fns-not-exposed', 'control', pg_temp.ok(not has_function_privilege('anon', 'public.trg_hkd_no_vat()', 'execute') and not has_function_privilege('authenticated', 'public.trg_hkd_no_vat()', 'execute')
      and not has_function_privilege('anon', 'public.trg_hkd_no_vat_accounts()', 'execute') and not has_function_privilege('authenticated', 'public.trg_hkd_no_vat_accounts()', 'execute')), 'hàm trigger không gọi được qua RPC');
  perform pg_temp.rec('VAT-anon-denied', 'control', pg_temp.ok(not has_function_privilege('anon', 'public.set_accounting_mode(text,text)', 'execute') and not has_function_privilege('anon', 'public.accounting_mode()', 'execute') and not has_function_privilege('anon', 'public.post_purchase_bill(uuid,date,date,jsonb,text,text)', 'execute')), 'anon không gọi được RPC mới');
  perform pg_temp.rec('VAT-rls-app-settings', 'control', pg_temp.ok((select relrowsecurity from pg_class where oid = 'public.app_settings'::regclass)
      and not exists (select 1 from pg_policies where tablename = 'app_settings' and (qual ~ '(^|[^(])auth\.uid\(\)' or with_check ~ '(^|[^(])auth\.uid\(\)'))), 'app_settings bật RLS, không auth.uid() trần');
  perform pg_temp.act_as('authenticated', nobody);
  e := pg_temp.try($q$select count(*) from public.app_settings$q$);
  select count(*) into n from public.app_settings;
  perform pg_temp.rec('VAT-settings-nonstaff-sees-nothing', 'control', pg_temp.ok(n = 0), 'user không thuộc app thấy ' || n || ' dòng app_settings');
  e := pg_temp.try($q$update public.app_settings set value = 'enterprise' where key = 'accounting_mode'$q$);
  reset role;
  perform pg_temp.rec('VAT-settings-no-direct-write', 'control', pg_temp.ok(e like 'permission denied%'), 'ghi trực tiếp app_settings: ' || e);
end $$;
select current_setting('harness.out');
rollback;
