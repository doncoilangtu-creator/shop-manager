# Migrations

Apply in order with the Supabase SQL editor / `supabase db push`. **Never run them against production
before a backup** (`supabase db dump` / `pg_dump`) and before trying them on a disposable copy
(`bash scripts/local-db.sh up` builds a local Postgres with a Supabase compatibility layer).

| file | what |
|---|---|
| 0001_init.sql, 0002_quotation_pdf_url.sql | original schema (unchanged, never edit) |
| 0003_c2_hardening.sql | C2: staff allow-list RLS, `sign_ticket()`, stock ledger + `stock_adjust()`, `save_quotation()`, constraints, ticket state machine |

## 0003 notes
* **Existing Auth users are granted `owner` in `app_users`** (single-user shop). Review `select * from app_users;` and
  switch off public sign-ups in Supabase Auth → Providers → Email → "Allow new users to sign up".
  New staff: `select public.grant_staff('mail@x.com','staff');` (service role / SQL editor), or `npm run bootstrap-admin`.
* The migration **aborts (and rolls back completely)** if legacy data would be silently altered:
  duplicate `(ticket_id, signer_role)` signatures, or fractional `stock_movements.qty`. Fix the rows by hand and re-run.
* `products.stock_qty` that did not match the ledger is reconciled with explicit `adjust` movements
  (`ref_type='opening'`, note "Đối soát tồn kho ..."). Nothing is deleted.
* NOT VALID check constraints (`quotation_items_values_ok`, `quotations_totals_ok`, `contracts_*`, `products_stock_nonneg`,
  `stock_movements_qty_ok`, `signatures_png_size`) are enforced for new/updated rows only. After cleaning legacy rows run
  `alter table ... validate constraint ...;`.
* Customers / tickets / contracts / debts / signatures / stock ledger rows can no longer be removed by a cascade
  (FKs are `ON DELETE RESTRICT`).
* Rollback = restore the backup (qty column type changes). Restoring only the policies is possible by re-running
  the policy part of 0002/0001, but the app code of C2+ expects the new RPCs.
* Idempotent: safe to re-run (tested by `tests/db/cases/07`).

## 0004–0006: accounting module (branch refactor/c2b-accounting)

Apply in order after 0003 (all idempotent, `bash scripts/local-db.sh up`).

| file | content |
|---|---|
| 0004_accounting_ledger.sql | chart of accounts (TT133 subset), fiscal periods, `journal_entries/lines` (append-only, balanced Nợ=Có checked by a deferred constraint trigger, closed-period block), gapless numbering (`doc_counters`), `post_journal`, `reverse_journal`, `trial_balance`, `account_balance`, `close_period` / `reopen_period` (owner or service_role), `v_general_ledger`, audit table |
| 0005_inventory_costing.sql | `stock_movements.value_delta`, `products.stock_value`, moving-average cost computed in a BEFORE INSERT trigger, `v_inventory_valuation`, `v_stock_value_mismatch` |
| 0006_sales_purchases_ar_ap.sql | `sales_invoices`, `purchase_bills`, `payments`, `payment_allocations` (immutable documents; only the void marker may be set), RPCs `post_sales_invoice`, `post_purchase_bill`, `post_receipt`, `post_disbursement`, `allocate_payment`, `reverse_sales_invoice`, `reverse_purchase_bill`, `reverse_payment`, `post_stock_adjustments`, reports `vat_report`, `vat_by_rate`, `ar_aging`, views `v_ar_by_customer`, `v_ap_by_supplier`, and `accounting_reconciliation()` (every diff must be 0) |

Rules: nothing is ever UPDATEd or DELETEd in the ledger — corrections are reversal entries (`reverse_*`). A sale takes stock out at the current average cost and books Dr 131 / Cr 511 / Cr 3331 and Dr 632 / Cr 156 in ONE transaction. Document-less stock movements (counts, opening balances) must be booked with `post_stock_adjustments()` or `accounting_reconciliation()` shows the gap.

Tests: `tests/db/cases/20..24`, end-to-end: `bash scripts/e2e-scenario.sh`.

Deploy note: the Telegram bot's `/nhap` and `/ban` still write `products.stock_qty` directly and will be rejected after 0003 until C9 lands.
