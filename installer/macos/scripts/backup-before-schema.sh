#!/usr/bin/env bash
# Safety dump taken immediately before a schema push - and a GATE, not a
# best-effort note.
#
# The update engine never passes --force to drizzle-kit anymore (a destructive
# change aborts the update instead), but even an additive push can fail
# half-way through a long ALTER on a school's live database. This dump is the
# rollback artifact for that worst case, taken while the servers are stopped.
#
# The dump must succeed and produce a verifiable artifact (exists, > 1 KB) or
# the script exits 1 and the update aborts before any schema change. Support
# can bypass the gate in an emergency with SKIP_PRESCHEMA_GUARD=1 in
# apps/backend/.env - the skip is logged so it is never silent.
#
# Result contract (logs/pre-schema-result.json):
#   { "ok": true|false, "path": "backups/pre-schema-<stamp>.dump"|null,
#     "sizeMB": number|null, "reason": "...", "createdAt": iso8601 }
#
# Usage: backup-before-schema.sh <repo root>

set -u

ROOT="${1:-}"
[ -n "$ROOT" ] || { echo "  ! backup-before-schema.sh: no root given"; exit 1; }

LOGS_DIR="$ROOT/logs"
mkdir -p "$LOGS_DIR" 2>/dev/null

RESULT_FILE="$LOGS_DIR/pre-schema-result.json"
write_result() {
  # write_result <ok true|false> <path or null> <sizeMB or null> <reason>
  printf '{"ok":%s,"path":%s,"sizeMB":%s,"reason":"%s","createdAt":"%s"}\n' \
    "$1" "$2" "$3" "$4" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$RESULT_FILE" 2>/dev/null || true
}

finish_fail() {
  echo "  ! $1"
  write_result false null null "$2"
  if [[ "${SKIP_PRESCHEMA_GUARD:-}" == "1" ]]; then
    echo "  ! SKIP_PRESCHEMA_GUARD=1 is set - continuing WITHOUT a safety backup (support override)."
    exit 0
  fi
  [ -n "${3:-}" ] && echo "  ! $3"
  exit 1
}

ENV_FILE="$ROOT/apps/backend/.env"
[ -f "$ENV_FILE" ] || { echo "  No apps/backend/.env yet - first run, nothing to protect."; write_result true null null "no-env-first-run"; exit 0; }

URL="$(sed -n 's/^[[:space:]]*DATABASE_URL[[:space:]]*=[[:space:]]*//p' "$ENV_FILE" | head -1 | tr -d '"' | tr -d "'" | tr -d '\r')"
[ -n "$URL" ] || { echo "  No DATABASE_URL in .env - nothing to protect."; write_result true null null "no-database-url"; exit 0; }

case "$URL" in
  postgresql://*|postgres://*) ;;
  *) finish_fail "DATABASE_URL is not a PostgreSQL URL - cannot take the safety backup." "not-postgres-url" "Fix apps/backend/.env, or set SKIP_PRESCHEMA_GUARD=1 there to update without the backup." ;;
esac

# postgresql://user:pass@host:port/db  (port optional, credentials percent-encoded)
proto_removed="${URL#*://}"
creds="${proto_removed%%@*}"
hostpart="${proto_removed#*@}"

decode() { printf '%b' "${1//%/\\x}"; }

DB_USER="$(decode "${creds%%:*}")"
DB_PASS="$(decode "${creds#*:}")"
hostport="${hostpart%%/*}"
DB_HOST="${hostport%%:*}"
if [ "$hostport" = "$DB_HOST" ]; then DB_PORT=5432; else DB_PORT="${hostport#*:}"; fi
DB_NAME="${hostpart#*/}"
DB_NAME="${DB_NAME%%\?*}"

[ -n "$DB_NAME" ] || finish_fail "DATABASE_URL names no database - cannot take the safety backup." "no-database" "Fix apps/backend/.env, or set SKIP_PRESCHEMA_GUARD=1 there to update without the backup."

command -v pg_dump >/dev/null 2>&1 || finish_fail "pg_dump not found - the update cannot run without a safety backup." "no-pg-dump" "Install PostgreSQL client tools, or set SKIP_PRESCHEMA_GUARD=1 in apps/backend/.env to accept the risk."

# Skip when the database doesn't exist yet or is empty (first run).
TABLE_COUNT="$(PGPASSWORD="$DB_PASS" psql -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -w -d "$DB_NAME" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null)" \
  || finish_fail "Cannot reach the database '$DB_NAME' to take the safety backup." "database-unreachable" "Start PostgreSQL and try the update again."

if ! [[ "$TABLE_COUNT" =~ ^[0-9]+$ ]] || [ "$TABLE_COUNT" -eq 0 ]; then
  echo "  Database '$DB_NAME' is empty or not initialized yet - safety backup skipped."
  write_result true null null "empty-database"
  exit 0
fi

BACKUP_DIR="$ROOT/backups"
mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="$BACKUP_DIR/pre-schema-$STAMP.dump"

echo "  Safety backup before the schema sync..."
if PGPASSWORD="$DB_PASS" pg_dump -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -d "$DB_NAME" \
     --format=custom --no-owner --no-privileges -f "$TARGET" >/dev/null 2>&1 && [ -s "$TARGET" ]; then
  SIZE_BYTES=$(wc -c < "$TARGET" | tr -d ' ')
  if [ "$SIZE_BYTES" -lt 1024 ]; then
    rm -f "$TARGET"
    finish_fail "The safety backup produced a suspiciously small file ($SIZE_BYTES bytes) - treating it as failed." "dump-too-small" "The update stops here - nothing was changed."
  fi
  SIZE_MB=$(awk -v b="$SIZE_BYTES" 'BEGIN { printf "%.1f", b / 1048576 }')
  echo "  Saved backups/pre-schema-$STAMP.dump ($SIZE_MB MB)"
  write_result true "\"backups/pre-schema-$STAMP.dump\"" "$SIZE_MB" "verified"
else
  rm -f "$TARGET" 2>/dev/null
  finish_fail "The safety backup FAILED." "dump-failed" "The update stops here - nothing was changed. Check that PostgreSQL is running, then try the update again."
fi

# Keep the five most recent; these are automatic and would otherwise pile up.
ls -1t "$BACKUP_DIR"/pre-schema-*.dump 2>/dev/null | tail -n +6 | while read -r old; do
  rm -f "$old"
done

exit 0
