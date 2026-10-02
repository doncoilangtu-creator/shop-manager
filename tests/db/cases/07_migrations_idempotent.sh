#!/usr/bin/env bash
# Control: migrations + seed claim to be idempotent -> re-apply on top of an already migrated DB.
# Runs in a throwaway database created from shop_test as template.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
DB=shop_idem_tmp
psql -X -q -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB template shop_test" >/dev/null 2>&1 || { echo "RESULT|MIG-idempotent|control|FAIL|could not create temp database"; exit 0; }
fails=""
for f in "$ROOT"/scripts/local-db/compat.sql $(ls "$ROOT"/supabase/migrations/*.sql | sort) "$ROOT"/supabase/seed.sql; do
  [ -f "$f" ] || continue
  psql -X -q -v ON_ERROR_STOP=1 -d $DB -1 -f "$f" >/dev/null 2>/tmp/idem.err || fails="$fails $(basename "$f")"
done
# seed twice more to make sure on conflict do nothing really holds
psql -X -q -v ON_ERROR_STOP=1 -d $DB -1 -f "$ROOT/supabase/seed.sql" >/dev/null 2>&1 || fails="$fails seed.sql(2nd)"
psql -X -q -d postgres -c "drop database if exists $DB with (force)" >/dev/null 2>&1
if [ -z "$fails" ]; then echo "RESULT|MIG-idempotent|control|OK|compat + 0001 + 0002 + seed re-applied (seed 2x) without error"
else echo "RESULT|MIG-idempotent|control|FAIL|re-apply failed for:$fails"; fi
