#!/usr/bin/env bash
# Runs all DB tests against the local shop_test database (build it first: scripts/local-db.sh up).
#   tests/db/run.sh            report; exit 0 unless a harness error / failed control
#   tests/db/run.sh --strict   also exit 1 if any weakness is CONFIRMED (use after the C2 fix migration)
# Verdicts: weakness -> CONFIRMED | NOT_REPRODUCIBLE ; control -> OK | FAIL ; info -> INFO
# NOTE: compatibility layer (plain Postgres + SET ROLE + request.jwt.claims), NOT real Supabase/PostgREST/GoTrue.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
strict=0; [ "${1:-}" = "--strict" ] && strict=1
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSERVICE DATABASE_URL
source <(bash "$ROOT/scripts/local-db.sh" env 2>/dev/null || true)
export PGHOST="${SHOP_PGSOCK:-/tmp/shop-manager-pg}" PGPORT="${SHOP_PGPORT:-54329}" PGOPTIONS="-c client_min_messages=warning"
pg_isready -q || { echo "cluster not running: run scripts/local-db.sh up" >&2; exit 2; }
psql -X -Atq -d postgres -c "select 1 from pg_database where datname='shop_test'" | grep -q 1 || { echo "shop_test missing: run scripts/local-db.sh up" >&2; exit 2; }
export PGDATABASE=shop_test

out=""; harness_err=0
for f in "$HERE"/cases/*; do
  case "$f" in
    *.sql) res="$(psql -X -Atq -v ON_ERROR_STOP=1 -f "$f" 2>&1)"; rc=$? ;;
    *.sh)  res="$(bash "$f" 2>&1)"; rc=$? ;;
    *) continue ;;
  esac
  if [ $rc -ne 0 ] || ! grep -q '^RESULT|' <<<"$res"; then
    echo "HARNESS ERROR in $(basename "$f"):"; echo "$res" | sed 's/^/    /'; harness_err=1; continue
  fi
  out+="$(grep '^RESULT|' <<<"$res")"$'\n'
done

printf '%-18s %-9s %-17s %s\n' ID KIND VERDICT DETAIL
printf '%-18s %-9s %-17s %s\n' ------------------ --------- ----------------- ------
while IFS='|' read -r _ id kind verdict detail; do
  [ -z "${id:-}" ] && continue
  printf '%-18s %-9s %-17s %s\n' "$id" "$kind" "$verdict" "$detail"
done <<<"$out"

conf=$(grep -c '|weakness|CONFIRMED|' <<<"$out"); nr=$(grep -c '|weakness|NOT_REPRODUCIBLE|' <<<"$out")
cok=$(grep -c '|control|OK|' <<<"$out"); cfail=$(grep -c '|control|FAIL|' <<<"$out")
echo; echo "SUMMARY: weaknesses CONFIRMED=$conf NOT_REPRODUCIBLE=$nr | controls OK=$cok FAIL=$cfail | harness errors=$harness_err"
[ $harness_err -ne 0 ] && exit 2
[ "$cfail" -ne 0 ] && exit 3
[ $strict -eq 1 ] && [ "$conf" -ne 0 ] && exit 1
exit 0
