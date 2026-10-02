# DB harness results (PostgreSQL 17, local compat layer — NOT real Supabase)

## Before C2 (schema 0001+0002) — `SHOP_MIGRATE_UPTO=0002 bash scripts/local-db.sh up && bash tests/db/run.sh`
```
F3a                weakness  CONFIRMED         anon SELECT with no filter returned 2 token rows (incl. tokens of another ticket: 1); valid token visible=t
F3b                weakness  CONFIRMED         anon INSERT into signatures for a ticket with no token: ACCEPTED
F3b-used           weakness  CONFIRMED         anon can sign a ticket whose token was already used (token never checked by DB)
F3b-tech           weakness  CONFIRMED         anon can insert signer_role=technician (forged technician signature)
F3b-spoof          weakness  CONFIRMED         anon can set arbitrary signed_at/ip_address (evidence fields client-controlled)
F7-unique          weakness  CONFIRMED         unique(ticket_id,signer_role) exists=f; two customer signatures on same ticket inserted (privileged)=t; third inserted by anon=t
F7-size            weakness  CONFIRMED         privileged insert of a 5 MB signature_png: ACCEPTED (CHECK on length)
F3c                weakness  CONFIRMED         logged-in owner can sign via [direct INSERT as authenticated]: NO (new row violates row-level security policy for table "signatures")
RLS-readall        weakness  CONFIRMED         arbitrary authenticated uid (not staff) read customers=2 bot_users(telegram ids)=1 signature_tokens=2
RLS-cascade        weakness  CONFIRMED         staff DELETE customer rows=1 (left: tickets=0 signatures=0 contracts=0)
F7-stock           weakness  CONFIRMED         stock_qty set to -3 directly by authenticated; stock_movements rows for product=0 (no CHECK stock_qty>=0, no ledger trigger)
F6-qtytype         weakness  CONFIRMED         stock_movements.qty=numeric(12,2) vs products.stock_qty=integer; 10 + 1.5 stored as 12 (silent rounding); movement qty 1.5 stored as 1.50
QUO-checks         weakness  CONFIRMED         quotation_items accepted qty=-5, discount>>price, line_total unrelated to qty*price=t; quotations.total not tied to items=t (no CHECK/trigger)
F12-status         weakness  CONFIRMED         ticket moved closed -> received with a plain UPDATE; no transition trigger/CHECK (state machine lives only in app code, in 2 divergent copies)
F13-contract       weakness  CONFIRMED         contract with end_date < start_date accepted=t; negative monthly_fee/sla_hours accepted=t
F14-lowstock       weakness  CONFIRMED         low-stock view check: no view (product stock 0 <= min_stock 5 must be listed)
SUMMARY: weaknesses CONFIRMED=16 NOT_REPRODUCIBLE=0 | controls OK=12 FAIL=0 | harness errors=0
```

## After C2 (schema 0001+0002+0003) — `bash scripts/local-db.sh up && bash tests/db/run.sh --strict` (exit 0)
```
ID                 KIND      VERDICT           DETAIL
------------------ --------- ----------------- ------
F3a                weakness  NOT_REPRODUCIBLE  anon SELECT with no filter returned 0 token rows (incl. tokens of another ticket: 0); valid token visible=f
F3a-ctl1           control   OK                expired token hidden from anon (policy filter works)
F3a-ctl2           control   OK                used token hidden from anon (policy filter works)
F3b                weakness  NOT_REPRODUCIBLE  anon INSERT into signatures for a ticket with no token: rejected (permission denied for table signatures)
F3b-used           weakness  NOT_REPRODUCIBLE  anon can sign a ticket whose token was already used (token never checked by DB)
F3b-tech           weakness  NOT_REPRODUCIBLE  anon can insert signer_role=technician (forged technician signature)
F3b-spoof          weakness  NOT_REPRODUCIBLE  anon can set arbitrary signed_at/ip_address (evidence fields client-controlled)
F3b-ctl1           control   OK                anon cannot SELECT signatures (no anon select policy)
F3b-ret            info      INFO              anon INSERT ... RETURNING: fails (sqlstate 42501). With PostgREST default return=minimal the plain insert works.
F7-unique          weakness  NOT_REPRODUCIBLE  unique(ticket_id,signer_role) exists=t; two customer signatures on same ticket inserted (privileged)=f; third inserted by anon=f
F7-size            weakness  NOT_REPRODUCIBLE  privileged insert of a 5 MB signature_png: rejected (CHECK on length)
F3c                weakness  NOT_REPRODUCIBLE  logged-in owner can sign via [sign_ticket() as service_role]: yes
RLS-readall        weakness  NOT_REPRODUCIBLE  arbitrary authenticated uid (not staff) read customers=0 bot_users(telegram ids)=0 signature_tokens=0
RLS-staff-ctl      control   OK                staff user reads customers (2 rows)
RLS-cascade        weakness  NOT_REPRODUCIBLE  staff DELETE customer rows=0 [update or delete on table "customers" violates foreign key constraint "maintenance_tickets_customer_id_fkey" on table "maintenance_tickets"] (left: tickets=1 signatures=1 contracts=1)
RLS-nowrite        info      INFO              staff on maintenance_tickets: insert allowed=f, update rows affected=0 (ticket writes only via service-role admin client). Control: staff can insert products=t (policy from 0002)
RLS-nowrite-ctl    control   OK                write policies exist exactly for the 5 tables of 0002 and not for maintenance_tickets
ANON-read-ctl      control   OK                anon sees 0 rows in every other public table
ANON-insert-ctl    control   OK                anon cannot insert into customers/products/notifications/bot_users/categories/quotations/signature_tokens
SVC-bypass-ctl     control   OK                service_role reads RLS-protected table (BYPASSRLS), as the admin client does
ANON-policies      info      INFO              anon policies: none
F7-stock           weakness  NOT_REPRODUCIBLE  stock_qty set to 5 directly by authenticated; stock_movements rows for product=1 (no CHECK stock_qty>=0, no ledger trigger)
F6-qtytype         weakness  NOT_REPRODUCIBLE  stock_movements.qty=integer(32,0) vs products.stock_qty=integer; 10 + 1.5 stored as 12 (silent rounding); movement qty 1.5 stored as 2
QUO-checks         weakness  NOT_REPRODUCIBLE  quotation_items accepted qty=-5, discount>>price, line_total unrelated to qty*price=f; quotations.total not tied to items= (no CHECK/trigger)
F12-status         weakness  NOT_REPRODUCIBLE  ticket moved closed -> closed with a plain UPDATE; no transition trigger/CHECK (state machine lives only in app code, in 2 divergent copies)
F13-contract       weakness  NOT_REPRODUCIBLE  contract with end_date < start_date accepted=f; negative monthly_fee/sla_hours accepted=f
F14-literal-info   info      INFO              SQL `stock_qty <= 'min_stock'` -> 22P02 (still invalid SQL; the app must not use it)
F14-lowstock       weakness  NOT_REPRODUCIBLE  low-stock view check: view ok (product stock 0 <= min_stock 5 must be listed)
F14-lowstock-ctl   control   OK                the correct column-vs-column comparison `stock_qty <= min_stock` runs fine
TRG-updated_at-ctl control   OK                set_updated_at trigger overrides updated_at on UPDATE
TOKEN-unique-ctl   control   OK                signature_tokens.token is UNIQUE (duplicate rejected)
MIG-idempotent     control   OK                compat + 0001 + 0002 + seed re-applied (seed 2x) without error
SIGN-first         control   OK                first signature moves completed -> awaiting_signature (rpc=awaiting_signature, row=awaiting_signature)
SIGN-token-consumed control   OK                used token + all other unused tokens of the ticket consumed (2 of 2)
SIGN-reuse         control   OK                reusing a consumed token -> token_used
SIGN-both          control   OK                second role -> signed: signed
SIGN-ticket-final  control   OK                signing a signed ticket again -> ticket_not_signable
SIGN-dup-role      control   OK                same role twice -> already_signed
SIGN-expired       control   OK                token_expired
SIGN-mismatch      control   OK                token_ticket_mismatch
SIGN-unknown       control   OK                token_not_found
SIGN-toolarge      control   OK                signature_too_large
SIGN-notready      control   OK                ticket still in "received": ticket_not_signable
SIGN-anon-denied   control   OK                anon: permission denied for function sign_ticket
SIGN-staff-denied  control   OK                authenticated staff (must go through the API route): permission denied for function sign_ticket
SIGN-immutable-upd control   OK                signatures are immutable (append-only evidence)
SIGN-immutable-del control   OK                signatures are immutable (append-only evidence)
SIGN-ticket-delete-blocked control   OK                deleting a ticket that has signatures: update or delete on table "maintenance_tickets" violates foreign key constraint 
STK-opening        control   OK                product created with stock 5 -> 1 opening movement, stock_qty=5
STK-in-out         control   OK                5 +10 -3 = 12
STK-insufficient   control   OK                out 100 with 12 on hand -> insufficient_stock
STK-neg-qty        control   OK                in with qty -1 -> qty_invalid
STK-adjust-below-zero control   OK                adjust -20 -> insufficient_stock
STK-direct-update  control   OK                direct UPDATE of stock_qty -> products.stock_qty can only change through stock_movements (use stock_
STK-update-other-cols control   OK                updating other columns still works: OK
STK-no-direct-ledger-insert control   OK                staff direct INSERT into stock_movements -> new row violates row-level security policy for table "stock_movements"
STK-invariant      control   OK                stock_qty=10 equals ledger sum, mismatching products=0
STK-ledger-no-update control   OK                stock_movements is append-only (use a compensating "adjust" movement)
STK-ledger-no-delete control   OK                stock_movements is append-only (use a compensating "adjust" movement)
STK-product-delete-blocked control   OK                deleting a product that has ledger rows -> update or delete on table "products" violates foreign key co
STK-nonstaff-denied control   OK                non-staff authenticated -> forbidden
STK-anon-denied    control   OK                anon -> permission denied for function stock_adjust
STK-service-ok     control   OK                service_role (bot/admin client) allowed
QUO-create-totals  control   OK                {"id": "a6d369b4-e82c-432b-ab86-8e2845b9cf8e", "vat": 220000.00, "items": 2, "total": 2420000.00, "discount": 100000.00, "subtotal": 2300000.00}
QUO-update-atomic  control   OK                invalid 2nd line -> item_invalid; items still 2, total still 2420000.00 (nothing lost)
QUO-update-replace control   OK                draft update replaces items: 1 item(s), total 3000.00
QUO-dup-code       control   OK                duplicate code -> duplicate key value violates unique constraint "quotations_c
QUO-not-draft      control   OK                quotation_not_draft
QUO-empty-items    control   OK                items_required
QUO-nonstaff-denied control   OK                non-staff -> new row violates row-level security policy for table "quotations"
QUO-check-line     control   OK                new row for relation "quotation_items" violates check constraint "quotation_items_values_o
QUO-check-total    control   OK                new row for relation "quotations" violates check constraint "quotations_totals_ok"
TKT-matrix         control   OK                64 transitions checked, mismatches=0 
TKT-skip-blocked   control   OK                received -> signed: invalid ticket status transition received -> signed
TKT-other-update-ok control   OK                non-status updates unaffected
MIG-legacy-reconcile control   OK                legacy stock 7 (no ledger) and 4 (ledger said 3) reconciled by adjust rows; stock unchanged, mismatch view empty, existing auth user -> staff [row: 7|7|4|0|3|1]
MIG-legacy-dupsig  control   OK                duplicate signatures -> migration aborts with a clear message and rolls back completely (app_users not created)
MIG-legacy-fracqty control   OK                fractional ledger qty -> migration aborts instead of silently rounding
CONC-stock         control   OK                4x25 parallel IN -> stock=100 (expect 100); 2x60 parallel OUT against 100 units -> stock=0, out-movements=100 (expect 0 / 100: 20 rejected as insufficient_stock); ledger mismatch rows=0
CONC-sign          control   OK                two parallel signatures for the same role with different tokens -> signatures=1 (expect exactly 1), loser got already_signed/token_used

SUMMARY: weaknesses CONFIRMED=0 NOT_REPRODUCIBLE=16 | controls OK=60 FAIL=0 | harness errors=0
```
