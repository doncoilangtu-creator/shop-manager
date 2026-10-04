#!/usr/bin/env bash
# C2: real parallel sessions against shop_test (data committed, cleaned up at the end)
#  - stock_adjust(): 4 sessions x 25 "in" + 2 sessions racing for the last units -> exact totals, never negative
#  - sign_ticket(): two sessions sign the same role with different tokens -> exactly one wins
set -uo pipefail
P=$(psql -X -Atq -d shop_test -c "insert into products(sku,name) values ('CONC-'||gen_random_uuid(),'conc') returning id")
run() { psql -X -Atq -d shop_test -c "$1" >/dev/null 2>&1; }
svc="set role service_role; select set_config('request.jwt.claims','{\"role\":\"service_role\"}',false);"
# 4 parallel sessions, 25 inbound each
for i in 1 2 3 4; do
  ( for _ in $(seq 25); do psql -X -Atq -d shop_test -c "$svc select public.stock_adjust('$P','in',1)" >/dev/null 2>&1; done ) &
done; wait
IN=$(psql -X -Atq -d shop_test -c "select stock_qty from products where id='$P'")
# 2 sessions try to take 1 unit x 60 each from 100 -> 100 succeed at most, 20 fail with insufficient_stock; stock must end at 0
for i in 1 2; do
  ( for _ in $(seq 60); do psql -X -Atq -d shop_test -c "$svc select public.stock_adjust('$P','out',1)" >/dev/null 2>&1; done ) &
done; wait
OUT=$(psql -X -Atq -d shop_test -c "select stock_qty from products where id='$P'")
MM=$(psql -X -Atq -d shop_test -c "select count(*) from v_stock_mismatch")
OUTS=$(psql -X -Atq -d shop_test -c "select count(*) from stock_movements where product_id='$P' and type='out'")
if [ "$IN" = 100 ] && [ "$OUT" = 0 ] && [ "$OUTS" = 100 ] && [ "$MM" = 0 ]; then ok=OK; else ok=FAIL; fi
echo "RESULT|CONC-stock|control|$ok|4x25 parallel IN -> stock=$IN (expect 100); 2x60 parallel OUT against 100 units -> stock=$OUT, out-movements=$OUTS (expect 0 / 100: 20 rejected as insufficient_stock); ledger mismatch rows=$MM"

# sign race
C=$(psql -X -Atq -d shop_test -c "insert into customers(name) values ('conc') returning id")
T=$(psql -X -Atq -d shop_test -c "insert into maintenance_tickets(code,customer_id,title) values ('TK-'||substr(gen_random_uuid()::text,1,8),'$C','conc') returning id")
psql -X -Atq -d shop_test -c "update maintenance_tickets set status='in_progress' where id='$T'; update maintenance_tickets set status='completed' where id='$T'" >/dev/null
T1=tok_$RANDOM$RANDOM; T2=tok_$RANDOM$RANDOM
psql -X -Atq -d shop_test -c "insert into signature_tokens(ticket_id,token,expires_at) values ('$T','$T1',now()+interval '1 day'),('$T','$T2',now()+interval '1 day')" >/dev/null
PNG=$(printf 'A%.0s' $(seq 60))
r1=/tmp/sign_r1.$$; r2=/tmp/sign_r2.$$
( psql -X -Atq -d shop_test -c "$svc select public.sign_ticket('$T1','$T','A','customer','$PNG')" >$r1 2>&1 ) &
( psql -X -Atq -d shop_test -c "$svc select public.sign_ticket('$T2','$T','B','customer','$PNG')" >$r2 2>&1 ) &
wait
NS=$(psql -X -Atq -d shop_test -c "select count(*) from signatures where ticket_id='$T'")
if { grep -q '"ok": true' $r1 && grep -qE 'already_signed|token_used' $r2; } || { grep -q '"ok": true' $r2 && grep -qE 'already_signed|token_used' $r1; } && [ "$NS" = 1 ]; then ok=OK; else ok=FAIL; fi
echo "RESULT|CONC-sign|control|$ok|two parallel signatures for the same role with different tokens -> signatures=$NS (expect exactly 1), loser got already_signed/token_used"
rm -f $r1 $r2
# cleanup committed fixtures (signatures are immutable/restrict -> disable triggers as superuser)
psql -X -Atq -d shop_test >/dev/null 2>&1 <<SQL
set session_replication_role = replica;
delete from signatures where ticket_id='$T';
delete from signature_tokens where ticket_id='$T';
delete from maintenance_tickets where id='$T';
delete from customers where id='$C';
delete from stock_movements where product_id='$P';
delete from products where id='$P';
SQL
