#!/usr/bin/env bash
# Real parallel sessions on a throwaway clone of shop_test (committed data, dropped at the end):
#  3 sessions x 6 sales of 1 unit against 10 units -> exactly 10 succeed, stock 0, document numbers gapless, books reconcile
#  2 sessions race to close the same period -> one result, no duplicated snapshot rows
set -uo pipefail
DB=shop_conc_$$
psql -X -Atq -d postgres -c "create database $DB template shop_test" >/dev/null 2>&1 || { echo "RESULT|ACC-CONC|control|FAIL|cannot clone shop_test (template busy?)"; exit 0; }
q() { psql -X -Atq -d $DB -c "$1" 2>&1; }
svc="set role service_role; select set_config('request.jwt.claims','{\"role\":\"service_role\"}',false);"
C=$(q "insert into customers(name) values ('conc') returning id" | head -1)
S=$(q "insert into suppliers(name) values ('conc') returning id" | head -1)
P=$(q "insert into products(sku,name) values ('ACC-CONC','conc') returning id" | head -1)
q "$svc select public.post_purchase_bill('$S','2025-09-01',null,'[{\"product_id\":\"$P\",\"qty\":10,\"unit_cost\":100000}]'::jsonb)" >/dev/null
for w in 1 2 3; do
  ( for _ in 1 2 3 4 5 6; do psql -X -Atq -d $DB -c "$svc select public.post_sales_invoice('$C','2025-09-05',null,'[{\"product_id\":\"$P\",\"qty\":1,\"unit_price\":150000,\"vat_rate\":10}]'::jsonb)" >/dev/null 2>&1; done ) &
done; wait
N=$(q "select count(*) from sales_invoices where customer_id='$C'" | tail -1)
STK=$(q "select stock_qty||'/'||stock_value from products where id='$P'" | tail -1)
GAP=$(q "select max(substring(invoice_no from '[0-9]+\$')::int) - min(substring(invoice_no from '[0-9]+\$')::int) + 1 - count(*) from sales_invoices where customer_id='$C'" | tail -1)
REC=$(q "select count(*) from accounting_reconciliation() where diff <> 0" | tail -1)
if [ "$N" = 10 ] && [ "$STK" = "0/0.00" ] && [ "$GAP" = 0 ] && [ "$REC" = 0 ]; then ok=OK; else ok=FAIL; fi
echo "RESULT|ACC-CONC-sales|control|$ok|18 parallel sale attempts on 10 units -> invoices=$N (expect 10), stock/value=$STK (expect 0/0.00), numbering gaps=$GAP, reconciliation diffs=$REC"
# period close race
q "$svc select public.close_period(2025, 8)" >/dev/null 2>&1
for w in 1 2; do ( psql -X -Atq -d $DB -c "$svc select public.close_period(2025, 9)" >/tmp/cl_$w.$$ 2>&1 ) & done; wait
NB=$(q "select count(*) from (select account_code, snapshot_no from period_balances where period_id=(select id from fiscal_periods where year=2025 and month=9) group by 1,2 having count(*)>1) x" | tail -1)
CL=$(q "select count(*) from fiscal_periods where year=2025 and month=9 and status='closed'" | tail -1)
E1=$(cat /tmp/cl_1.$$ /tmp/cl_2.$$ | grep -ci "error\|already")
if [ "$NB" = 0 ] && [ "$CL" = 1 ]; then ok=OK; else ok=FAIL; fi
echo "RESULT|ACC-CONC-close|control|$ok|two parallel close_period(2025,9) -> closed periods=$CL (expect 1), duplicated snapshot rows=$NB, loser errors=$E1"
rm -f /tmp/cl_1.$$ /tmp/cl_2.$$
psql -X -Atq -d postgres -c "drop database $DB" >/dev/null 2>&1
