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
