#!/bin/sh
set -e

echo "[entrypoint] applying database migrations..."
cd /app/apps/backend

# A schema push never asks before dropping something, so dump first — the same
# safety net the native launchers get from backup-before-schema. Best-effort:
# nothing here may stop the container from starting.
echo "[entrypoint] safety dump before schema sync (best-effort)..."
mkdir -p /app/backups || true
SAFETY_DUMP="/app/backups/pre-entrypoint-$(date -u +%Y%m%dT%H%M%SZ).dump"
if [ -n "$DATABASE_URL" ]; then
  if pg_dump "$DATABASE_URL" -Fc --no-owner -f "$SAFETY_DUMP" 2>/dev/null; then
    echo "[entrypoint] safety dump at $SAFETY_DUMP"
  else
    echo "[entrypoint] safety dump failed - continuing (pg_dump missing or DB unreachable)"
  fi
  ls -t /app/backups/pre-entrypoint-*.dump 2>/dev/null | tail -n +6 | xargs -r rm -f || true
else
  echo "[entrypoint] no DATABASE_URL - skipping safety dump"
fi

pnpm exec drizzle-kit migrate || echo "[entrypoint] migrate exited non-zero - continuing to push"
psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm" || echo "[entrypoint] pg_trgm extension failed - continuing"
pnpm db:push --force || echo "[entrypoint] push exited non-zero - continuing"
echo "[entrypoint] seeding super_admin..."
pnpm db:seed

echo "[entrypoint] starting backend on :3001..."
PORT=3001 node dist/main &
BACKEND_PID=$!

echo "[entrypoint] starting frontend on :${PORT:-3000}..."
cd /app/apps/frontend
exec pnpm exec next start -p "${PORT:-3000}"