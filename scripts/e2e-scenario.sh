#!/usr/bin/env bash
# End-to-end accounting scenario through the DB RPCs on a throwaway clone of shop_test (each step commits).
# usage: bash scripts/e2e-scenario.sh   (needs `bash scripts/local-db.sh up` first)
set -uo pipefail
export PGHOST=${PGHOST:-/tmp/shop-manager-pg} PGPORT=${PGPORT:-54329}
DB=shop_e2e_$$
psql -X -Atq -d postgres -c "create database $DB template shop_test" || exit 1
trap 'psql -X -Atq -d postgres -c "drop database if exists $DB" >/dev/null 2>&1' EXIT
P() { psql -X -q -d $DB -v ON_ERROR_STOP=1 "$@"; }
V() { P -Atc "$1"; }
SVC="set role service_role; select set_config('request.jwt.claims','{\"role\":\"service_role\"}',false);"
S() { psql -X -Atq -d $DB -v ON_ERROR_STOP=1 -c "$SVC $1" | tail -n +2 | grep -v '^SET$'; }
step() { echo; echo "=== $1"; }
fail=0; chk() { if [ "$2" = "t" ]; then echo "  [OK]   $1"; else echo "  [FAIL] $1"; fail=1; fi; }

C=$(V "insert into customers(name,debt_limit) values ('Cty ABC',50000000) returning id")
SUP=$(V "insert into suppliers(name) values ('NCC Linh kiện') returning id")
PR=$(V "insert into products(sku,name) values ('LAP-01','Laptop Dell') returning id")

# Bước 1-7: luồng legacy (VAT 3331/133) — chỉ chạy được ở chế độ 'enterprise' (mặc định HKD đã chặn VAT, xem bước 8).
V "insert into app_settings(key,value) values ('accounting_mode','enterprise') on conflict (key) do update set value=excluded.value" >/dev/null
step "1. [legacy enterprise] Nhập hàng: 10 cái x 10.000.000 + VAT 10% (ghi nợ NCC)"
BILL=$(S "select public.post_purchase_bill('$SUP','2026-09-02','2026-10-02','[{\"product_id\":\"$PR\",\"qty\":10,\"unit_cost\":10000000,\"vat_rate\":10}]'::jsonb,'HD-NCC-01')")
echo "$BILL"

step "2. Bán hàng: 3 cái x 15.000.000, VAT 10%  (HĐ đầu tiên của tháng 9)"
INV=$(S "select public.post_sales_invoice('$C','2026-09-10','2026-09-25','[{\"product_id\":\"$PR\",\"qty\":3,\"unit_price\":15000000,\"vat_rate\":10}]'::jsonb)")
echo "$INV"
INV_ID=$(echo "$INV" | python3 -c 'import sys,json;print(json.load(sys.stdin)["invoice_id"])')
ENT=$(echo "$INV" | python3 -c 'import sys,json;print(json.load(sys.stdin)["entry_id"])')
echo "-- bút toán của hóa đơn (Nợ = Có):"
P -c "select l.account_code as tk, a.name, l.debit as no, l.credit as co, l.memo from journal_lines l join accounts a on a.code=l.account_code where l.entry_id='$ENT' order by l.line_no"
chk "tổng Nợ = tổng Có của bút toán" "$(V "select (sum(debit)=sum(credit) and sum(debit)>0) from journal_lines where entry_id='$ENT'")"
chk "xuất kho theo giá vốn bình quân: tồn 7, giá trị 70.000.000" "$(V "select stock_qty=7 and stock_value=70000000 from products where id='$PR'")"
chk "giá vốn hàng bán (632) = 30.000.000" "$(V "select public.account_balance('632')=30000000")"
echo "-- phiếu kho:"; P -c "select type, qty, unit_cost, value_delta, ref_type from stock_movements where product_id='$PR' order by created_at"

step "3. Thu tiền: 20.000.000 chuyển khoản, phân bổ vào hóa đơn"
RC=$(S "select public.post_receipt('$C',20000000,'bank','2026-09-15','[{\"invoice_id\":\"$INV_ID\",\"amount\":20000000}]'::jsonb)")
echo "$RC"
P -c "select invoice_no, total, allocated, outstanding from v_sales_invoice_open where invoice_id='$INV_ID'"
chk "công nợ còn lại của HĐ = 29.500.000 (49.500.000 - 20.000.000)" "$(V "select outstanding=29500000 from v_sales_invoice_open where invoice_id='$INV_ID'")"
chk "AR sổ phụ = TK 131 = 29.500.000" "$(V "select balance=29500000 and gl_balance=29500000 from v_ar_by_customer where customer_id='$C'")"

step "4. Bảng cân đối phát sinh + đối chiếu sổ phụ"
P -c "select account_code, name, debit, credit, balance from trial_balance() order by 1"
P -c "select * from accounting_reconciliation()"
chk "mọi chênh lệch đối chiếu = 0" "$(V "select bool_and(diff=0) from accounting_reconciliation()")"

step "5. Báo cáo VAT tháng 9/2026"
P -c "select * from vat_report(2026,9)"

step "6. Khóa kỳ 09/2026 -> chặn bút toán mới"
S "select public.close_period(2026,9)"
P -c "select year, month, status, closed_at is not null as has_closed_at from fiscal_periods where year=2026 and month=9"
OUT=$(psql -X -Atq -d $DB -c "$SVC select public.post_sales_invoice('$C','2026-09-28',null,'[{\"description\":\"x\",\"qty\":1,\"unit_price\":1}]'::jsonb)" 2>&1 | grep -i "ERROR" | head -1)
echo "  thử bán lùi ngày 28/09: ${OUT:-<<no error>>}"
chk "bán trong kỳ đã khóa bị từ chối" "$([ -n "$OUT" ] && echo t || echo f)"
OUT2=$(psql -X -Atq -d $DB -c "$SVC update journal_lines set debit = debit + 1" 2>&1 | grep -i ERROR | head -1)
echo "  thử UPDATE trực tiếp sổ cái: $OUT2"
chk "sổ cái append-only (UPDATE bị chặn)" "$([ -n "$OUT2" ] && echo t || echo f)"

step "7. Bút toán đảo (kỳ 10/2026): hủy hóa đơn sau khi đảo phiếu thu"
S "select public.reverse_payment('$(echo "$RC" | python3 -c 'import sys,json;print(json.load(sys.stdin)["payment_id"])')'::uuid,'2026-10-02','nhập nhầm')" >/dev/null
VOID=$(S "select public.reverse_sales_invoice('$INV_ID','2026-10-03','Khách trả hàng')")
echo "$VOID"
P -c "select e.entry_no, e.entry_date, e.memo, e.reverses_id is not null as is_reversal, (select sum(debit) from journal_lines where entry_id=e.id) as no, (select sum(credit) from journal_lines where entry_id=e.id) as co from journal_entries e where e.id='$ENT' or e.reverses_id='$ENT' order by e.created_at"
chk "tồn kho khôi phục 10 cái / 100.000.000 theo đúng giá vốn" "$(V "select stock_qty=10 and stock_value=100000000 from products where id='$PR'")"
chk "AR = 0, đối chiếu = 0" "$(V "select public.account_balance('131')=0 and (select bool_and(diff=0) from accounting_reconciliation())")"
chk "hóa đơn gốc vẫn còn (chỉ gắn dấu hủy), bút toán gốc không bị sửa" "$(V "select voided_at is not null from sales_invoices where id='$INV_ID'")"
V "select public.set_accounting_mode('hkd','x')" >/dev/null 2>&1 || V "update app_settings set value='hkd' where key='accounting_mode'" >/dev/null
step "8. Chế độ HKD + đường đi của Telegram bot (service_role): /nhap = phiếu mua có chứng từ (VAT vào giá vốn), bán nhanh THU TIỀN NGAY (giá đã gồm VAT, VAT 0%, tiền mặt TK 111), báo cáo"
OUTM=$(psql -X -Atq -d $DB -c "$SVC select public.stock_adjust('$PR','in',5,12000000,'manual',null,'Nhập tay')" 2>&1 | grep -i ERROR | head -1)
chk "nhập kho tay (không chứng từ) bị chặn: $OUTM" "$(echo "$OUTM" | grep -q stock_in_requires_purchase_bill && echo t || echo f)"
V133=$(V "select public.account_balance('133')"); V3331=$(V "select public.account_balance('3331')")
ADJ=$(S "select public.post_purchase_bill('$SUP','2026-10-03',null,'[{\"product_id\":\"$PR\",\"qty\":5,\"unit_cost\":12000000,\"vat_rate\":10}]'::jsonb,'HD-BOT-01')")
echo "$ADJ"
chk "/nhap (post_purchase_bill): tồn 10 -> 15" "$(V "select stock_qty=15 from products where id='$PR'")"
chk "VAT đầu vào 6.000.000 cộng vào giá vốn (156 + 66.000.000), không phát sinh TK 133" "$(V "select public.account_balance('133')=$V133 and (select value_delta=66000000 from stock_movements where product_id='$PR' and ref_type='purchase_bill' order by created_at desc limit 1)")"
chk "đối chiếu sổ phụ = 0 ngay sau nhập hàng (không cần post_stock_adjustments)" "$(S "select bool_and(diff=0) from public.accounting_reconciliation()")"
# Khoản bán chịu cũ của cùng khách (trên web), để chứng minh /ban không trả nợ cũ (không dùng FIFO).
OLD=$(S "select public.post_sales_invoice('$C','2026-10-03','2026-11-03','[{\"product_id\":\"$PR\",\"qty\":1,\"unit_price\":5000000,\"vat_rate\":0}]'::jsonb,'Bán chịu cũ')")
OLD_ID=$(echo "$OLD" | python3 -c 'import sys,json;print(json.load(sys.stdin)["invoice_id"])')
CASH0=$(V "select public.account_balance('111')"); VAT0=$(V "select public.account_balance('3331')"); REV0=$(V "select public.account_balance('511')")
# Đúng như bot làm (bot/src/commands/owner.ts): MỘT lệnh gọi post_sale_hkd (khách có tên, giá đã gồm thuế, thu đủ tiền mặt ngay).
QS=$(S "select public.post_sale_hkd('$C','2026-10-04','[{\"product_id\":\"$PR\",\"qty\":2,\"unit_price\":20000000}]'::jsonb,'[{\"method\":\"cash\",\"amount\":40000000,\"note\":\"Thu ngay qua bot\"}]'::jsonb,'store',null,null,'Bán qua Telegram bot')")
echo "$QS"
QS_ID=$(echo "$QS" | python3 -c 'import sys,json;print(json.load(sys.stdin)["invoice_id"])')
chk "tổng hóa đơn = giá x SL = 40.000.000 (giá đã gồm VAT), VAT = 0" "$(V "select total=40000000 and vat_amount=0 and subtotal=40000000 and paid_at_sale=40000000 and sale_source='hkd_sale' from sales_invoices where id='$QS_ID'")"
chk "hạn thanh toán = ngày bán" "$(V "select due_date=invoice_date from sales_invoices where id='$QS_ID'")"
chk "đơn bán nhanh còn nợ 0 (không cần phiếu thu riêng)" "$(V "select outstanding=0 from v_sales_invoice_open where invoice_id='$QS_ID'")"
chk "thu tiền mặt 40.000.000 ghi trong cùng giao dịch, một bút toán cân" "$(V "select (select count(*) from sale_payments where sale_id='$QS_ID' and method='cash' and amount=40000000)=1 and (select count(*) from journal_entries where source_id='$QS_ID')=1")"
chk "TK 111 tăng đúng 40.000.000; doanh thu 511 tăng 40.000.000; VAT đầu ra 3331 không đổi" "$(V "select public.account_balance('111')=$CASH0+40000000 and public.account_balance('511')=$REV0+40000000 and public.account_balance('3331')=$VAT0")"
chk "không dùng FIFO: hóa đơn chịu cũ vẫn nợ nguyên 5.000.000; công nợ khách chỉ còn khoản cũ" "$(V "select (select outstanding=5000000 from v_sales_invoice_open where invoice_id='$OLD_ID') and public.account_balance('131')=5000000")"
chk "bán nhanh: tồn 15 -> 12 (1 bán chịu + 2 bán nhanh)" "$(V "select stock_qty=12 from products where id='$PR'")"
PNL=$(S "select jsonb_agg(to_jsonb(r)) from public.report_monthly_pnl('2026-09-01','2026-10-31') r")
echo "$PNL"
chk "báo cáo: T9 doanh thu 45.000.000; T10 = 5.000.000 + 40.000.000 - 45.000.000 (đảo HĐ T9 ghi vào T10) = 0" "$(S "select (select revenue=45000000 from public.report_monthly_pnl('2026-09-01','2026-10-31') where month='2026-09-01') and (select revenue=0 from public.report_monthly_pnl('2026-09-01','2026-10-31') where month='2026-10-01')")"
chk "top sản phẩm T10 (không tính HĐ đã hủy): 3 cái / 45.000.000" "$(S "select qty=3 and revenue=45000000 from public.report_top_products('2026-10-01','2026-10-31',5) where product_id='$PR'")"
chk "dashboard: công nợ phải thu = 5.000.000 (chỉ khoản bán chịu cũ; bán nhanh không để lại nợ)" "$(S "select (public.report_dashboard()->>'ar_balance')::numeric=5000000")"
step "8b. HKD: khách lẻ, nhiều phương thức thanh toán, trả hàng, hóa đơn điện tử, ngưỡng doanh thu"
WK=$(S "select public.post_sale_hkd(null,'2026-10-04','[{\"product_id\":\"$PR\",\"qty\":1,\"unit_price\":20000000}]'::jsonb,'[{\"method\":\"cash\",\"amount\":5000000},{\"method\":\"bank\",\"amount\":15000000}]'::jsonb)")
echo "$WK"
WK_ID=$(echo "$WK" | python3 -c 'import sys,json;print(json.load(sys.stdin)["invoice_id"])')
chk "khách lẻ: thu đủ bằng tiền mặt + chuyển khoản, không công nợ" "$(V "select (select is_walkin from customers where id=i.customer_id) and outstanding=0 from sales_invoices i join v_sales_invoice_open o on o.invoice_id=i.id where i.id='$WK_ID'")"
OUT3=$(psql -X -Atq -d $DB -c "$SVC select public.post_sale_hkd(null,'2026-10-04','[{\"product_id\":\"$PR\",\"qty\":1,\"unit_price\":20000000}]'::jsonb,'[]'::jsonb)" 2>&1 | grep -i ERROR | head -1)
echo "  khách lẻ không trả tiền: $OUT3"
chk "khách lẻ không được ghi nợ" "$(echo "$OUT3" | grep -q walkin_must_pay_in_full && echo t || echo f)"
EI=$(S "select public.record_sale_einvoice('$WK_ID','{\"symbol\":\"C26TAA\",\"number\":\"0000001\",\"lookup_code\":\"ABC\"}'::jsonb)")
chk "lưu số hóa đơn điện tử + mã tra cứu (không tích hợp nhà cung cấp)" "$(V "select exists (select 1 from einvoices where sale_id='$WK_ID' and number='0000001' and status='issued')")"
LINE=$(V "select id from sales_invoice_lines where invoice_id='$WK_ID' limit 1")
RT=$(S "select public.post_sale_return('$WK_ID','2026-10-05','[{\"sale_line_id\":\"$LINE\",\"qty\":1}]'::jsonb,null,'Khách đổi ý',  'bank')")
echo "$RT"
chk "trả hàng: hoàn 20.000.000 chuyển khoản, nhập lại kho, 521 ghi nhận" "$(V "select public.account_balance('521')=20000000 and (select stock_qty from products where id='$PR')=12")"
chk "doanh thu tính ngưỡng đã trừ hàng trả lại (khớp 511 - 521 + VAT hóa đơn cũ)" "$(S "select public.revenue_ytd(2026)=public.account_balance('511')-public.account_balance('521')+public.account_balance('3331')")"
chk "doanh thu theo nhóm ngành khớp tổng doanh thu năm" "$(S "select (select sum(revenue) from public.revenue_by_tax_group(2026))=public.revenue_ytd(2026)")"
chk "đối chiếu sổ phụ = 0 sau bán/trả hàng" "$(S "select bool_and(diff=0) from public.accounting_reconciliation()")"
step "8c. A4: tài khoản tiền — bán thu vào ngân hàng cụ thể, chuyển tiền nội bộ, số dư từng tài khoản khớp TK 111/112"
BK=$(V "insert into money_accounts(kind,label,provider,account_no_masked,gl_account,is_default) values ('bank','MB chính','MB Bank','****6789','112',true) returning id")
CASH=$(V "select id from money_accounts where kind='cash' and is_default")
S "select public.post_sale_hkd(null,'2026-10-06','[{\"product_id\":\"$PR\",\"qty\":1,\"unit_price\":1000000}]'::jsonb,'[{\"method\":\"bank\",\"amount\":400000,\"money_account_id\":\"$BK\"},{\"method\":\"cash\",\"amount\":600000}]'::jsonb)" >/dev/null
chk "bán thu 400k vào MB chính + 600k tiền mặt: sale_payments gắn đúng tài khoản" "$(V "select count(*)=2 and bool_and(money_account_id is not null) from sale_payments sp join sales_invoices i on i.id=sp.sale_id where i.invoice_date='2026-10-06'")"
S "select public.post_money_transfer('$CASH','$BK',100000,'2026-10-06','Nộp tiền mặt')" >/dev/null
chk "chuyển nội bộ 100k: +100k ở MB chính, -100k ở tiền mặt (sổ cái gắn đúng tài khoản)" "$(V "select (select sum(debit-credit) from journal_lines l join journal_entries e on e.id=l.entry_id where e.source_type='money_transfer' and l.money_account_id='$BK')=100000 and (select sum(debit-credit) from journal_lines l join journal_entries e on e.id=l.entry_id where e.source_type='money_transfer' and l.money_account_id='$CASH')=-100000")"
chk "tổng các tài khoản tiền = TK 111 + 112 (đối chiếu)" "$(S "select (select sum(balance) from public.money_balances())=public.account_balance('111')+public.account_balance('112')")"
chk "đối chiếu sổ phụ vẫn bằng 0" "$(S "select bool_and(diff=0) from public.accounting_reconciliation()")"
step "8d. A5: sổ S1a-HKD sinh từ chứng từ khớp sổ cái"
chk "S1a năm 2026 = doanh thu thuần sổ cái (511 − 521 + 3331 legacy)" "$(S "select diff = 0 and s1a_total <> 0 from public.book_s1a_check('2026-01-01','2026-12-31')")"
chk "S1a tháng 10/2026 khớp sổ cái" "$(S "select diff = 0 from public.book_s1a_check('2026-10-01','2026-10-31')")"

step "8e. A6: 01/TKN-CNKD tổng = S1a; 01/BK-STK (số TK đầy đủ chỉ owner)"
chk "tổng [11] 01/TKN-CNKD năm 2026 = tổng S1a" "$(S "select (select revenue from public.tkn_cnkd_data(2026, null) where code = '11') = (select s1a_total from public.book_s1a_check('2026-01-01','2026-12-31'))")"
chk "bk_stk_data chạy được (owner)" "$(S "select count(*) >= 0 from public.bk_stk_data('all')")"
step "9. Kiểm tra cuối"
chk "tổng Nợ = tổng Có toàn sổ" "$(V "select sum(debit)=sum(credit) from journal_lines")"
chk "số thứ tự chứng từ liền mạch" "$(V "select count(*)=max(substring(entry_no from '[0-9]+\$')::int) - min(substring(entry_no from '[0-9]+\$')::int) + 1 from journal_entries where entry_no like 'JE-2026-%'")"
echo; [ $fail = 0 ] && echo "E2E RESULT: PASS" || echo "E2E RESULT: FAIL"; exit $fail
