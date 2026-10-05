-- 0013 (A2): bán hàng HKD nguyên tử, khách lẻ, nhiều phương thức thanh toán, nhóm ngành, trả hàng, hóa đơn điện tử (rolled back)
\ir ../_lib.sql
begin;
create or replace function pg_temp.recon_ok() returns boolean language sql as $f$
  select coalesce(bool_and(diff = 0), false) from public.accounting_reconciliation() $f$;
do $$
declare
  u uuid := pg_temp.mk_staff('owner'); u2 uuid := pg_temp.mk_staff('staff'); nobody uuid;
  c uuid := pg_temp.mk_customer(); s uuid := pg_temp.mk_supplier(); p uuid := pg_temp.mk_product(0, 0); p2 uuid := pg_temp.mk_product(0, 0);
  walk uuid; j jsonb; j2 jsonb; jw jsonb; r1 jsonb; r2 jsonb; r3 jsonb; e text; n int; n0 int; m0 int; q int; x numeric; sale1 uuid; line1 uuid; line2 uuid;
  b632 numeric; b111 numeric; b112 numeric; q2 int; ei jsonb; ei2 jsonb; rev numeric; tg numeric; legacy jsonb; sale_w uuid; big uuid;
begin
  insert into auth.users(id, email) values (gen_random_uuid(), 'nobody31@test.local') returning id into nobody;
  select id into walk from public.customers where is_walkin;
  perform pg_temp.rec('HKD-walkin-seeded', 'control', pg_temp.ok(walk is not null and (select count(*) from public.customers where is_walkin) = 1), 'có đúng 1 khách lẻ hệ thống');
  e := pg_temp.try($q$delete from public.customers where is_walkin$q$);
  perform pg_temp.rec('HKD-walkin-no-delete', 'control', pg_temp.ok(e = 'walkin_customer_protected'), e);
  e := pg_temp.try($q$update public.customers set name = 'Khác' where is_walkin$q$);
  perform pg_temp.rec('HKD-walkin-no-rename', 'control', pg_temp.ok(e = 'walkin_customer_protected'), e);
  e := pg_temp.try($q$insert into public.customers(name, is_walkin) values ('Khách lẻ 2', true)$q$);
  perform pg_temp.rec('HKD-walkin-single', 'control', pg_temp.ok(e like '%uq_customers_walkin%'), 'khách lẻ thứ 2 bị chặn');

  -- tồn kho: mua 10 + 5 (giá vốn 1.000.000 / 200.000), không VAT
  perform pg_temp.act_as('authenticated', u);
  perform public.post_purchase_bill(s, '2026-05-02', null, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 10, 'unit_cost', 1000000, 'vat_rate', 0),
                                                                          jsonb_build_object('product_id', p2, 'qty', 5, 'unit_cost', 200000, 'vat_rate', 0)), 'NCC-A2');
  reset role;

  -- ---------------------------------------------------------------- bán 1: khách có tên, hàng + dịch vụ, tiền mặt + CK + còn nợ
  perform pg_temp.act_as('authenticated', u);
  j := public.post_sale_hkd(c, '2026-05-10',
        jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 4, 'unit_price', 1500000), jsonb_build_object('description', 'Công lắp đặt', 'qty', 1, 'unit_price', 500000, 'tax_group', 'service')),
        jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 3000000), jsonb_build_object('method', 'bank', 'amount', 2000000, 'note', 'MB 1234')),
        'store', null, jsonb_build_object('name', 'Cty Khách', 'tax_code', '0312345678', 'junk', 'x'), 'bán thử', '2026-06-10');
  reset role;
  sale1 := (j->>'invoice_id')::uuid;
  perform pg_temp.rec('HKD-sale-amounts', 'control', pg_temp.ok((j->>'total')::numeric = 6500000 and (j->>'paid')::numeric = 5000000 and (j->>'debt')::numeric = 1500000 and (j->>'cogs')::numeric = 4000000 and (j->>'vat')::numeric = 0),
    format('total %s paid %s debt %s cogs %s', j->>'total', j->>'paid', j->>'debt', j->>'cogs'));
  perform pg_temp.rec('HKD-sale-gl', 'control', pg_temp.ok(pg_temp.bal('111') = 3000000 and pg_temp.bal('112') = 2000000 and pg_temp.bal('131') = 1500000 and pg_temp.bal('511') = 6500000 and pg_temp.bal('632') = 4000000 and pg_temp.bal('156') = 7000000),
    format('111=%s 112=%s 131=%s 511=%s 632=%s 156=%s', pg_temp.bal('111'), pg_temp.bal('112'), pg_temp.bal('131'), pg_temp.bal('511'), pg_temp.bal('632'), pg_temp.bal('156')));
  perform pg_temp.rec('HKD-sale-no-vat-accounts', 'control', pg_temp.ok(pg_temp.bal('3331') = 0 and pg_temp.bal('133') = 0
      and not exists (select 1 from public.journal_lines where entry_id = (j->>'entry_id')::uuid and account_code in ('3331', '133'))
      and (select vat_amount from public.sales_invoices where id = sale1) = 0 and (select subtotal = total from public.sales_invoices where id = sale1)),
    'không có dòng 3331/133; vat_amount = 0; subtotal = total');
  perform pg_temp.rec('HKD-sale-single-entry', 'control', pg_temp.ok((select count(*) from public.journal_entries where source_id = sale1) = 1 and (select sum(debit) = sum(credit) from public.journal_lines where entry_id = (j->>'entry_id')::uuid)),
    'một bút toán cân cho cả đơn');
  perform pg_temp.rec('HKD-sale-payments-rows', 'control', pg_temp.ok((select count(*) from public.sale_payments where sale_id = sale1 and direction = 'in') = 2 and (select sum(amount) from public.sale_payments where sale_id = sale1) = 5000000
      and (select paid_at_sale from public.sales_invoices where id = sale1) = 5000000), '2 dòng thanh toán (tiền mặt, ngân hàng), paid_at_sale = 5.000.000');
  perform pg_temp.rec('HKD-sale-outstanding', 'control', pg_temp.ok((select outstanding from public.v_sales_invoice_open where invoice_id = sale1) = 1500000 and (select balance from public.v_ar_by_customer where customer_id = c) = 1500000),
    'công nợ còn 1.500.000, khớp 131');
  select id into line1 from public.sales_invoice_lines where invoice_id = sale1 and line_no = 1;
  select id into line2 from public.sales_invoice_lines where invoice_id = sale1 and line_no = 2;
  perform pg_temp.rec('HKD-sale-tax-group-snapshot', 'control', pg_temp.ok((select tax_group = 'goods' and vat_pct_snapshot = 1 and pit_pct_snapshot = 0.5 from public.sales_invoice_lines where id = line1)
      and (select tax_group = 'service' and vat_pct_snapshot = 5 and pit_pct_snapshot = 2 from public.sales_invoice_lines where id = line2)), 'hàng 1/0,5; dịch vụ 5/2');
  perform pg_temp.rec('HKD-sale-buyer-sanitised', 'control', pg_temp.ok((select buyer = jsonb_build_object('name', 'Cty Khách', 'tax_code', '0312345678') from public.sales_invoices where id = sale1)), 'buyer chỉ giữ khóa hợp lệ');
  insert into public.tax_rates(tax_group, vat_pct, pit_pct, effective_from, source) values ('goods', 9, 9, '2026-09-01', 'test');
  perform pg_temp.rec('HKD-sale-snapshot-immutable', 'control', pg_temp.ok((select vat_pct_snapshot from public.sales_invoice_lines where id = line1) = 1), 'đổi tax_rates không đổi snapshot hóa đơn cũ');
  perform pg_temp.rec('HKD-recon-sale', 'control', pg_temp.ok(pg_temp.recon_ok()), 'sổ phụ == sổ cái sau bán');
  e := pg_temp.try(format($q$update public.sales_invoice_lines set tax_group = 'service' where id = %L$q$, line1));
  perform pg_temp.rec('HKD-sale-line-immutable', 'control', pg_temp.ok(e like '%immutable%'), left(e, 80));

  -- ---------------------------------------------------------------- nguyên tử: lỗi ở dòng 2 → không để lại dấu vết
  select count(*) into n0 from public.journal_entries; select count(*) into m0 from public.stock_movements; select count(*) into n from public.sales_invoices; select stock_qty into q from public.products where id = p;
  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try(format($q$select public.post_sale_hkd(%L, '2026-05-10', jsonb_build_array(jsonb_build_object('product_id', %L, 'qty', 1, 'unit_price', 1), jsonb_build_object('product_id', %L, 'qty', 99, 'unit_price', 1)), '[]'::jsonb)$q$, c, p, p2));
  reset role;
  perform pg_temp.rec('HKD-sale-atomic', 'control', pg_temp.ok(e like 'insufficient_stock%' and (select count(*) from public.journal_entries) = n0 and (select count(*) from public.stock_movements) = m0
      and (select count(*) from public.sales_invoices) = n and (select stock_qty from public.products where id = p) = q), 'bán lỗi giữa chừng không để lại bút toán/kho/hóa đơn: ' || left(e, 50));

  -- ---------------------------------------------------------------- khách lẻ
  perform pg_temp.act_as('authenticated', u2);
  jw := public.post_sale_hkd(null, '2026-05-11', jsonb_build_array(jsonb_build_object('product_id', p2, 'qty', 2, 'unit_price', 300000)),
          jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 600000)));
  reset role;
  sale_w := (jw->>'invoice_id')::uuid;
  perform pg_temp.rec('HKD-walkin-sale', 'control', pg_temp.ok((jw->>'is_walkin')::boolean and (jw->>'customer_id')::uuid = walk and (jw->>'debt')::numeric = 0 and pg_temp.bal('131') = 1500000), 'khách lẻ (nhân viên staff) bán đủ tiền mặt, không phát sinh nợ');
  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try(format($q$select public.post_sale_hkd(null, '2026-05-11', jsonb_build_array(jsonb_build_object('product_id', %L, 'qty', 1, 'unit_price', 300000)), jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 100000)))$q$, p2));
  perform pg_temp.rec('HKD-walkin-must-pay', 'control', pg_temp.ok(e = 'walkin_must_pay_in_full'), 'khách lẻ trả thiếu: ' || e);
  e := pg_temp.try(format($q$select public.post_sale_hkd(%L, '2026-05-11', jsonb_build_array(jsonb_build_object('product_id', %L, 'qty', 1, 'unit_price', 300000)), '[]'::jsonb)$q$, walk, p2));
  perform pg_temp.rec('HKD-walkin-explicit-must-pay', 'control', pg_temp.ok(e = 'walkin_must_pay_in_full'), 'chọn Khách lẻ nhưng không thu tiền: ' || e);
  reset role;
  e := pg_temp.try(format($q$insert into public.sales_invoices(invoice_no, customer_id, invoice_date, due_date, subtotal, vat_amount, total, entry_id) values ('X-1', %L, '2026-05-11', '2026-05-11', 10, 0, 10, (select id from public.journal_entries limit 1))$q$, walk));
  perform pg_temp.rec('HKD-walkin-db-guard', 'control', pg_temp.ok(e = 'walkin_must_pay_in_full'), 'trigger chặn hóa đơn nợ cho khách lẻ ở mọi đường: ' || e);

  -- ---------------------------------------------------------------- validate đầu vào
  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try(format($q$select public.post_sale_hkd(%L, '2026-05-11', jsonb_build_array(jsonb_build_object('product_id', %L, 'qty', 1, 'unit_price', 300000, 'vat_rate', 10)), '[]'::jsonb)$q$, c, p2));
  perform pg_temp.rec('HKD-no-vat-input', 'control', pg_temp.ok(e like 'vat_not_allowed_hkd%'), 'dòng có vat_rate 10: ' || e);
  e := pg_temp.try(format($q$select public.post_sale_hkd(%L, '2026-05-11', jsonb_build_array(jsonb_build_object('product_id', %L, 'qty', 1, 'unit_price', 300000)), jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 300001)))$q$, c, p2));
  perform pg_temp.rec('HKD-pay-exceeds', 'control', pg_temp.ok(e like 'payment_exceeds_total%'), e);
  e := pg_temp.try(format($q$select public.post_sale_hkd(%L, '2026-05-11', jsonb_build_array(jsonb_build_object('product_id', %L, 'qty', 1, 'unit_price', 300000)), jsonb_build_array(jsonb_build_object('method', 'card', 'amount', 1)))$q$, c, p2));
  perform pg_temp.rec('HKD-pay-method', 'control', pg_temp.ok(e = 'method_invalid'), e);
  e := pg_temp.try(format($q$select public.post_sale_hkd(%L, '2026-05-11', jsonb_build_array(jsonb_build_object('product_id', %L, 'qty', 1, 'unit_price', 300000, 'tax_group', 'nope')), '[]'::jsonb)$q$, c, p2));
  perform pg_temp.rec('HKD-tax-group-unknown', 'control', pg_temp.ok(e like 'tax_group_unknown%'), e);
  e := pg_temp.try(format($q$select public.post_sale_hkd(%L, '2026-05-11', jsonb_build_array(jsonb_build_object('product_id', %L, 'qty', 1, 'unit_price', 300000, 'discount_pct', 10, 'discount_amount', 5)), '[]'::jsonb)$q$, c, p2));
  perform pg_temp.rec('HKD-discount-both', 'control', pg_temp.ok(e like 'line_invalid%'), e);
  e := pg_temp.try(format($q$select public.post_sale_hkd(%L, '2026-05-11', jsonb_build_array(jsonb_build_object('product_id', %L, 'qty', 1, 'unit_price', 0)), '[]'::jsonb)$q$, c, p2));
  perform pg_temp.rec('HKD-total-positive', 'control', pg_temp.ok(e = 'total_must_be_positive'), e);
  e := pg_temp.try($q$select public.post_sale_hkd(null, '2026-05-11', '[]'::jsonb, '[]'::jsonb)$q$);
  perform pg_temp.rec('HKD-lines-required', 'control', pg_temp.ok(e = 'lines_required'), e);
  e := pg_temp.try(format($q$select public.post_sale_hkd(%L, '2026-05-11', jsonb_build_array(jsonb_build_object('product_id', %L, 'qty', 1, 'unit_price', 1000)), '[]'::jsonb, 'bogus')$q$, c, p2));
  perform pg_temp.rec('HKD-channel-invalid', 'control', pg_temp.ok(e = 'channel_invalid'), e);
  reset role;
  update public.customers set debt_limit = 1000000 where id = c;
  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try(format($q$select public.post_sale_hkd(%L, '2026-05-11', jsonb_build_array(jsonb_build_object('product_id', %L, 'qty', 1, 'unit_price', 300000)), '[]'::jsonb)$q$, c, p2));
  perform pg_temp.rec('HKD-debt-limit', 'control', pg_temp.ok(e = 'debt_limit_exceeded'), 'hạn mức nợ 1.000.000 đã vượt: ' || e);
  j2 := public.post_sale_hkd(c, '2026-05-11', jsonb_build_array(jsonb_build_object('product_id', p2, 'qty', 1, 'unit_price', 300000, 'discount_pct', 10)), '[]'::jsonb, 'online', null, null, null, null, null, true);
  reset role;
  perform pg_temp.rec('HKD-discount-pct-and-override', 'control', pg_temp.ok((j2->>'total')::numeric = 270000 and (select channel = 'online' from public.sales_invoices where id = (j2->>'invoice_id')::uuid) and pg_temp.bal('131') = 1770000),
    'giảm 10 %: 270.000; vượt hạn mức khi allow_over_limit; kênh online');
  update public.customers set debt_limit = 0 where id = c;

  -- ---------------------------------------------------------------- hóa đơn điện tử (chỉ lưu)
  perform pg_temp.act_as('authenticated', u2);
  ei := public.record_sale_einvoice(sale1, jsonb_build_object('symbol', 'C26TAA', 'number', '0000123', 'lookup_code', 'ABC123XYZ', 'lookup_url', 'https://tracuu.example.vn/?c=ABC123XYZ', 'provider', 'NCC HĐĐT', 'issued_on', '2026-05-10'));
  reset role;
  perform pg_temp.rec('HKD-einvoice-record', 'control', pg_temp.ok((ei->>'status') = 'issued' and (ei->>'number') = '0000123' and (ei->>'lookup_code') = 'ABC123XYZ' and not exists (select 1 from public.v_sales_missing_einvoice where sale_id = sale1) and exists (select 1 from public.v_sales_missing_einvoice where sale_id = sale_w)),
    'staff lưu số/ký hiệu/mã tra cứu; đơn đã có HĐĐT rời danh sách thiếu HĐĐT');
  perform pg_temp.rec('HKD-einvoice-invoice-no-separate', 'control', pg_temp.ok((select invoice_no like 'INV-%' from public.sales_invoices where id = sale1)), 'số nội bộ INV-… tách khỏi số HĐĐT');
  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try(format($q$select public.record_sale_einvoice(%L, '{"number":"0000124"}'::jsonb)$q$, sale1));
  perform pg_temp.rec('HKD-einvoice-one-active', 'control', pg_temp.ok(e = 'einvoice_already_recorded'), e);
  e := pg_temp.try(format($q$select public.record_sale_einvoice(%L, '{"symbol":"C26TAA","number":"0000123"}'::jsonb)$q$, sale_w));
  perform pg_temp.rec('HKD-einvoice-number-unique', 'control', pg_temp.ok(e = 'einvoice_number_duplicate'), e);
  e := pg_temp.try(format($q$select public.record_sale_einvoice(%L, '{"number":"9"}'::jsonb)$q$, sale_w)); -- ok, khác ký hiệu
  perform pg_temp.rec('HKD-einvoice-no-symbol-ok', 'control', pg_temp.ok(e = 'OK'), 'số trùng nhưng khác ký hiệu/ không ký hiệu: ' || e);
  e := pg_temp.try(format($q$select public.record_sale_einvoice(%L, '{"number":"77","lookup_url":"javascript:alert(1)"}'::jsonb)$q$, (j2->>'invoice_id')::uuid));
  perform pg_temp.rec('HKD-einvoice-url-safe', 'control', pg_temp.ok(e = 'einvoice_url_invalid'), e);
  e := pg_temp.try(format($q$select public.record_sale_einvoice(%L, '{"symbol":"C26TAA"}'::jsonb)$q$, (j2->>'invoice_id')::uuid));
  perform pg_temp.rec('HKD-einvoice-number-required', 'control', pg_temp.ok(e = 'einvoice_number_required'), e);
  e := pg_temp.try(format($q$select public.record_sale_einvoice(%L, '{"number":"bad number!"}'::jsonb)$q$, (j2->>'invoice_id')::uuid));
  perform pg_temp.rec('HKD-einvoice-number-format', 'control', pg_temp.ok(e = 'einvoice_number_invalid'), e);
  e := pg_temp.try(format($q$select public.reverse_sales_invoice(%L, '2026-05-12', 'thử')$q$, sale1));
  perform pg_temp.rec('HKD-einvoice-blocks-void', 'control', pg_temp.ok(e = 'invoice_has_einvoice'), 'hủy đơn khi còn HĐĐT hiệu lực bị chặn: ' || e);
  -- thay thế
  ei2 := public.record_sale_einvoice(sale1, jsonb_build_object('kind', 'replace', 'symbol', 'C26TAA', 'number', '0000130'));
  reset role;
  perform pg_temp.rec('HKD-einvoice-replace', 'control', pg_temp.ok((select status from public.einvoices where id = (ei->>'id')::uuid) = 'replaced' and (ei2->>'status') = 'issued'
      and (select count(*) from public.einvoices where sale_id = sale1 and status = 'issued') = 1), 'hóa đơn thay thế: bản cũ → replaced, chỉ 1 bản hiệu lực');
  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try(format($q$select public.cancel_sale_einvoice(%L, 'x')$q$, (ei2->>'id')::uuid));
  perform pg_temp.rec('HKD-einvoice-cancel-reason', 'control', pg_temp.ok(e = 'reason_required'), e);
  perform public.cancel_sale_einvoice((ei2->>'id')::uuid, 'Hủy do sai thông tin người mua');
  e := pg_temp.try(format($q$select public.cancel_sale_einvoice(%L, 'Hủy lại lần nữa')$q$, (ei2->>'id')::uuid));
  perform pg_temp.rec('HKD-einvoice-cancel-once', 'control', pg_temp.ok(e = 'einvoice_not_active'), e);
  ei2 := public.record_sale_einvoice(sale1, jsonb_build_object('number', '0000131', 'symbol', 'C26TAA'));
  reset role;
  perform pg_temp.rec('HKD-einvoice-after-cancel', 'control', pg_temp.ok((ei2->>'status') = 'issued' and (select count(*) from public.einvoices where sale_id = sale1) = 3 and exists (select 1 from public.accounting_audit where action = 'cancel_sale_einvoice')),
    'hủy rồi lập mới được; có nhật ký hủy; lịch sử 3 bản ghi');
  -- HĐĐT truyền cùng lúc bán: lỗi trùng số → hủy cả đơn
  select count(*) into n from public.sales_invoices; select count(*) into n0 from public.journal_entries;
  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try(format($q$select public.post_sale_hkd(null, '2026-05-11', jsonb_build_array(jsonb_build_object('product_id', %L, 'qty', 1, 'unit_price', 1000)), jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000)), 'store', null, null, null, null, '{"symbol":"C26TAA","number":"0000131"}'::jsonb)$q$, p2));
  reset role;
  perform pg_temp.rec('HKD-einvoice-atomic-with-sale', 'control', pg_temp.ok(e = 'einvoice_number_duplicate' and (select count(*) from public.sales_invoices) = n and (select count(*) from public.journal_entries) = n0),
    'HĐĐT trùng số khi bán → cả đơn rollback: ' || e);
  perform pg_temp.act_as('authenticated', u);
  j := public.post_sale_hkd(null, '2026-05-11', jsonb_build_array(jsonb_build_object('product_id', p2, 'qty', 1, 'unit_price', 1000)), jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000)), 'store', null, null, null, null,
         '{"symbol":"C26TAA","number":"0000140","lookup_code":"Z9"}'::jsonb);
  reset role;
  perform pg_temp.rec('HKD-einvoice-with-sale', 'control', pg_temp.ok((j->'einvoice'->>'number') = '0000140'), 'lưu HĐĐT cùng lúc bán');

  -- ---------------------------------------------------------------- trả hàng
  -- đơn 1: dòng 1 = 4 × 1.500.000 (giá vốn 1.000.000/cái), công nợ còn 1.500.000
  b632 := pg_temp.bal('632'); b111 := pg_temp.bal('111'); b112 := pg_temp.bal('112');
  perform pg_temp.act_as('authenticated', u);
  r1 := public.post_sale_return(sale1, '2026-05-12', jsonb_build_array(jsonb_build_object('sale_line_id', line1, 'qty', 1)), null, 'Lỗi hàng');
  reset role;
  perform pg_temp.rec('HKD-return-1', 'control', pg_temp.ok((r1->>'total')::numeric = 1500000 and (r1->>'applied_to_debt')::numeric = 1500000 and (r1->>'refunded')::numeric = 0 and (r1->>'cogs')::numeric = 1000000
      and pg_temp.bal('521') = 1500000 and pg_temp.bal('131') = 270000 and pg_temp.bal('632') = b632 - 1000000 and (select stock_qty from public.products where id = p) = 7
      and (select outstanding from public.v_sales_invoice_open where invoice_id = sale1) = 0),
    format('trả 1 cái: trừ nợ 1.500.000, nhập lại kho (7), 521=%s 131=%s 632=%s', pg_temp.bal('521'), pg_temp.bal('131'), pg_temp.bal('632')));
  perform pg_temp.rec('HKD-return-entry', 'control', pg_temp.ok((select sum(debit) = sum(credit) from public.journal_lines where entry_id = (r1->>'entry_id')::uuid)
      and exists (select 1 from public.journal_lines where entry_id = (r1->>'entry_id')::uuid and account_code = '521' and debit = 1500000)
      and exists (select 1 from public.journal_lines where entry_id = (r1->>'entry_id')::uuid and account_code = '131' and credit = 1500000 and customer_id = c)), 'Nợ 521 / Có 131; Nợ 156 / Có 632');
  perform pg_temp.rec('HKD-recon-return', 'control', pg_temp.ok(pg_temp.recon_ok()), 'sổ phụ == sổ cái sau trả hàng (công nợ, kho)');
  b111 := pg_temp.bal('111'); b112 := pg_temp.bal('112');
  -- hoàn tiền: còn nợ 0 → hoàn đủ; sai tổng bị chặn
  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try(format($q$select public.post_sale_return(%L, '2026-05-13', jsonb_build_array(jsonb_build_object('sale_line_id', %L, 'qty', 1)), jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000000)))$q$, sale1, line1));
  perform pg_temp.rec('HKD-return-refund-mismatch', 'control', pg_temp.ok(e like 'refund_mismatch%'), left(e, 60));
  r2 := public.post_sale_return(sale1, '2026-05-13', jsonb_build_array(jsonb_build_object('sale_line_id', line1, 'qty', 1)),
          jsonb_build_array(jsonb_build_object('method', 'bank', 'amount', 1000000), jsonb_build_object('method', 'cash', 'amount', 500000)));
  reset role;
  perform pg_temp.rec('HKD-return-refund-split', 'control', pg_temp.ok((r2->>'refunded')::numeric = 1500000 and (r2->>'applied_to_debt')::numeric = 0 and pg_temp.bal('112') = b112 - 1000000 and pg_temp.bal('111') = b111 - 500000
      and (select count(*) from public.sale_payments where return_id = (r2->>'return_id')::uuid and direction = 'out') = 2),
    format('hoàn 1,0tr CK + 0,5tr tiền mặt: 112=%s 111=%s', pg_temp.bal('112'), pg_temp.bal('111')));
  -- giới hạn
  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try(format($q$select public.post_sale_return(%L, '2026-05-13', jsonb_build_array(jsonb_build_object('sale_line_id', %L, 'qty', 3)))$q$, sale1, line1));
  perform pg_temp.rec('HKD-return-cap-qty', 'control', pg_temp.ok(e like 'return_exceeds_sold%'), 'đã trả 2/4, trả thêm 3: ' || left(e, 50));
  e := pg_temp.try(format($q$select public.post_sale_return(%L, '2026-05-13', jsonb_build_array(jsonb_build_object('sale_line_id', %L, 'qty', 0, 'amount', 3000001)))$q$, sale1, line1));
  perform pg_temp.rec('HKD-return-cap-amount', 'control', pg_temp.ok(e like 'return_amount_exceeds_line%'), left(e, 60));
  e := pg_temp.try(format($q$select public.post_sale_return(%L, '2026-05-13', jsonb_build_array(jsonb_build_object('sale_line_id', %L, 'qty', 0)))$q$, sale1, line1));
  perform pg_temp.rec('HKD-return-amount-required', 'control', pg_temp.ok(e like 'return_amount_required%'), left(e, 60));
  e := pg_temp.try(format($q$select public.post_sale_return(%L, '2026-05-13', jsonb_build_array(jsonb_build_object('sale_line_id', %L, 'qty', 1)))$q$, sale1, line2));
  perform pg_temp.rec('HKD-return-service-no-restock', 'control', pg_temp.ok(e like 'return_qty_invalid%'), 'dòng dịch vụ không có hàng để nhập lại: ' || left(e, 50));
  e := pg_temp.try(format($q$select public.post_sale_return(%L, '2026-05-09', jsonb_build_array(jsonb_build_object('sale_line_id', %L, 'qty', 1)))$q$, sale1, line1));
  perform pg_temp.rec('HKD-return-before-sale', 'control', pg_temp.ok(e = 'return_before_sale'), e);
  e := pg_temp.try(format($q$select public.post_sale_return(%L, '2026-05-13', jsonb_build_array(jsonb_build_object('sale_line_id', %L, 'qty', 1)))$q$, sale_w, line1));
  perform pg_temp.rec('HKD-return-wrong-sale-line', 'control', pg_temp.ok(e like 'sale_line_not_found%'), 'dòng của hóa đơn khác: ' || left(e, 40));
  -- giảm giá hàng bán dịch vụ (qty 0)
  r3 := public.post_sale_return(sale1, '2026-05-14', jsonb_build_array(jsonb_build_object('sale_line_id', line2, 'qty', 0, 'amount', 100000)), null, 'Giảm giá sau bán');
  reset role;
  perform pg_temp.rec('HKD-return-price-discount', 'control', pg_temp.ok((r3->>'cogs')::numeric = 0 and (r3->>'refunded')::numeric = 100000 and pg_temp.bal('521') = 1500000 + 1500000 + 100000),
    'giảm giá 100.000 (qty 0): không nhập kho, hoàn tiền mặt');
  -- trả nốt: phần còn lại của dòng 1 (2 cái) = 3.000.000 chính xác, không lệch
  perform pg_temp.act_as('authenticated', u);
  perform public.post_sale_return(sale1, '2026-05-15', jsonb_build_array(jsonb_build_object('sale_line_id', line1, 'qty', 2)));
  reset role;
  perform pg_temp.rec('HKD-return-all', 'control', pg_temp.ok((select sum(rl.amount) = 6000000 and sum(rl.cost) = 4000000 and sum(rl.qty) = 4 from public.sales_return_lines rl join public.sales_returns r on r.id = rl.return_id where rl.sale_line_id = line1 and r.voided_at is null)
      and (select stock_qty from public.products where id = p) = 10), 'trả đủ 4 cái: tổng tiền 6.000.000, giá vốn 4.000.000, kho về 10');
  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try(format($q$select public.reverse_sales_invoice(%L, '2026-05-16', 'x')$q$, sale1));
  perform pg_temp.rec('HKD-void-blocked-by-returns', 'control', pg_temp.ok(e = 'invoice_has_returns'), e);
  reset role;
  -- trả hàng bán cho khách lẻ: không áp công nợ
  select id into big from public.sales_invoice_lines where invoice_id = sale_w limit 1;
  perform pg_temp.act_as('authenticated', u);
  r1 := public.post_sale_return(sale_w, '2026-05-12', jsonb_build_array(jsonb_build_object('sale_line_id', big, 'qty', 1)));
  reset role;
  perform pg_temp.rec('HKD-return-walkin', 'control', pg_temp.ok((r1->>'applied_to_debt')::numeric = 0 and (r1->>'refunded')::numeric = 300000), 'trả hàng khách lẻ: hoàn tiền, không trừ công nợ');
  -- hủy phiếu trả
  select stock_qty into q2 from public.products where id = p2;
  perform pg_temp.act_as('authenticated', u);
  perform public.reverse_sales_return((r1->>'return_id')::uuid, '2026-05-12', 'nhập nhầm');
  e := pg_temp.try(format($q$select public.reverse_sales_return(%L)$q$, (r1->>'return_id')::uuid));
  reset role;
  perform pg_temp.rec('HKD-return-reverse', 'control', pg_temp.ok(e = 'already_voided' and (select voided_at is not null from public.sales_returns where id = (r1->>'return_id')::uuid)
      and not exists (select 1 from public.v_revenue_events where doc_id = (r1->>'return_id')::uuid) and (select stock_qty from public.products where id = p2) = q2 - 1), format('hủy phiếu trả: %s; kho p2=%s', e, (select stock_qty from public.products where id = p2)));
  e := pg_temp.try(format($q$update public.sales_returns set total = 1 where id = %L$q$, (r1->>'return_id')::uuid));
  perform pg_temp.rec('HKD-return-immutable', 'control', pg_temp.ok(e like '%immutable%'), left(e, 70));
  -- hóa đơn VAT cũ không hỗ trợ trả hàng tự động
  perform pg_temp.act_as('authenticated', u);
  legacy := public.post_sales_invoice(c, '2026-05-20', '2026-06-20', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1, 'unit_price', 1000000, 'vat_rate', 10)));
  e := pg_temp.try(format($q$select public.post_sale_return(%L, '2026-05-21', jsonb_build_array(jsonb_build_object('sale_line_id', (select id from public.sales_invoice_lines where invoice_id = %L limit 1), 'qty', 1)))$q$, (legacy->>'invoice_id')::uuid, (legacy->>'invoice_id')::uuid));
  reset role;
  perform pg_temp.rec('HKD-return-legacy-vat', 'control', pg_temp.ok(e = 'return_unsupported_vat_invoice'), 'hóa đơn cũ có VAT: ' || e);

  -- ---------------------------------------------------------------- hủy toàn bộ đơn HKD không trả hàng/HĐĐT
  perform pg_temp.act_as('authenticated', u);
  j := public.post_sale_hkd(c, '2026-05-22', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 2, 'unit_price', 1500000)), jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000000)));
  select stock_qty into q from public.products where id = p;
  perform public.reverse_sales_invoice((j->>'invoice_id')::uuid, '2026-05-22', 'nhập nhầm');
  reset role;
  perform pg_temp.rec('HKD-void-whole-sale', 'control', pg_temp.ok((select stock_qty from public.products where id = p) = q + 2 and not exists (select 1 from public.v_sales_invoice_open where invoice_id = (j->>'invoice_id')::uuid) and pg_temp.recon_ok()),
    'hủy đơn HKD: bút toán đảo, kho hoàn, đối chiếu khớp');

  -- ---------------------------------------------------------------- báo cáo: doanh thu = 511 − 521, khớp ngưỡng/nhóm ngành
  select pg_temp.bal('511') - pg_temp.bal('521') + pg_temp.bal('3331') into rev;   -- hóa đơn VAT cũ tính theo tổng gồm thuế
  select coalesce(sum(revenue), 0) into tg from public.revenue_by_tax_group(2026);
  perform pg_temp.act_as('authenticated', u);
  perform pg_temp.rec('HKD-revenue-net-of-returns', 'control', pg_temp.ok(public.revenue_ytd(2026) = rev and tg = rev
      and (select revenue from public.report_monthly_pnl('2026-05-01', '2026-05-31')) = rev - pg_temp.bal('3331')
      and (select revenue from public.revenue_by_tax_group(2026) where tax_group = 'service') = 400000),
    format('doanh thu ròng 511−521(+VAT hóa đơn cũ) = %s; revenue_ytd=%s; theo nhóm=%s; P&L tháng 5 khớp', rev, public.revenue_ytd(2026), tg));
  perform pg_temp.rec('HKD-top-products-net', 'control', pg_temp.ok((select qty from public.report_top_products('2026-05-01', '2026-05-31', 10) where product_id = p) = 1
      and (select count(*) from public.report_top_customers('2026-05-01', '2026-05-31', 10) where name = 'Khách lẻ') = 1),
    'top sản phẩm trừ hàng trả lại (p: bán 4+1 VAT−4 trả = 1)');
  reset role;
  -- điều chỉnh kho không ghi nhận lại phiếu trả hàng
  perform pg_temp.act_as('authenticated', u);
  j := public.post_stock_adjustments('2026-05-31');
  reset role;
  perform pg_temp.rec('HKD-stock-adjust-skips-returns', 'control', pg_temp.ok((j->>'posted')::int = 0 and pg_temp.bal('711') = 0 and pg_temp.recon_ok()), 'post_stock_adjustments không ghi 711 cho phiếu nhập từ trả hàng: ' || j::text);

  -- ---------------------------------------------------------------- quyền
  perform pg_temp.act_as('authenticated', nobody);
  e := pg_temp.try(format($q$select public.post_sale_hkd(null, '2026-05-11', jsonb_build_array(jsonb_build_object('product_id', %L, 'qty', 1, 'unit_price', 1000)), jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000)))$q$, p2));
  perform pg_temp.rec('HKD-sale-non-staff', 'control', pg_temp.ok(e = 'forbidden'), e);
  e := pg_temp.try(format($q$select public.post_sale_return(%L, '2026-05-12', '[]'::jsonb)$q$, sale1));
  perform pg_temp.rec('HKD-return-non-staff', 'control', pg_temp.ok(e = 'forbidden'), e);
  e := pg_temp.try(format($q$select public.record_sale_einvoice(%L, '{"number":"5"}'::jsonb)$q$, sale1));
  perform pg_temp.rec('HKD-einvoice-non-staff', 'control', pg_temp.ok(e = 'forbidden'), e);
  select count(*) into n from public.einvoices; select count(*) into n0 from public.sale_payments;
  perform pg_temp.rec('HKD-new-tables-rls-non-staff', 'control', pg_temp.ok(n = 0 and n0 = 0), 'non-staff không đọc được einvoices/sale_payments');
  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try($q$insert into public.sales_returns(return_no, sale_id, return_date, total, entry_id) select 'X', id, current_date, 1, entry_id from public.sales_invoices limit 1$q$);
  perform pg_temp.rec('HKD-new-tables-no-direct-dml', 'control', pg_temp.ok(e like 'permission denied%'), 'INSERT trực tiếp: ' || e);
  e := pg_temp.try($q$update public.einvoices set status = 'cancelled'$q$);
  perform pg_temp.rec('HKD-einvoice-no-direct-update', 'control', pg_temp.ok(e like 'permission denied%'), e);
  select count(*) into n from public.einvoices;
  perform pg_temp.rec('HKD-new-tables-staff-read', 'control', pg_temp.ok(n > 0), 'staff đọc được einvoices');
  perform pg_temp.act_as('anon');
  e := pg_temp.try($q$select public.post_sale_hkd(null, '2026-05-11', '[]'::jsonb)$q$);
  perform pg_temp.rec('HKD-sale-anon', 'control', pg_temp.ok(e like 'permission denied%'), e);
  e := pg_temp.try('select count(*) from public.einvoices');
  perform pg_temp.rec('HKD-einvoice-anon-table', 'control', pg_temp.ok(e like 'permission denied%'), e);
  reset role;
  e := pg_temp.try(format($q$update public.sale_payments set amount = 1 where sale_id = %L$q$, sale1));
  perform pg_temp.rec('HKD-sale-payments-immutable', 'control', pg_temp.ok(e like '%immutable%'), left(e, 70));

  -- vệ sinh
  select count(*) into n from pg_proc p join pg_namespace s2 on s2.oid = p.pronamespace
   where s2.nspname = 'public' and p.proname in ('post_sale_hkd','post_sale_return','reverse_sales_return','record_sale_einvoice','cancel_sale_einvoice','trg_customers_walkin_guard','trg_sales_invoices_walkin_paid','_sale_buyer','_tax_rate_for','revenue_by_tax_group')
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%');
  perform pg_temp.rec('HKD-a2-fns-search-path', 'control', pg_temp.ok(n = 0), format('%s hàm 0013 thiếu search_path', n));
  perform pg_temp.rec('HKD-a2-trigger-fns-not-exposed', 'control', pg_temp.ok(not has_function_privilege('anon', 'public.trg_customers_walkin_guard()', 'execute') and not has_function_privilege('authenticated', 'public.trg_sales_invoices_walkin_paid()', 'execute')
      and not has_function_privilege('authenticated', 'public._sale_buyer(jsonb)', 'execute')), 'hàm trigger/helper không gọi được qua RPC');
  perform pg_temp.rec('HKD-a2-rls-enabled', 'control', pg_temp.ok((select count(*) from pg_class c join pg_namespace s3 on s3.oid = c.relnamespace where s3.nspname = 'public' and c.relname in ('sales_returns','sales_return_lines','sale_payments','einvoices') and c.relrowsecurity) = 4),
    '4 bảng mới bật RLS');
  perform pg_temp.rec('HKD-a2-no-auth-uid-bare', 'control', pg_temp.ok((select count(*) from pg_policies where schemaname = 'public' and tablename in ('sales_returns','sales_return_lines','sale_payments','einvoices') and qual ~* 'auth\.uid\(\)' and qual !~* 'select auth\.uid\(\)') = 0), 'policy không gọi auth.uid() trần');
end $$;
select current_setting('harness.out', true);
rollback;
