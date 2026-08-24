#!/usr/bin/env bash
# Safety dump taken immediately before a schema push.
#
# `drizzle-kit push --force` applies whatever it decides is needed WITHOUT
# asking, including destructive statements. A column rename in schema.ts is
# indistinguishable from "drop the old column, create a new one", and --force
# will do exactly that to a school's live database, with no undo.
#
# This takes a pg_dump right before that happens, so the worst case is a
# restore instead of a loss. Best-effort by design: a machine without pg_dump
# must still be able to start the app, so a failure warns and returns 0 rather
# than blocking the only way in.
#
# Usage: backup-before-schema.sh <repo root>

set -u

ROOT="${1:-}"
[ -n "$ROOT" ] || { echo "  ! backup-before-schema.sh: no root given"; exit 0; }

ENV_FILE="$ROOT/apps/backend/.env"
[ -f "$ENV_FILE" ] || { echo "  No apps/backend/.env yet - first run, nothing to protect."; exit 0; }

URL="$(sed -n 's/^[[:space:]]*DATABASE_URL[[:space:]]*=[[:space:]]*//p' "$ENV_FILE" | head -1 | tr -d '"'"'" | tr -d '\r')"
[ -n "$URL" ] || { echo "  No DATABASE_URL in .env - nothing to protect."; exit 0; }

# postgresql://user:pass@host:port/db  (port optional, credentials percent-encoded)
proto_removed="${URL#*://}"
creds="${proto_removed%%@*}"
hostpart="${proto_removed#*@}"

case "$URL" in
  postgresql://*|postgres://*) ;;
  *) echo "  ! DATABASE_URL is not a PostgreSQL URL - skipping the safety backup."; exit 0 ;;
esac

decode() { printf '%b' "${1//%/\\x}"; }

DB_USER="$(decode "${creds%%:*}")"
DB_PASS="$(decode "${creds#*:}")"
hostport="${hostpart%%/*}"
DB_HOST="${hostport%%:*}"
if [ "$hostport" = "$DB_HOST" ]; then DB_PORT=5432; else DB_PORT="${hostport#*:}"; fi
DB_NAME="${hostpart#*/}"
DB_NAME="${DB_NAME%%\?*}"

[ -n "$DB_NAME" ] || { echo "  ! DATABASE_URL names no database - skipping the safety backup."; exit 0; }

command -v pg_dump >/dev/null 2>&1 || {
  echo "  ! pg_dump not found - continuing WITHOUT a safety backup."
  echo "  ! If a schema change removes a column, that data cannot be recovered."
  exit 0
}

BACKUP_DIR="$ROOT/backups"
mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="$BACKUP_DIR/pre-schema-$STAMP.dump"

echo "  Safety backup before the schema sync..."
if PGPASSWORD="$DB_PASS" pg_dump -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -d "$DB_NAME" \
     --format=custom --no-owner --no-privileges -f "$TARGET" >/dev/null 2>&1 && [ -s "$TARGET" ]; then
  echo "  Saved backups/pre-schema-$STAMP.dump"
else
  echo "  ! Safety backup failed - continuing anyway so the app can start."
  rm -f "$TARGET"
  exit 0
fi

# Keep the five most recent; these are automatic and would otherwise pile up.
ls -1t "$BACKUP_DIR"/pre-schema-*.dump 2>/dev/null | tail -n +6 | while read -r old; do
  rm -f "$old"
done

exit 0
