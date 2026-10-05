#!/usr/bin/env bash
# Starts a throwaway local PostgreSQL 16, applies the Supabase shim, migrations
# and seed, then runs the given command with DATABASE_URL set.
# Usage: scripts/with-test-db.sh <command...>   |   scripts/with-test-db.sh --keep
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
TMP="$ROOT/.tmp/pg"
PORT="${TEST_PG_PORT:-54329}"
KEEP=0
if [[ "${1:-}" == "--keep" ]]; then KEEP=1; shift; fi

as_pg() {
  if [[ "$(id -u)" == "0" ]]; then runuser -u postgres -- "$@"; else "$@"; fi
}

cleanup() {
  if [[ "$KEEP" == "0" ]]; then
    as_pg "$PGBIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true
    rm -rf "$TMP"
  fi
}
trap cleanup EXIT

as_pg "$PGBIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true
rm -rf "$TMP"
mkdir -p "$TMP"
[[ "$(id -u)" == "0" ]] && chown -R postgres "$TMP"
as_pg "$PGBIN/initdb" -D "$TMP/data" -U postgres -A trust --locale=C.UTF-8 -E UTF8 >/dev/null
as_pg "$PGBIN/pg_ctl" -D "$TMP/data" -l "$TMP/log" -o "-p $PORT -k $TMP -c listen_addresses=''" -w start >/dev/null

PSQL=(psql -v ON_ERROR_STOP=1 -q -h "$TMP" -p "$PORT" -U postgres)
"${PSQL[@]}" -c "create database xhs_test" postgres
for f in "$ROOT/supabase/test/00_supabase_shim.sql" "$ROOT"/supabase/migrations/*.sql "$ROOT/supabase/seed.sql"; do
  "${PSQL[@]}" -d xhs_test -f "$f" || { echo "failed applying $f" >&2; exit 1; }
done

export DATABASE_URL="postgresql://postgres@localhost/xhs_test?host=$TMP&port=$PORT"
if [[ "$KEEP" == "1" ]]; then
  echo "Database ready: $DATABASE_URL (stop with: pg_ctl -D $TMP/data stop)"
  exit 0
fi
"$@"
