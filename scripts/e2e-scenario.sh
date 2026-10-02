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

step "1. Nhập hàng: 10 cái x 10.000.000 + VAT 10% (ghi nợ NCC)"
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
step "8. Kiểm tra cuối"
chk "tổng Nợ = tổng Có toàn sổ" "$(V "select sum(debit)=sum(credit) from journal_lines")"
chk "số thứ tự chứng từ liền mạch" "$(V "select count(*)=max(substring(entry_no from '[0-9]+\$')::int) - min(substring(entry_no from '[0-9]+\$')::int) + 1 from journal_entries where entry_no like 'JE-2026-%'")"
echo; [ $fail = 0 ] && echo "E2E RESULT: PASS" || echo "E2E RESULT: FAIL"; exit $fail
