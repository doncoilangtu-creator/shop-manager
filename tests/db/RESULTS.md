# Latest run (current schema = 0001 + 0002), PostgreSQL 17.11, 2026-10-02

```
ID                 KIND      VERDICT           DETAIL
------------------ --------- ----------------- ------
F3a                weakness  CONFIRMED         anon SELECT with no filter returned 2 token rows (incl. tokens of another ticket: 1); valid token visible=t
F3a-ctl1           control   OK                expired token hidden from anon (policy filter works)
F3a-ctl2           control   OK                used token hidden from anon (policy filter works)
F3b                weakness  CONFIRMED         anon INSERT into signatures for a ticket with no token: ACCEPTED
F3b-used           weakness  CONFIRMED         anon can sign a ticket whose token was already used (token never checked by DB)
F3b-tech           weakness  CONFIRMED         anon can insert signer_role=technician (forged technician signature)
F3b-spoof          weakness  CONFIRMED         anon can set arbitrary signed_at/ip_address (evidence fields client-controlled)
F3b-ctl1           control   OK                anon cannot SELECT signatures (no anon select policy)
F3b-ret            info      INFO              anon INSERT ... RETURNING: fails (sqlstate 42501). With PostgREST default return=minimal the plain insert works.
F7-unique          weakness  CONFIRMED         unique(ticket_id,signer_role) exists=f; two customer signatures on same ticket inserted (privileged)=t; third inserted by anon=t
F7-size            weakness  CONFIRMED         anon inserted a 5 MB signature_png: ACCEPTED (no CHECK on length)
F3c                weakness  CONFIRMED         authenticated INSERT into signatures: REJECTED (new row violates row-level security policy for table "signatures")
RLS-readall        weakness  CONFIRMED         arbitrary authenticated uid (not an admin) read customers=2 bot_users(telegram ids)=1 signature_tokens=1; policies are using(true), no owner/admin check
RLS-cascade        weakness  CONFIRMED         authenticated DELETE customer (rows=1) also removed its tickets/signatures/contracts (left: tickets=0 signatures=0 contracts=0) - signed maintenance records are destroyed by cascade
RLS-nowrite        info      INFO              authenticated on maintenance_tickets: insert allowed=f, update rows affected=0 (matches plan: ticket writes only work via service-role admin client). Control: authenticated can insert products=t (policy from 0002)
RLS-nowrite-ctl    control   OK                write policies exist exactly for the 5 tables of 0002 and not for maintenance_tickets
ANON-read-ctl      control   OK                anon sees 0 rows in every other public table
ANON-insert-ctl    control   OK                anon cannot insert into customers/products/notifications/bot_users/categories/quotations/signature_tokens
SVC-bypass-ctl     control   OK                service_role reads RLS-protected table (BYPASSRLS), as the admin client does
ANON-policies      info      INFO              anon policies: signature_tokens.anon_read_signature_tokens[SELECT], signatures.anon_insert_signatures[INSERT]
F7-stock           weakness  CONFIRMED         stock_qty set to -3 directly by authenticated; stock_movements rows for product=0 (no CHECK stock_qty>=0, no ledger trigger)
F6-qtytype         weakness  CONFIRMED         stock_movements.qty=numeric(12,2) vs products.stock_qty=integer; 10 + 1.5 stored as 12 (silent rounding)
QUO-checks         weakness  CONFIRMED         quotation_items accepted qty=-5, discount>>price, line_total unrelated to qty*price=t; quotations.total not tied to items=t (no CHECK/trigger)
F12-status         weakness  CONFIRMED         ticket moved closed -> received with a plain UPDATE; no transition trigger/CHECK (state machine lives only in app code, in 2 divergent copies)
F13-contract       weakness  CONFIRMED         contract with end_date < start_date accepted=t; negative monthly_fee/sla_hours accepted=t
F14-lowstock       weakness  CONFIRMED         SQL `stock_qty <= 'min_stock'` -> 22P02 invalid input syntax for type integer: "min_stock". SQL-level only: the exact PostgREST request (filter stock_qty=lte.min_stock) was NOT executed here
F14-lowstock-ctl   control   OK                the correct column-vs-column comparison `stock_qty <= min_stock` runs fine
TRG-updated_at-ctl control   OK                set_updated_at trigger overrides updated_at on UPDATE
TOKEN-unique-ctl   control   OK                signature_tokens.token is UNIQUE (duplicate rejected)
MIG-idempotent     control   OK                compat + 0001 + 0002 + seed re-applied (seed 2x) without error

SUMMARY: weaknesses CONFIRMED=16 NOT_REPRODUCIBLE=0 | controls OK=11 FAIL=0 | harness errors=0
```
