#!/bin/sh
set -e

echo "[entrypoint] applying database migrations..."
cd /app/apps/backend
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