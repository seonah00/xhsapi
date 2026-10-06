#!/usr/bin/env bash
# Boots an isolated stack on a fresh database (port 54330, web 3100), runs Playwright, tears down.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export TEST_PG_PORT=54330
export DATABASE_URL="postgresql://postgres@localhost/xhs_test?host=$ROOT/.tmp/pg&port=$TEST_PG_PORT"
export WEB_PORT="${WEB_PORT:-3100}"
export ASSET_STORAGE_DIR="$ROOT/.tmp/e2e-assets"
export APP_DATA_MODE=mock NEXT_TELEMETRY_DISABLED=1
LOG="$ROOT/.tmp/e2e"
PIDS=()
cleanup() {
  # Each service runs in its own session; kill the whole process group (next dev spawns next-server).
  for p in "${PIDS[@]:-}"; do [[ -n "$p" ]] && kill -- "-$p" 2>/dev/null || true; done
  wait 2>/dev/null || true
  bash scripts/with-test-db.sh true >/dev/null 2>&1 || true  # restarts+cleans the temp cluster
}
trap cleanup EXIT

bash scripts/with-test-db.sh --keep >/dev/null
pnpm -s tsx scripts/seed-demo.ts
mkdir -p "$LOG"
if [[ "${E2E_AUTH:-}" == "supabase" ]]; then
  # Real-login mode against a local fake Supabase (Auth + Storage); no external service is contacted.
  export FAKE_SUPABASE_PORT=54331 AUTH_PROVIDER=supabase STORAGE_BACKEND=supabase
  export NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:$FAKE_SUPABASE_PORT" NEXT_PUBLIC_SUPABASE_ANON_KEY=fake-anon-key-for-tests-only SUPABASE_SERVICE_ROLE_KEY=fake-service-role-key-for-tests-only
  export APP_BASE_URL="http://localhost:$WEB_PORT" SESSION_SECRET="$(head -c 48 /dev/urandom | base64 | tr -d '\n')"
  setsid pnpm -s tsx tests/support/fake-supabase.ts >"$LOG/fake-supabase.log" 2>&1 & PIDS+=($!)
  for _ in $(seq 1 30); do curl -s -o /dev/null "$NEXT_PUBLIC_SUPABASE_URL/" && break; sleep 0.5; done
  export E2E_ADMIN_EMAIL=ops-e2e@example.invalid
  E2E_ADMIN_LINK="$(pnpm -s bootstrap:org --org-name "E2E 조직" --admin-email "$E2E_ADMIN_EMAIL" | grep -o 'http[^ ]*set-password[^ ]*')"
  export E2E_ADMIN_LINK
fi
if curl -sf -o /dev/null "http://localhost:$WEB_PORT/login"; then echo "port $WEB_PORT is already in use" >&2; exit 1; fi
WORKER_POLL_MS=300 setsid pnpm -s tsx apps/worker/src/index.ts >"$LOG/worker.log" 2>&1 & PIDS+=($!)
# Default: production server (strict CSP, no dev tooling that phones home). E2E_DEV=1 uses next dev.
if [[ "${E2E_DEV:-}" == "1" ]]; then
  setsid bash -c "cd apps/web && exec npx next dev -p $WEB_PORT" >"$LOG/web.log" 2>&1 & PIDS+=($!)
else
  (cd apps/web && npx next build >"$LOG/build.log" 2>&1) || { tail -40 "$LOG/build.log" >&2; exit 1; }
  setsid bash -c "cd apps/web && exec npx next start -p $WEB_PORT" >"$LOG/web.log" 2>&1 & PIDS+=($!)
fi
for _ in $(seq 1 90); do curl -sf -o /dev/null "http://localhost:$WEB_PORT/login" && break; sleep 1; done
status=0
E2E_BASE_URL="http://localhost:$WEB_PORT" npx playwright test "$@" || status=$?
# Spec 12.2: the server-side guard logs every refused outbound connection; any entry fails the run.
if grep -h "\[network-guard\]" "$LOG/web.log" "$LOG/worker.log"; then echo "outbound network attempts detected in mock mode" >&2; status=1; else echo "network-guard: no outbound attempts (web, worker)"; fi
for svc in web worker; do grep -q "outbound network guard active ($svc)" "$LOG/$svc.log" || { echo "network guard was not active in $svc" >&2; status=1; }; done
exit $status
