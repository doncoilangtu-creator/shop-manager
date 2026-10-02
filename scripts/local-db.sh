#!/usr/bin/env bash
# Local PostgreSQL test database for shop-manager (NOT Supabase).
#
#   scripts/local-db.sh [up] [--seed]   (re)create DB `shop_test` = compat layer + all migrations
#   scripts/local-db.sh start|stop|status|psql [args]|url|env
#   scripts/local-db.sh reset [--seed]  same as `up`
#
# - Runs its own private cluster (no systemd, no root): PGDATA=$SHOP_PGDATA,
#   unix socket only (no TCP), port $SHOP_PGPORT.  Requires `postgresql` apt
#   package (initdb/pg_ctl under /usr/lib/postgresql/*/bin).
# - Idempotent: running it again drops and recreates shop_test (same end state).
#   Set KEEP_DB=1 to skip recreation when the DB already exists.
# - Safety: ignores PG*/DATABASE_URL env so it can never talk to Supabase/remote.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHOP_PGDATA="${SHOP_PGDATA:-$HOME/.local/share/shop-manager/pgdata}"
SHOP_PGPORT="${SHOP_PGPORT:-54329}"
SHOP_PGSOCK="${SHOP_PGSOCK:-/tmp/shop-manager-pg}"
DB_NAME="shop_test"

unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSERVICE PGSERVICEFILE PGPASSFILE DATABASE_URL SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY
export PGHOST="$SHOP_PGSOCK" PGPORT="$SHOP_PGPORT" PGOPTIONS="-c client_min_messages=warning"

PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "${PGBIN:-/nonexistent}/initdb" ] || { echo "PostgreSQL server binaries not found. Install: sudo apt-get install -y postgresql postgresql-contrib" >&2; exit 2; }
export PATH="$PGBIN:$PATH"

log() { echo "[local-db] $*" >&2; }
running() { pg_isready -q -h "$SHOP_PGSOCK" -p "$SHOP_PGPORT"; }

start_cluster() {
  mkdir -p "$SHOP_PGSOCK"
  if [ ! -s "$SHOP_PGDATA/PG_VERSION" ]; then
    log "initdb $SHOP_PGDATA"
    mkdir -p "$SHOP_PGDATA"
    initdb -D "$SHOP_PGDATA" -A trust -E UTF8 --locale=C.UTF-8 --no-instructions >/dev/null
  fi
  if running; then log "cluster already running (port $SHOP_PGPORT)"; return; fi
  log "starting cluster on socket $SHOP_PGSOCK port $SHOP_PGPORT"
  pg_ctl -D "$SHOP_PGDATA" -l "$SHOP_PGDATA/server.log" -w -t 60 \
    -o "-c listen_addresses='' -c unix_socket_directories=$SHOP_PGSOCK -c port=$SHOP_PGPORT -c fsync=off -c synchronous_commit=off -c full_page_writes=off" start >/dev/null
}

stop_cluster() {
  if [ -s "$SHOP_PGDATA/PG_VERSION" ] && running; then pg_ctl -D "$SHOP_PGDATA" -m fast -w stop >/dev/null && log "stopped"; else log "not running"; fi
}

psql_admin() { psql -X -q -v ON_ERROR_STOP=1 -d postgres "$@"; }
psql_db()    { psql -X -q -v ON_ERROR_STOP=1 -d "$DB_NAME" "$@"; }

build_db() {
  local seed="$1"
  if [ "${KEEP_DB:-0}" = 1 ] && psql_admin -Atc "select 1 from pg_database where datname='$DB_NAME'" | grep -q 1; then
    log "KEEP_DB=1 and $DB_NAME exists: not recreating"; return
  fi
  log "recreating database $DB_NAME"
  psql_admin -c "drop database if exists $DB_NAME with (force)" -c "create database $DB_NAME"
  # compat layer first (roles, auth schema, default privileges), then migrations in filename order
  log "applying compat layer"
  psql_db -1 -f "$ROOT/scripts/local-db/compat.sql"
  local f
  for f in $(ls "$ROOT"/supabase/migrations/*.sql | sort); do
    log "migration $(basename "$f")"
    psql_db -1 -f "$f"
  done
  if [ "$seed" = 1 ] && [ -f "$ROOT/supabase/seed.sql" ]; then
    log "seed.sql"; psql_db -1 -f "$ROOT/supabase/seed.sql"
  fi
  log "OK: $DB_NAME ready. Connect: $0 psql"
}

cmd="${1:-up}"; [ $# -gt 0 ] && shift || true
case "$cmd" in
  up|reset)
    seed=0; for a in "$@"; do [ "$a" = "--seed" ] && seed=1; done
    start_cluster; build_db "$seed" ;;
  start)  start_cluster ;;
  stop)   stop_cluster ;;
  status) if running; then echo "running (socket=$SHOP_PGSOCK port=$SHOP_PGPORT data=$SHOP_PGDATA)"; else echo "stopped"; exit 1; fi ;;
  psql)   start_cluster; exec psql -X -d "$DB_NAME" "$@" ;;
  env)    echo "SHOP_PGSOCK=$SHOP_PGSOCK SHOP_PGPORT=$SHOP_PGPORT" ;;
  url)    echo "postgresql:///$DB_NAME?host=$SHOP_PGSOCK&port=$SHOP_PGPORT" ;;
  *) echo "usage: $0 [up|reset] [--seed] | start | stop | status | psql [args] | url | env" >&2; exit 64 ;;
esac
