#!/usr/bin/env bash
# ============================================================
#  IQ Academy - Database Restore (macOS / Linux)
#
#  Restores from a backup produced by backup.sh.
#  REPLACES the current database. Takes a safety dump first.
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_ENV="$ROOT_DIR/apps/backend/.env"
BACKUP_DIR="$ROOT_DIR/backups"

ok()   { printf "  \033[32m✓\033[0m  %s\n" "$1"; }
warn() { printf "  \033[33m!\033[0m  %s\n" "$1"; }
fail() { printf "  \033[31m✗\033[0m  %s\n" "$1"; exit 1; }

# Parse DATABASE_URL
DATABASE_URL=$(grep -E '^\s*DATABASE_URL\s*=' "$BACKEND_ENV" 2>/dev/null | tail -1 | sed 's/^[^=]*=\s*//')
[[ -z "$DATABASE_URL" ]] && fail "DATABASE_URL is missing from apps/backend/.env"

if [[ "$DATABASE_URL" =~ postgresql://([^:]+):([^@]+)@([^:]+):([0-9]+)/([^?]+) ]]; then
  DB_USER="${BASH_REMATCH[1]}"; DB_PASS="${BASH_REMATCH[2]}"
  DB_HOST="${BASH_REMATCH[3]}"; DB_PORT="${BASH_REMATCH[4]}"; DB_NAME="${BASH_REMATCH[5]}"
else
  fail "DATABASE_URL is not a valid PostgreSQL connection string"
fi

# Find pg_restore
PG_RESTORE=""
if command -v pg_restore &>/dev/null; then PG_RESTORE="pg_restore"; fi
for candidate in /opt/homebrew/opt/postgresql@16/bin/pg_restore /usr/local/opt/postgresql@16/bin/pg_restore; do
  [[ -x "$candidate" ]] && PG_RESTORE="$candidate" && break
done
[[ -z "$PG_RESTORE" ]] && fail "pg_restore not found - run start.sh once to set PostgreSQL up."

# Select backup file
BACKUP_FILE="${1:-}"
if [[ -z "$BACKUP_FILE" ]]; then
  dumps=($(ls -t "$BACKUP_DIR"/iq-academy-*.dump 2>/dev/null || true))
  if [[ ${#dumps[@]} -eq 0 ]]; then fail "No backups found in backups/"; fi

  echo ""
  echo "Available backups (newest first):"
  echo ""
  for i in "${!dumps[@]}"; do
    d="${dumps[$i]}"
    size=$(du -k "$d" | cut -f1)
    printf "  [%d]  %s   %s   %s KB\n" "$i" "$(basename "$d")" "$(date -r "$d" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || stat -f '%Sm' -t '%Y-%m-%d %H:%M:%S' "$d" 2>/dev/null)" "$size"
  done
  echo ""
  read -rp "Enter the number of the backup to restore (or press Enter to cancel): " choice
  [[ -z "$choice" ]] && { echo "Cancelled."; exit 0; }

  if ! [[ "$choice" =~ ^[0-9]+$ ]] || ((choice < 0 || choice >= ${#dumps[@]})); then
    fail "'$choice' isn't one of the listed numbers"
  fi
  BACKUP_FILE="${dumps[$choice]}"
fi

[[ ! -f "$BACKUP_FILE" ]] && fail "Backup file not found: $BACKUP_FILE"

echo ""
echo "  About to REPLACE the contents of database '$DB_NAME'" | head -c 200
echo ""
echo "  with: $(basename "$BACKUP_FILE")"
echo "  Everything currently in the database will be overwritten."
echo ""
read -rp "Type RESTORE to continue: " confirm
[[ "$confirm" != "RESTORE" ]] && { echo "Cancelled."; exit 0; }

# Safety backup
echo ""
echo "Taking a safety backup of the current database first..."
"$SCRIPT_DIR/backup.sh" --quiet 2>/dev/null && ok "Safety backup saved to backups/" || warn "Safety backup skipped"

# Restore
echo ""
echo "Restoring..."
export PGPASSWORD="$DB_PASS"
$PG_RESTORE -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -d "$DB_NAME" --clean --if-exists --no-owner "$BACKUP_FILE" 2>/dev/null
unset PGPASSWORD

echo ""
ok "Restore complete. Restart the app with start.sh."
echo ""
