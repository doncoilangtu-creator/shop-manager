-- 0015 (A4): tiền theo từng tài khoản (tiền mặt / ngân hàng / ví), thu-chi-bán-trả hàng gắn tài khoản, chuyển nội bộ, đối chiếu 111+112 (rolled back)
\ir ../_lib.sql
begin;
create or replace function pg_temp.recon_ok() returns boolean language sql as $f$
  select coalesce(bool_and(diff = 0), false) from public.accounting_reconciliation() $f$;
create or replace function pg_temp.mb(p_id uuid) returns numeric language sql as $f$
  select balance from public.money_balances() where account_id is not distinct from p_id $f$;
create or replace function pg_temp.mb_un(p_gl text) returns numeric language sql as $f$
  select balance from public.money_balances() where unassigned and gl_account = p_gl $f$;
do $$
declare
  u uuid := pg_temp.mk_staff('owner'); u2 uuid := pg_temp.mk_staff('staff'); nobody uuid;
  c uuid := pg_temp.mk_customer(); s uuid := pg_temp.mk_supplier(); p uuid := pg_temp.mk_product(0, 0);
  cash uuid; bank uuid; mb uuid; momo uuid; bank2 uuid; r jsonb; j jsonb; e text; n int; x numeric; t jsonb; t2 jsonb; rc jsonb; ret jsonb; sale uuid; line1 uuid; pid uuid; b0 numeric;
begin
  insert into auth.users(id, email) values (gen_random_uuid(), 'nobody33@test.local') returning id into nobody;
  select id into cash from public.money_accounts where is_default and gl_account = '111';
  perform pg_temp.rec('MNY-seed-cash', 'control', pg_temp.ok(cash is not null and (select kind from public.money_accounts where id = cash) = 'cash' and (select count(*) from public.money_accounts) = 1), 'có đúng 1 tài khoản mặc định "Tiền mặt" (TK 111)');
  perform pg_temp.rec('MNY-unassigned-bank-row', 'control', pg_temp.ok(pg_temp.mb_un('112') = 0 and pg_temp.mb_un('111') is null), 'chưa có NH mặc định -> có hàng "chưa gán" cho TK 112; TK 111 đã có mặc định nên không có hàng này');

  -- ------------------------------------------------------------ quản lý tài khoản (owner only)
  perform pg_temp.act_as('authenticated', u2);
  e := pg_temp.try($q$select public.upsert_money_account(null, '{"kind":"bank","label":"MB","provider":"MB Bank"}'::jsonb)$q$);
  perform pg_temp.rec('MNY-staff-cannot-manage', 'control', pg_temp.ok(e = 'forbidden'), 'staff tạo tài khoản: ' || e);
  e := pg_temp.try(format($q$select public.post_money_opening(%L, 1000, '2026-07-01')$q$, cash));
  perform pg_temp.rec('MNY-staff-cannot-open', 'control', pg_temp.ok(e = 'forbidden'), 'staff nhập số dư đầu kỳ: ' || e);
  perform pg_temp.act_as('authenticated', u);
  r := public.upsert_money_account(null, '{"kind":"bank","label":"MB Bank chính","provider":"MB Bank","account_no":"0123 4567 89","holder":"Nguyễn Văn A","tax_notified":true,"tax_notified_at":"2026-01-15"}'::jsonb);
  bank := (r->>'id')::uuid;
  momo := (public.upsert_money_account(null, '{"kind":"ewallet","label":"Ví MoMo","provider":"MoMo"}'::jsonb)->>'id')::uuid;
  bank2 := (public.upsert_money_account(null, '{"kind":"bank","label":"Vietcombank phụ","provider":"Vietcombank","account_no":"9990001234"}'::jsonb)->>'id')::uuid;
  reset role;
  perform pg_temp.rec('MNY-create-masked', 'control', pg_temp.ok((select account_no_masked from public.money_accounts where id = bank) = '****6789' and (select gl_account from public.money_accounts where id = bank) = '112'
      and (select gl_account from public.money_accounts where id = momo) = '112' and (select tax_notified from public.money_accounts where id = bank)
      and not exists (select 1 from public.money_accounts where account_no_masked like '%0123%' or account_no_masked like '%4567%')), 'số tài khoản chỉ lưu dạng che ****6789; ví điện tử gắn TK 112; cờ đã thông báo thuế lưu được');
  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try($q$select public.upsert_money_account(null, '{"kind":"bank","label":"mb bank chính"}'::jsonb)$q$);
  perform pg_temp.rec('MNY-label-unique', 'control', pg_temp.ok(e = 'money_account_label_duplicate'), 'trùng tên (không phân biệt hoa thường): ' || e);
  e := pg_temp.try(format($q$select public.upsert_money_account(%L, '{"kind":"cash"}'::jsonb)$q$, bank));
  perform pg_temp.rec('MNY-kind-immutable', 'control', pg_temp.ok(e = 'money_account_kind_immutable'), e);
  e := pg_temp.try($q$select public.upsert_money_account(null, '{"kind":"crypto","label":"x"}'::jsonb)$q$);
  perform pg_temp.rec('MNY-kind-invalid', 'control', pg_temp.ok(e = 'money_account_kind_invalid'), e);
  e := pg_temp.try($q$select public.upsert_money_account(null, '{"kind":"bank","label":"Sai số","account_no":"12"}'::jsonb)$q$);
  perform pg_temp.rec('MNY-accno-invalid', 'control', pg_temp.ok(e = 'money_account_no_invalid'), e);
  r := public.upsert_money_account(null, '{"kind":"cash","label":"Quỹ cửa hàng 2","tax_notified":true}'::jsonb);
  reset role;
  perform pg_temp.rec('MNY-cash-never-notified', 'control', pg_temp.ok(not (select tax_notified from public.money_accounts where id = (r->>'id')::uuid)), 'tiền mặt không có khái niệm đã thông báo thuế');

  -- ------------------------------------------------------------ số dư đầu kỳ
  perform pg_temp.act_as('authenticated', u);
  perform public.post_money_opening(cash, 5000000, '2026-07-01');
  perform public.post_money_opening(bank, 10000000, '2026-07-01', 'Số dư đầu kỳ MB');
  perform public.post_money_opening(momo, 500000, '2026-07-01');
  e := pg_temp.try(format($q$select public.post_money_opening(%L, 0, '2026-07-01')$q$, cash));
  perform pg_temp.rec('MNY-opening-amount', 'control', pg_temp.ok(e = 'amount_invalid'), e);
  reset role;
  perform pg_temp.rec('MNY-opening-balances', 'control', pg_temp.ok(pg_temp.mb(cash) = 5000000 and pg_temp.mb(bank) = 10000000 and pg_temp.mb(momo) = 500000 and pg_temp.mb(bank2) = 0
      and pg_temp.bal('111') = 5000000 and pg_temp.bal('112') = 10500000 and pg_temp.bal('411') = 15500000), format('cash %s bank %s momo %s', pg_temp.mb(cash), pg_temp.mb(bank), pg_temp.mb(momo)));
  perform pg_temp.rec('MNY-recon-opening', 'control', pg_temp.ok(pg_temp.recon_ok()), 'đối chiếu 111+112 = tổng các tài khoản');

  -- ------------------------------------------------------------ bán hàng: nhiều tài khoản cho một đơn
  perform pg_temp.act_as('authenticated', u);
  perform public.post_purchase_bill(s, '2026-07-02', null, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 10, 'unit_cost', 100000)));
  j := public.post_sale_hkd(c, '2026-07-05', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 3, 'unit_price', 1000000)),
        jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000000), jsonb_build_object('money_account_id', bank, 'amount', 1200000),
                          jsonb_build_object('money_account_id', momo, 'amount', 300000), jsonb_build_object('money_account_id', bank, 'amount', 100000)));
  reset role;
  sale := (j->>'invoice_id')::uuid;
  perform pg_temp.rec('MNY-sale-split', 'control', pg_temp.ok((j->>'paid')::numeric = 2600000 and (j->>'debt')::numeric = 400000
      and pg_temp.mb(cash) = 6000000 and pg_temp.mb(bank) = 11300000 and pg_temp.mb(momo) = 800000 and pg_temp.bal('131') = 400000),
    format('cash %s bank %s momo %s AR %s', pg_temp.mb(cash), pg_temp.mb(bank), pg_temp.mb(momo), pg_temp.bal('131')));
  perform pg_temp.rec('MNY-sale-lines-grouped', 'control', pg_temp.ok((select count(*) from public.journal_lines where entry_id = (j->>'entry_id')::uuid and account_code = '112' and money_account_id = bank) = 1
      and (select debit from public.journal_lines where entry_id = (j->>'entry_id')::uuid and money_account_id = bank) = 1300000), 'hai khoản cùng tài khoản gộp thành 1 dòng Nợ 112 = 1.300.000');
  perform pg_temp.rec('MNY-sale-payments-rows', 'control', pg_temp.ok((select count(*) from public.sale_payments where sale_id = sale and money_account_id is not null) = 4
      and (select method from public.sale_payments where sale_id = sale and money_account_id = momo) = 'bank' and (select money_account_id from public.sale_payments where sale_id = sale and method = 'cash') = cash),
    'sale_payments lưu tài khoản; ví điện tử có method bank; tiền mặt không chọn -> tài khoản mặc định');
  perform pg_temp.rec('MNY-recon-sale', 'control', pg_temp.ok(pg_temp.recon_ok()), 'đối chiếu sau bán hàng nhiều tài khoản');

  -- lỗi tài khoản
  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try(format($q$select public.post_sale_hkd(%L, '2026-07-06', jsonb_build_array(jsonb_build_object('product_id', %L, 'qty', 1, 'unit_price', 100000)), jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 100000, 'money_account_id', %L)))$q$, c, p, bank));
  perform pg_temp.rec('MNY-mismatch-method', 'control', pg_temp.ok(e like 'money_account_mismatch%'), 'tiền mặt nhưng chọn tài khoản NH: ' || e);
  e := pg_temp.try(format($q$select public.post_sale_hkd(%L, '2026-07-06', jsonb_build_array(jsonb_build_object('product_id', %L, 'qty', 1, 'unit_price', 100000)), jsonb_build_array(jsonb_build_object('method', 'bank', 'amount', 100000, 'money_account_id', %L)))$q$, c, p, gen_random_uuid()));
  perform pg_temp.rec('MNY-unknown-account', 'control', pg_temp.ok(e = 'money_account_not_found'), e);
  e := pg_temp.try(format($q$select public.post_sale_hkd(%L, '2026-07-06', jsonb_build_array(jsonb_build_object('product_id', %L, 'qty', 1, 'unit_price', 100000)), jsonb_build_array(jsonb_build_object('method', 'zzz', 'amount', 100000)))$q$, c, p));
  perform pg_temp.rec('MNY-method-invalid', 'control', pg_temp.ok(e = 'method_invalid'), e);
  reset role;
  perform pg_temp.rec('MNY-failed-sale-no-trace', 'control', pg_temp.ok(pg_temp.mb(bank) = 11300000 and (select stock_qty from public.products where id = p) = 7), 'đơn lỗi không để lại số dư/tồn kho');

  -- bán qua NH nhưng không chọn tài khoản: chưa có NH mặc định -> "chưa gán"; có NH mặc định -> vào mặc định
  perform pg_temp.act_as('authenticated', u);
  j := public.post_sale_hkd(null, '2026-07-07', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1, 'unit_price', 500000)), jsonb_build_array(jsonb_build_object('method', 'bank', 'amount', 500000)));
  reset role;
  perform pg_temp.rec('MNY-bank-no-account-unassigned', 'control', pg_temp.ok(pg_temp.mb_un('112') = 500000 and pg_temp.recon_ok()), format('NH không chọn tài khoản & chưa có mặc định -> chưa gán = %s', pg_temp.mb_un('112')));
  perform pg_temp.act_as('authenticated', u);
  perform public.upsert_money_account(bank, '{"is_default": true}'::jsonb);
  perform public.upsert_money_account(bank2, '{"is_default": true}'::jsonb);
  perform public.upsert_money_account(bank, '{"is_default": true}'::jsonb);
  j := public.post_sale_hkd(null, '2026-07-08', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1, 'unit_price', 400000)), jsonb_build_array(jsonb_build_object('method', 'bank', 'amount', 400000)));
  reset role;
  perform pg_temp.rec('MNY-default-switch', 'control', pg_temp.ok((select count(*) from public.money_accounts where is_default and gl_account = '112') = 1 and (select is_default from public.money_accounts where id = bank)
      and (select money_account_id from public.sale_payments where sale_id = (j->>'invoice_id')::uuid) = bank), 'chỉ 1 mặc định/TK; thanh toán NH không chọn -> tài khoản mặc định');
  perform pg_temp.rec('MNY-default-absorbs-legacy', 'control', pg_temp.ok(pg_temp.mb_un('112') is null and pg_temp.mb(bank) = 11300000 + 500000 + 400000 and pg_temp.recon_ok()),
    format('có NH mặc định -> dòng 112 chưa gắn (500.000) gom vào mặc định: %s', pg_temp.mb(bank)));

  -- ------------------------------------------------------------ thu / chi gắn tài khoản
  perform pg_temp.act_as('authenticated', u);
  rc := public.post_receipt(c, 400000, 'bank', '2026-07-09', '[]'::jsonb, 'thu nợ', momo);
  perform pg_temp.rec('MNY-receipt-account', 'control', pg_temp.ok((rc->>'money_account_id')::uuid = momo and (select money_account_id from public.payments where id = (rc->>'payment_id')::uuid) = momo), 'phiếu thu lưu tài khoản');
  e := pg_temp.try(format($q$select public.post_receipt(%L, 100, 'cash', '2026-07-09', '[]'::jsonb, null, %L)$q$, c, momo));
  perform pg_temp.rec('MNY-receipt-mismatch', 'control', pg_temp.ok(e like 'money_account_mismatch%'), e);
  reset role;
  perform pg_temp.rec('MNY-receipt-balance', 'control', pg_temp.ok(pg_temp.mb(momo) = 800000 + 400000 and pg_temp.bal('131') = 0), 'ví MoMo +400.000, công nợ 0');
  perform pg_temp.act_as('authenticated', u);
  r := public.post_disbursement(s, 200000, 'cash', '2026-07-10', '[]'::jsonb, 'trả NCC');
  t := public.post_disbursement_fifo(s, 300000, 'bank', '2026-07-10', 'trả NCC FIFO', bank2);
  reset role;
  perform pg_temp.rec('MNY-disbursement-account', 'control', pg_temp.ok((select money_account_id from public.payments where id = (r->>'payment_id')::uuid) = cash and (select money_account_id from public.payments where id = (t->>'payment_id')::uuid) = bank2
      and pg_temp.mb(cash) = 6000000 - 200000 and pg_temp.mb(bank2) = -300000), 'chi tiền mặt -> quỹ mặc định; chi FIFO chỉ định NH phụ (âm số dư vì chưa nhập đầu kỳ — cảnh báo ở UI)');
  perform pg_temp.act_as('authenticated', u);
  perform public.reverse_payment((t->>'payment_id')::uuid, '2026-07-11', 'nhầm');
  reset role;
  perform pg_temp.rec('MNY-reverse-payment', 'control', pg_temp.ok(pg_temp.mb(bank2) = 0 and pg_temp.recon_ok()), 'hủy phiếu chi trả lại số dư tài khoản (bút toán đảo giữ tài khoản)');

  -- ------------------------------------------------------------ trả hàng hoàn tiền theo tài khoản
  select id into line1 from public.sales_invoice_lines where invoice_id = sale limit 1;
  perform pg_temp.act_as('authenticated', u);
  ret := public.post_sale_return(sale, '2026-07-12', jsonb_build_array(jsonb_build_object('sale_line_id', line1, 'qty', 1)), null, 'khách trả', 'bank', momo);
  reset role;
  -- đơn gốc còn nợ 400.000 -> trừ công nợ trước, phần còn lại 600.000 hoàn vào ví MoMo
  perform pg_temp.rec('MNY-return-refund-account', 'control', pg_temp.ok((ret->>'applied_to_debt')::numeric = 400000 and (ret->>'refunded')::numeric = 600000
      and (select money_account_id from public.sale_payments where return_id = (ret->>'return_id')::uuid) = momo and pg_temp.mb(momo) = 1200000 - 600000 and pg_temp.recon_ok()),
    format('hoàn 600.000 qua ví MoMo: %s', pg_temp.mb(momo)));
  perform pg_temp.act_as('authenticated', u);
  perform public.reverse_sales_return((ret->>'return_id')::uuid, '2026-07-13', 'nhầm');
  reset role;
  perform pg_temp.rec('MNY-return-reverse', 'control', pg_temp.ok(pg_temp.mb(momo) = 1200000 and pg_temp.recon_ok()), 'hủy phiếu trả hàng khôi phục số dư ví');
  perform pg_temp.act_as('authenticated', u);
  ret := public.post_sale_return(sale, '2026-07-14', jsonb_build_array(jsonb_build_object('sale_line_id', line1, 'qty', 1)),
          jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 100000), jsonb_build_object('money_account_id', bank, 'amount', 500000)), 'chia hoàn tiền');
  reset role;
  perform pg_temp.rec('MNY-return-split-refund', 'control', pg_temp.ok((select count(*) from public.sale_payments where return_id = (ret->>'return_id')::uuid and money_account_id is not null) = 2 and pg_temp.recon_ok()), 'hoàn tiền chia tiền mặt + NH');
  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try(format($q$select public.post_sale_return(%L, '2026-07-15', jsonb_build_array(jsonb_build_object('sale_line_id', %L, 'qty', 1)), jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1)))$q$, sale, line1));
  perform pg_temp.rec('MNY-return-refund-mismatch', 'control', pg_temp.ok(e like 'refund_mismatch%'), e);
  reset role;

  -- ------------------------------------------------------------ hủy đơn bán: bút toán đảo trả lại tài khoản
  perform pg_temp.act_as('authenticated', u);
  j := public.post_sale_hkd(null, '2026-07-16', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1, 'unit_price', 250000)), jsonb_build_array(jsonb_build_object('money_account_id', momo, 'amount', 250000)));
  reset role;
  b0 := pg_temp.mb(momo);
  perform pg_temp.act_as('authenticated', u);
  perform public.reverse_sales_invoice((j->>'invoice_id')::uuid, '2026-07-17', 'nhập sai');
  reset role;
  perform pg_temp.rec('MNY-void-sale', 'control', pg_temp.ok(pg_temp.mb(momo) = b0 - 250000 and pg_temp.recon_ok()), 'hủy đơn: ví giảm đúng phần đã thu');

  -- ------------------------------------------------------------ chuyển tiền nội bộ
  perform pg_temp.act_as('authenticated', u);
  x := pg_temp.mb(cash) + pg_temp.mb(bank);
  t := public.post_money_transfer(bank, cash, 2000000, '2026-07-18', 'rút tiền về quỹ');
  e := pg_temp.try(format($q$select public.post_money_transfer(%L, %L, 1, '2026-07-18')$q$, bank, bank));
  perform pg_temp.rec('MNY-transfer-same', 'control', pg_temp.ok(e = 'transfer_same_account'), e);
  e := pg_temp.try(format($q$select public.post_money_transfer(%L, %L, 0, '2026-07-18')$q$, bank, cash));
  perform pg_temp.rec('MNY-transfer-amount', 'control', pg_temp.ok(e = 'amount_invalid'), e);
  reset role;
  perform pg_temp.rec('MNY-transfer-total-invariant', 'control', pg_temp.ok(pg_temp.mb(cash) + pg_temp.mb(bank) = x and (select balance from public.money_balances() where account_id = cash) = (x - pg_temp.mb(bank))), 'tổng quỹ + MB không đổi sau chuyển; hai tài khoản đổi ngược chiều');
  e := pg_temp.try(format($q$update public.money_transfers set amount = 1 where id = %L$q$, (t->>'transfer_id')::uuid));
  perform pg_temp.rec('MNY-transfer-immutable', 'control', pg_temp.ok(e like '%immutable%'), left(e, 60));
  perform pg_temp.act_as('authenticated', u);
  perform public.reverse_money_transfer((t->>'transfer_id')::uuid, '2026-07-19', 'nhầm');
  e := pg_temp.try(format($q$select public.reverse_money_transfer(%L)$q$, (t->>'transfer_id')::uuid));
  perform pg_temp.rec('MNY-transfer-reverse-once', 'control', pg_temp.ok(e = 'already_voided'), e);
  reset role;
  perform pg_temp.rec('MNY-transfer-reversed', 'control', pg_temp.ok(pg_temp.mb(cash) + pg_temp.mb(bank) = x and pg_temp.recon_ok()), 'hủy chuyển tiền trả lại số dư');
  perform pg_temp.act_as('authenticated', u2);
  t2 := public.post_money_transfer(cash, momo, 50000, '2026-07-20');
  reset role;
  perform pg_temp.rec('MNY-transfer-staff-ok', 'control', pg_temp.ok((t2->>'amount')::numeric = 50000), 'nhân viên được chuyển tiền nội bộ');

  -- ------------------------------------------------------------ sổ tiền
  select coalesce(max(running), 0), count(*) into x, n from (select running from public.money_book(bank) order by entry_date desc, entry_no desc limit 1) z;
  perform pg_temp.rec('MNY-book-running', 'control', pg_temp.ok((select running from public.money_book(bank) order by entry_date desc, entry_no desc, debit desc limit 1) is not null
      and (select sum(debit - credit) from public.money_book(bank)) = pg_temp.mb(bank)), 'sổ tiền: tổng phát sinh = số dư; có số dư lũy kế');
  perform pg_temp.rec('MNY-book-range', 'control', pg_temp.ok((select count(*) from public.money_book(bank, '2026-07-05', '2026-07-05')) = 1), 'lọc theo khoảng ngày');

  -- ------------------------------------------------------------ tắt tài khoản
  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try(format($q$select public.upsert_money_account(%L, '{"active": false}'::jsonb)$q$, bank));
  perform pg_temp.rec('MNY-deactivate-default', 'control', pg_temp.ok(e = 'money_account_is_default'), 'tài khoản mặc định: ' || e);
  e := pg_temp.try(format($q$select public.upsert_money_account(%L, '{"active": false}'::jsonb)$q$, momo));
  perform pg_temp.rec('MNY-deactivate-with-balance', 'control', pg_temp.ok(e = 'money_account_has_balance'), e);
  perform public.upsert_money_account(bank2, '{"active": false}'::jsonb);
  e := pg_temp.try(format($q$select public.post_money_transfer(%L, %L, 1, '2026-07-21')$q$, cash, bank2));
  perform pg_temp.rec('MNY-inactive-blocked', 'control', pg_temp.ok(e = 'money_account_inactive'), 'tài khoản đã tắt không nhận giao dịch: ' || e);
  reset role;

  -- ------------------------------------------------------------ sổ cái trực tiếp & dòng cũ
  perform pg_temp.act_as('authenticated', u);
  e := pg_temp.try(format($q$select public.post_journal('2026-07-22', 'x', jsonb_build_array(jsonb_build_object('account', '111', 'debit', 10, 'money_account_id', %L), jsonb_build_object('account', '411', 'credit', 10)))$q$, bank));
  perform pg_temp.rec('MNY-journal-mismatch', 'control', pg_temp.ok(e like 'money_account_mismatch%'), 'dòng 111 gắn tài khoản NH: ' || e);
  e := pg_temp.try(format($q$select public.post_journal('2026-07-22', 'x', jsonb_build_array(jsonb_build_object('account', '511', 'credit', 10, 'money_account_id', %L), jsonb_build_object('account', '131', 'debit', 10, 'customer_id', %L)))$q$, bank, c));
  perform pg_temp.rec('MNY-journal-non-cash-account', 'control', pg_temp.ok(e like 'money_account_mismatch%'), 'dòng TK khác gắn tài khoản tiền: ' || e);
  b0 := (select balance from public.money_balances() where account_id = cash);
  perform public.post_journal('2026-07-22', 'dòng cũ không gắn tài khoản', jsonb_build_array(jsonb_build_object('account', '111', 'debit', 777), jsonb_build_object('account', '411', 'credit', 777)));
  reset role;
  perform pg_temp.rec('MNY-legacy-null-line', 'control', pg_temp.ok(pg_temp.mb(cash) = b0 + 777 and pg_temp.recon_ok()), 'dòng 111 không gắn tài khoản (kiểu cũ) vào tài khoản mặc định');

  -- ------------------------------------------------------------ bảo mật
  select count(*) into n from pg_proc p join pg_namespace s2 on s2.oid = p.pronamespace
   where s2.nspname = 'public' and p.proname in ('upsert_money_account','post_money_opening','post_money_transfer','reverse_money_transfer','money_balances','money_book','_money_balance','_resolve_money_account','_normalize_payments','_money_lines',
         'post_receipt','post_disbursement','post_receipt_fifo','post_disbursement_fifo','post_sale_return','post_sale_hkd','post_journal','reverse_journal','trg_jl_rules','trg_money_transfer_immutable','accounting_reconciliation')
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%');
  perform pg_temp.rec('MNY-fns-search-path', 'control', pg_temp.ok(n = 0), format('%s hàm 0015 thiếu search_path', n));
  perform pg_temp.rec('MNY-helpers-not-exposed', 'control', pg_temp.ok(not has_function_privilege('authenticated', 'public._normalize_payments(jsonb)', 'execute') and not has_function_privilege('authenticated', 'public._money_lines(text,jsonb,text)', 'execute')
      and not has_function_privilege('authenticated', 'public._resolve_money_account(uuid,text)', 'execute') and not has_function_privilege('authenticated', 'public._money_balance(uuid,date)', 'execute')
      and not has_function_privilege('anon', 'public.trg_money_transfer_immutable()', 'execute') and not has_function_privilege('authenticated', 'public.trg_money_transfer_immutable()', 'execute')
      and not has_function_privilege('authenticated', 'public.trg_jl_rules()', 'execute')), 'helper/trigger không gọi được qua RPC');
  perform pg_temp.rec('MNY-anon-denied', 'control', pg_temp.ok(not has_function_privilege('anon', 'public.upsert_money_account(uuid,jsonb)', 'execute') and not has_function_privilege('anon', 'public.money_balances(date)', 'execute')
      and not has_function_privilege('anon', 'public.post_money_transfer(uuid,uuid,numeric,date,text)', 'execute') and not has_function_privilege('anon', 'public.post_receipt(uuid,numeric,text,date,jsonb,text,uuid)', 'execute')), 'anon không gọi được RPC mới');
  perform pg_temp.rec('MNY-old-signatures-gone', 'control', pg_temp.ok(to_regprocedure('public.post_receipt(uuid,numeric,text,date,jsonb,text)') is null and to_regprocedure('public.post_sale_return(uuid,date,jsonb,jsonb,text,text)') is null
      and to_regprocedure('public.post_disbursement_fifo(uuid,numeric,text,date,text)') is null), 'không còn overload cũ gây mơ hồ cho PostgREST');
  perform pg_temp.rec('MNY-rls', 'control', pg_temp.ok((select count(*) from pg_class c join pg_namespace s3 on s3.oid = c.relnamespace where s3.nspname = 'public' and c.relname in ('money_accounts','money_transfers') and c.relrowsecurity) = 2
      and not exists (select 1 from pg_policies where tablename in ('money_accounts','money_transfers') and (qual ~ '(^|[^(])auth\.uid\(\)' or with_check ~ '(^|[^(])auth\.uid\(\)'))), '2 bảng mới bật RLS, không auth.uid() trần');
  perform pg_temp.act_as('authenticated', nobody);
  select count(*) into n from public.money_accounts;
  e := pg_temp.try($q$update public.money_accounts set label = 'hack'$q$);
  perform pg_temp.rec('MNY-nonstaff', 'control', pg_temp.ok(n = 0 and e like 'permission denied%'), format('user ngoài app thấy %s tài khoản; ghi trực tiếp: %s', n, e));
  perform pg_temp.act_as('anon');
  e := pg_temp.try($q$select count(*) from public.money_accounts$q$);
  reset role;
  perform pg_temp.rec('MNY-anon-table', 'control', pg_temp.ok(e like 'permission denied%'), 'anon đọc bảng: ' || e);
  perform pg_temp.rec('MNY-recon-final', 'control', pg_temp.ok(pg_temp.recon_ok() and exists (select 1 from public.accounting_reconciliation() where check_name like 'Cash/bank%')), 'đối chiếu cuối: có dòng Cash/bank và mọi chênh lệch = 0');
end $$;
select current_setting('harness.out');
rollback;
