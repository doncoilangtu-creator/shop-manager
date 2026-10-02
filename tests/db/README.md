# DB test harness (local Postgres, NOT Supabase)

Proves the *real* behaviour of the current `supabase/migrations/*.sql` (RLS + constraints) against a
throw-away local PostgreSQL, to back the audit findings (`F3`, `F7`, …) with executed evidence.
Nothing here talks to Supabase; `scripts/local-db.sh` unsets `PG*`/`DATABASE_URL`/`SUPABASE_*` and only uses
its own unix-socket cluster.

## Run
```bash
sudo apt-get install -y postgresql postgresql-contrib   # once (Debian/Ubuntu). No systemd needed.
bash scripts/local-db.sh up [--seed]   # private cluster + fresh DB `shop_test` + compat layer + all migrations
bash tests/db/run.sh                   # report; exit 0 (weaknesses are *expected* today)
bash tests/db/run.sh --strict          # exit 1 while any weakness is CONFIRMED -> use as the C2 "done" gate
bash scripts/local-db.sh psql          # interactive shell;  stop | status | url | env
```
Env: `SHOP_PGDATA` (default `~/.local/share/shop-manager/pgdata`), `SHOP_PGPORT` (54329), `SHOP_PGSOCK` (`/tmp/shop-manager-pg`), `KEEP_DB=1`.
`up` is idempotent: it drops/recreates `shop_test` every time (same end state).

## Status after C2 (migration 0003)
`bash tests/db/run.sh --strict` → `weaknesses CONFIRMED=0 NOT_REPRODUCIBLE=16 | controls OK=60 FAIL=0`; baseline (0001+0002 only,
`SHOP_MIGRATE_UPTO=0002 bash scripts/local-db.sh up`) → `CONFIRMED=16`. Same cases, same ids: the baseline run proves the
updated tests still detect every old weakness. Cases 08-13 are new controls for the RPCs, state machine, legacy upgrade and
parallel sessions (13 found and fixed a real deadlock in the first version of `sign_ticket`).

## How a test works
Each `cases/*.sql` runs in one transaction that is **rolled back**. Fixtures are inserted as superuser, then the test
does what PostgREST does: `SET LOCAL ROLE anon|authenticated|service_role` + `set_config('request.jwt.claims', …)`.
Every case prints `RESULT|id|kind|verdict|detail`:

| kind | verdicts | meaning |
|---|---|---|
| `weakness` | `CONFIRMED` / `NOT_REPRODUCIBLE` | the audit finding does / does not happen against the current schema |
| `control` | `OK` / `FAIL` | sanity check that the harness itself behaves (e.g. anon can NOT read other tables). A `FAIL` makes `run.sh` exit 3 |
| `info` | `INFO` | observation, no verdict |

After the fix migration (C2) the expectation flips: run with `--strict`, all weaknesses should become `NOT_REPRODUCIBLE`
(update/extend the cases that encode today's wrong behaviour, e.g. `F3c`, which currently *confirms* that a logged-in
owner cannot post a signature).

## Limitations (read before trusting a result)
* **Compatibility layer, not real Supabase.** `scripts/local-db/compat.sql` creates roles `anon`/`authenticated`/`service_role`
  (service_role = BYPASSRLS), `auth.users`, `auth.uid()/role()/jwt()` reading `request.jwt.claims`, and the default
  `GRANT ALL ON public.*` that Supabase gives those roles. No GoTrue, no JWT signature checking, no PostgREST (so
  e.g. `return=representation`, filter parsing, `db-max-rows`, column privileges set by the dashboard are **not** exercised),
  no Storage (`quotations` bucket policy/`public:true` finding F9 is not testable here), no Realtime, no `supabase_admin` owner.
* Real Supabase projects may differ from the defaults replicated here (e.g. if privileges were revoked in the dashboard).
  Re-verify critical findings (F3) on a disposable Supabase *test* project before relying on them.
* Tests cover only what is observable in SQL. App-level findings (F1 missing `getUser()`, F4 bot webhook, F8, F10, F17 …)
  are out of scope. `F14-lowstock` proves the SQL error for `stock_qty <= 'min_stock'`, **not** the exact PostgREST request.
* `F3c` (logged-in owner cannot sign via anon route) shows the DB-level cause only (no `authenticated` INSERT policy on
  `signatures`); whether `/api/sign/[token]` uses an anon or admin client was not tested here.
