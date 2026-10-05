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

Deploy note: the Telegram bot built BEFORE branch `refactor/c9-bot` writes `products.stock_qty` directly and is rejected after 0003. Deploy the C9 bot together with these migrations.

## 0007–0010 (branches c4 … c8)

| file | content |
|---|---|
| 0007_c4_stock_count.sql | `stock_count(product, counted, notes)` row-locked absolute stocktake; `v_stock_card` view |
| 0008_c5_fifo_allocation.sql | `post_receipt_fifo`, `post_disbursement_fifo` (oldest document first, partner row locked, remainder stays as unapplied credit) |
| 0009_c6_quotations.sql | quotation status FSM trigger, content frozen after draft, `quotations.pdf_path`, private bucket (guarded: only if the storage schema exists), `invoice_from_quotation()` (≤1 VND rounding tolerance, one active invoice per quotation) |
| 0010_c8_reports.sql | `report_dashboard()`, `report_monthly_pnl()`, `report_top_products()`, `report_top_customers()` — GL based, Asia/Ho_Chi_Minh months, `has_app_access()` (staff or service_role/bot) |

Tests: `tests/db/cases/25..28`. Full run: `bash tests/db/run.sh --strict`.
Untested on real Supabase: the guarded storage-bucket statement in 0009, RLS through PostgREST, any role/grant difference between Supabase and the local compat layer. Apply to a staging project first.

## 0011–0014 (security hardening, A1, A2, A3)

| file | content |
|---|---|
| 0011_security_hardening.sql | revoke EXECUTE on trigger functions, pin `search_path` on 12 functions, `(select auth.uid())` in `app_users_self_read` |
| 0012_hkd_profile_tax.sql | **A1 — hộ kinh doanh**: `business_profile` (1 row; CCCD readable by owner only), `business_locations`, `tax_groups`, `tax_rates`, `legal_thresholds` (effective-dated, threshold 1 tỷ is a row not code), RPCs `set_business_profile`, `get_business_profile`, `upsert_business_location`, `set_legal_threshold` (owner only), `revenue_ytd`, `revenue_by_month`, `threshold_status` (warning ≥ 80 %, exceeded ≥ 100 %), view `v_revenue_events` |
| 0013_hkd_sales.sql | **A2 — bán hàng HKD**: seeded walk-in customer `Khách lẻ` (`customers.is_walkin`), `sales_invoices` +`paid_at_sale/channel/location_id/buyer/sale_source`, `sales_invoice_lines` +`tax_group` + rate snapshots, `products.tax_group`, tables `sale_payments`, `sales_returns`, `sales_return_lines`, `einvoices`; RPCs `post_sale_hkd` (atomic, one balanced entry, no 3331), `post_sale_return`/`reverse_sales_return` (TK 521), `record_sale_einvoice`/`cancel_sale_einvoice`, `revenue_by_tax_group`; redefines `reverse_sales_invoice` (blocked by returns / active e-invoice), `post_stock_adjustments` (skips `sales_return` movements), `trg_doc_immutable`, `v_sales_invoice_open`, `v_revenue_events` (returns netted), `report_dashboard/monthly_pnl/top_products/top_customers` (revenue = 511 − 521) |
| 0014_hkd_vat_removal.sql | **A3 — gỡ VAT khỏi luồng HKD**: `app_settings` + `accounting_mode()`/`set_accounting_mode()` (owner only, audited; default `hkd`, legacy `enterprise`), triggers chặn VAT trên `sales_invoices`/`sales_invoice_lines`/`quotations` và dòng mới vào TK 133/3331 (đảo bút toán cũ vẫn được), `stock_adjust` chặn nhập kho tay (chỉ `opening`), `post_purchase_bill` (VAT cộng vào giá vốn ở HKD), `reverse_purchase_bill` (hoàn kho đúng value_delta), `post_sale_hkd` +`p_quotation_id`, `invoice_from_quotation` (HKD -> `post_sale_hkd`). |

Forward-only; safe on the (almost empty) production DB: adds tables/functions/columns and one seed row (`Khách lẻ`); no existing accounting row is touched (0013 adds columns with defaults, it does not UPDATE immutable ledgers/documents). Tests: `tests/db/cases/30_hkd_profile.sql`, `31_hkd_sales.sql`, `32_hkd_vat_removal.sql`. 0014 does not UPDATE existing rows (only inserts the `accounting_mode=hkd` setting). Details and open decisions: `docs/hkd-compliance.md`.
