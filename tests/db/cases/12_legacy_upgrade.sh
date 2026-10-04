#!/usr/bin/env bash
# C2: upgrading a DB that already has 0001+0002 and LEGACY data (the real production situation).
#  (a) stock_qty without ledger rows gets reconciled by explicit adjust movements, nothing else is lost
#  (b) existing Auth users become staff (so the shop owner is not locked out)
#  (c) duplicate (ticket_id, signer_role) signatures -> migration refuses (transaction rolled back, DB untouched)
#  (d) fractional stock_movements.qty -> migration refuses
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
q() { psql -X -Atq -v ON_ERROR_STOP=1 -d "$1" -c "$2"; }
mk() { # $1 = db name: compat + 0001 + 0002 only
  psql -X -q -d postgres -c "drop database if exists $1 with (force)" -c "create database $1" >/dev/null 2>&1
  for f in "$ROOT/scripts/local-db/compat.sql" "$ROOT/supabase/migrations/0001_init.sql" "$ROOT/supabase/migrations/0002_quotation_pdf_url.sql"; do
    psql -X -q -v ON_ERROR_STOP=1 -d "$1" -1 -f "$f" >/dev/null 2>&1 || { echo "RESULT|MIG-legacy|control|FAIL|could not build legacy db"; exit 0; }
  done
}
M3="$ROOT/supabase/migrations/0003_c2_hardening.sql"
A=shop_legacy_a; B=shop_legacy_b; C=shop_legacy_c

mk $A
q $A "insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000aa','owner@shop.local')"
q $A "insert into products(sku,name,stock_qty) values ('L1','legacy1',7),('L2','legacy2',0),('L3','legacy3',4)"
q $A "insert into stock_movements(product_id,type,qty) select id,'in',3 from products where sku='L3'"
if psql -X -q -v ON_ERROR_STOP=1 -d $A -1 -f "$M3" >/dev/null 2>/tmp/legacy.err; then
  r=$(q $A "select (select stock_qty from products where sku='L1'), (select coalesce(sum(qty_delta),0) from stock_movements m join products p on p.id=m.product_id where p.sku='L1'), (select coalesce(sum(qty_delta),0) from stock_movements m join products p on p.id=m.product_id where p.sku='L3'), (select count(*) from v_stock_mismatch), (select count(*) from products), (select count(*) from app_users where user_id='00000000-0000-0000-0000-0000000000aa')")
  if [ "$r" = "7|7|4|0|3|1" ]; then ok=OK; else ok=FAIL; fi
  echo "RESULT|MIG-legacy-reconcile|control|$ok|legacy stock 7 (no ledger) and 4 (ledger said 3) reconciled by adjust rows; stock unchanged, mismatch view empty, existing auth user -> staff [row: $r]"
else
  echo "RESULT|MIG-legacy-reconcile|control|FAIL|0003 failed on legacy data: $(tr '\n' ' ' </tmp/legacy.err | cut -c1-150)"
fi

mk $B
q $B "insert into customers(id,name) values ('00000000-0000-0000-0000-0000000000c1','c')"
q $B "insert into maintenance_tickets(id,code,customer_id,title) values ('00000000-0000-0000-0000-0000000000d1','TK-1','00000000-0000-0000-0000-0000000000c1','t')"
q $B "insert into signatures(ticket_id,signer_name,signer_role,signature_png) values ('00000000-0000-0000-0000-0000000000d1','a','customer','x'),('00000000-0000-0000-0000-0000000000d1','b','customer','y')"
if psql -X -q -v ON_ERROR_STOP=1 -d $B -1 -f "$M3" >/dev/null 2>/tmp/legacy.err; then
  echo "RESULT|MIG-legacy-dupsig|control|FAIL|0003 applied despite duplicate signatures"
else
  has_tbl=$(q $B "select to_regclass('public.app_users') is not null")
  if grep -q 'duplicate (ticket_id, signer_role)' /tmp/legacy.err && [ "$has_tbl" = f ]; then
    echo "RESULT|MIG-legacy-dupsig|control|OK|duplicate signatures -> migration aborts with a clear message and rolls back completely (app_users not created)"
  else echo "RESULT|MIG-legacy-dupsig|control|FAIL|unexpected: $(tr '\n' ' ' </tmp/legacy.err | cut -c1-150) has_tbl=$has_tbl"; fi
fi

mk $C
q $C "insert into products(id,sku,name) values ('00000000-0000-0000-0000-0000000000e1','F1','frac')"
q $C "insert into stock_movements(product_id,type,qty) values ('00000000-0000-0000-0000-0000000000e1','in',1.5)"
if psql -X -q -v ON_ERROR_STOP=1 -d $C -1 -f "$M3" >/dev/null 2>/tmp/legacy.err; then
  echo "RESULT|MIG-legacy-fracqty|control|FAIL|0003 applied despite fractional qty"
else
  if grep -q 'fractional stock_movements.qty' /tmp/legacy.err; then echo "RESULT|MIG-legacy-fracqty|control|OK|fractional ledger qty -> migration aborts instead of silently rounding"
  else echo "RESULT|MIG-legacy-fracqty|control|FAIL|unexpected: $(tr '\n' ' ' </tmp/legacy.err | cut -c1-150)"; fi
fi
for d in $A $B $C; do psql -X -q -d postgres -c "drop database if exists $d with (force)" >/dev/null 2>&1; done
