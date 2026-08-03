#!/usr/bin/env bash
# ============================================================
#  IQ Academy - Database Backup (macOS / Linux)
#
#  Writes a timestamped, compressed dump into backups/.
#  Called automatically by the launcher, and on demand via backup.bat/backup.sh.
# ============================================================
set -euo pipefail

QUIET=false
KEEP=30

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --quiet|-q) QUIET=true; shift ;;
    --keep)     KEEP="$2"; shift 2 ;;
    *)          shift ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_ENV="$ROOT_DIR/apps/backend/.env"
BACKUP_DIR="$ROOT_DIR/backups"

ok()   { [[ "$QUIET" == "false" ]] && printf "  \033[32m✓\033[0m  %s\n" "$1" || true; }
warn() { printf "  \033[33m!\033[0m  %s\n" "$1"; }

# Parse DATABASE_URL
DATABASE_URL=$(grep -E '^\s*DATABASE_URL\s*=' "$BACKEND_ENV" 2>/dev/null | tail -1 | sed 's/^[^=]*=\s*//')
[[ -z "$DATABASE_URL" ]] && { echo "DATABASE_URL is missing from apps/backend/.env"; exit 1; }

if [[ "$DATABASE_URL" =~ postgresql://([^:]+):([^@]+)@([^:]+):([0-9]+)/([^?]+) ]]; then
  DB_USER="${BASH_REMATCH[1]}"; DB_PASS="${BASH_REMATCH[2]}"
  DB_HOST="${BASH_REMATCH[3]}"; DB_PORT="${BASH_REMATCH[4]}"; DB_NAME="${BASH_REMATCH[5]}"
else
  echo "DATABASE_URL is not a valid PostgreSQL connection string"; exit 1
fi

# Find pg_dump
PG_DUMP=""
if command -v pg_dump &>/dev/null; then PG_DUMP="pg_dump"; fi
# macOS Homebrew paths
for candidate in /opt/homebrew/opt/postgresql@16/bin/pg_dump /usr/local/opt/postgresql@16/bin/pg_dump; do
  [[ -x "$candidate" ]] && PG_DUMP="$candidate" && break
done
[[ -z "$PG_DUMP" ]] && { echo "pg_dump not found - run start.sh once to set PostgreSQL up."; exit 1; }

mkdir -p "$BACKUP_DIR"

stamp=$(date +%Y%m%d_%H%M%S)
target="$BACKUP_DIR/iq-academy-${stamp}.dump"

[[ "$QUIET" == "false" ]] && printf "  Backing up '%s' -> backups/iq-academy-%s.dump\n" "$DB_NAME" "$stamp"

export PGPASSWORD="$DB_PASS"
if $PG_DUMP -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -d "$DB_NAME" -Fc -f "$target" 2>/dev/null; then
  unset PGPASSWORD
  size_kb=$(du -k "$target" | cut -f1)
  ok "Backup complete (${size_kb} KB)"
else
  unset PGPASSWORD
  echo "pg_dump failed"; exit 1
fi

# Prune oldest dumps
dumps=($(ls -t "$BACKUP_DIR"/iq-academy-*.dump 2>/dev/null || true))
if [[ ${#dumps[@]} -gt $KEEP ]]; then
  for ((i=KEEP; i<${#dumps[@]}; i++)); do
    rm -f "${dumps[$i]}" && [[ "$QUIET" == "false" ]] && ok "Pruned $(basename "${dumps[$i]}")"
  done
fi
