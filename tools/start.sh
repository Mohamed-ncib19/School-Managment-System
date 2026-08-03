#!/usr/bin/env bash
# ============================================================
#  IQ Academy - Start All Servers (macOS / Linux)
#
#  Starts PostgreSQL, installs dependencies, applies migrations,
#  seeds the admin account, and launches the API + web portal.
#
#  Run via:  ./tools/start.sh
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/apps/backend"
FRONTEND_DIR="$ROOT_DIR/apps/frontend"
LOG_DIR="$ROOT_DIR/logs"
BACKUP_DIR="$ROOT_DIR/backups"
ROOT_SCRIPTS="$ROOT_DIR/scripts"

BACKEND_PORT=3001
FRONTEND_PORT=3000

# --- console helpers -------------------------------------------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'
CYAN='\033[0;36m'; DIM='\033[0;90m'; BOLD='\033[1;37m'; NC='\033[0m'

step_i=0; step_total=7; ui_start=$(date +%s)

banner() {
  printf '\n  ┌──────────────────────────────────────────────────────┐\n'
  printf '  │  %-50s │\n' "$1"
  [[ -n "${2:-}" ]] && printf '  │  %-50s │\n' "$2"
  printf '  └──────────────────────────────────────────────────────┘\n\n'
}

write_step() {
  step_i=$((step_i + 1))
  local bar_w=20
  local filled=$(( step_i * bar_w / step_total ))
  local empty=$(( bar_w - filled ))
  local bar=""
  for ((i=0; i<filled; i++)); do bar+="█"; done
  for ((i=0; i<empty; i++)); do bar+="░"; done
  printf "\n  [%d/%d] %s  %s\n" "$step_i" "$step_total" "$bar" "$1"
}

ok()   { printf "         ${GREEN}✓${NC}  %s" "$1"; [[ -n "${2:-}" ]] && printf "  %s" "$2"; printf "\n"; }
warn() { printf "         ${YELLOW}!${NC}  %s\n" "$1"; }
info() { printf "            %s\n" "$1"; }
fail() {
  printf "\n  ${RED}STARTUP FAILED${NC} %s\n" "$1"
  [[ -n "${2:-}" ]] && printf "  %s\n" "$2"
  exit 1
}

elapsed() {
  local now=$(date +%s) diff=$((now - ui_start))
  if ((diff >= 60)); then printf "%dm %ds" $((diff/60)) $((diff%60))
  else printf "%ds" "$diff"; fi
}

test_port() {
  if command -v nc &>/dev/null; then
    nc -z 127.0.0.1 "$1" 2>/dev/null
  elif command -v lsof &>/dev/null; then
    lsof -i :"$1" -sTCP:LISTEN &>/dev/null
  elif command -v ss &>/dev/null; then
    ss -tln | grep -q ":$1 " 2>/dev/null
  elif command -v netstat &>/dev/null; then
    netstat -tln 2>/dev/null | grep -q ":$1 "
  else
    return 1
  fi
}

get_env() {
  local file="$1" key="$2"
  grep -E "^\s*${key}\s*=" "$file" 2>/dev/null | tail -1 | sed "s/^[^=]*=\s*//"
}

# ===========================================================================
#  BANNER
# ===========================================================================
clear 2>/dev/null || true
banner "IQ ACADEMY" "School Management System"

# ===========================================================================
#  1. TOOLCHAIN
# ===========================================================================
write_step "Checking prerequisites"

if ! command -v node &>/dev/null; then
  fail "Node.js is not installed." "Install from https://nodejs.org"
fi
ok "Node.js" "$(node --version)"

if ! command -v pnpm &>/dev/null; then
  info "pnpm not found - enabling via corepack..."
  if command -v corepack &>/dev/null; then
    corepack enable pnpm 2>/dev/null || true
    corepack prepare pnpm@latest --activate 2>/dev/null || true
  fi
  if ! command -v pnpm &>/dev/null; then
    npm install -g pnpm 2>/dev/null || true
  fi
  if ! command -v pnpm &>/dev/null; then
    fail "Could not install pnpm." "Run: npm install -g pnpm"
  fi
fi
ok "pnpm" "$(pnpm --version)"

# ===========================================================================
#  2. CONFIGURATION
# ===========================================================================
write_step "Reading configuration"

BACKEND_ENV="$BACKEND_DIR/.env"
FRONTEND_ENV="$FRONTEND_DIR/.env.local"

if [[ ! -f "$BACKEND_ENV" ]]; then
  EXAMPLE="$BACKEND_DIR/.env.example"
  if [[ -f "$EXAMPLE" ]]; then
    cp "$EXAMPLE" "$BACKEND_ENV"
    ok "Created apps/backend/.env from .env.example"
  else
    fail "apps/backend/.env is missing." "Create it with a DATABASE_URL line."
  fi
fi

if [[ ! -f "$FRONTEND_ENV" ]]; then
  EXAMPLE="$FRONTEND_DIR/.env.example"
  if [[ -f "$EXAMPLE" ]]; then
    cp "$EXAMPLE" "$FRONTEND_ENV"
    ok "Created apps/frontend/.env.local from .env.example"
  fi
fi

DATABASE_URL=$(get_env "$BACKEND_ENV" "DATABASE_URL")
if [[ -z "$DATABASE_URL" ]]; then
  fail "DATABASE_URL is missing from apps/backend/.env"
fi

if [[ "$DATABASE_URL" =~ postgresql://([^:]+):([^@]+)@([^:]+):([0-9]+)/([^?]+) ]]; then
  DB_USER="${BASH_REMATCH[1]}"
  DB_PASS="${BASH_REMATCH[2]}"
  DB_HOST="${BASH_REMATCH[3]}"
  DB_PORT="${BASH_REMATCH[4]}"
  DB_NAME="${BASH_REMATCH[5]}"
else
  fail "DATABASE_URL is not a valid PostgreSQL connection string."
fi
ok "Database target" "$DB_NAME @ $DB_HOST:$DB_PORT"

# ===========================================================================
#  3. POSTGRESQL
# ===========================================================================
write_step "Starting PostgreSQL"

pg_ok=false

if test_port "$DB_PORT"; then
  ok "PostgreSQL already running" "port $DB_PORT"
  pg_ok=true
fi

if [[ "$pg_ok" == "false" ]]; then
  # macOS: Homebrew
  if command -v brew &>/dev/null; then
    for svc in postgresql@16 postgresql@15 postgresql; do
      if brew list "$svc" &>/dev/null 2>&1; then
        brew services start "$svc" 2>/dev/null || true
        sleep 2
        if test_port "$DB_PORT"; then
          ok "PostgreSQL started via Homebrew" "port $DB_PORT"
          pg_ok=true; break
        fi
      fi
    done
  fi
fi

if [[ "$pg_ok" == "false" ]]; then
  # Linux: systemd
  if command -v systemctl &>/dev/null; then
    for svc in postgresql@16 postgresql@15 postgresql; do
      if systemctl list-unit-files 2>/dev/null | grep -q "$svc"; then
        sudo systemctl start "$svc" 2>/dev/null || true
        sleep 2
        if test_port "$DB_PORT"; then
          ok "PostgreSQL started via systemd" "port $DB_PORT"
          pg_ok=true; break
        fi
      fi
    done
  fi
fi

if [[ "$pg_ok" == "false" ]] && command -v pg_isready &>/dev/null; then
  pg_isready -h "$DB_HOST" -p "$DB_PORT" &>/dev/null && pg_ok=true && ok "PostgreSQL accepting connections" "port $DB_PORT"
fi

if [[ "$pg_ok" == "false" ]]; then
  fail "PostgreSQL is not running on port $DB_PORT." \
    "Install: brew install postgresql@16 (macOS) or apt install postgresql (Linux)"
fi

# Create role + database on first run
if command -v psql &>/dev/null; then
  export PGPASSWORD="$DB_PASS"
  tables=$(psql -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -d "$DB_NAME" -tAc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null || echo "-1")

  if [[ "$tables" == "-1" ]]; then
    info "Application login failed - setting up the role and database..."
    SUPER_PASS="${POSTGRES_SUPERUSER_PASSWORD:-iq_academy_local}"
    export PGPASSWORD="$SUPER_PASS"

    role_exists=$(psql -U postgres -h "$DB_HOST" -p "$DB_PORT" -tAc \
      "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" 2>/dev/null || echo "")
    if [[ "$role_exists" != "1" ]]; then
      psql -U postgres -h "$DB_HOST" -p "$DB_PORT" -c \
        "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS' CREATEDB" 2>/dev/null && \
        ok "Created role $DB_USER" || warn "Could not create role $DB_USER"
    fi

    db_exists=$(psql -U postgres -h "$DB_HOST" -p "$DB_PORT" -tAc \
      "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" 2>/dev/null || echo "")
    if [[ "$db_exists" != "1" ]]; then
      psql -U postgres -h "$DB_HOST" -p "$DB_PORT" -c \
        "CREATE DATABASE $DB_NAME OWNER $DB_USER" 2>/dev/null && \
        ok "Created database $DB_NAME" || warn "Could not create database $DB_NAME"
    fi
    unset PGPASSWORD
  else
    ok "Connected to '$DB_NAME'" "$tables tables"
  fi
  unset PGPASSWORD
else
  warn "psql not found - skipping the database check (Prisma will report any problem)"
fi

# ===========================================================================
#  4. DEPENDENCIES
# ===========================================================================
write_step "Checking dependencies"

needs_install=false
[[ ! -d "$ROOT_DIR/node_modules" ]] && needs_install=true
[[ ! -d "$BACKEND_DIR/node_modules" ]] && needs_install=true
[[ ! -d "$FRONTEND_DIR/node_modules" ]] && needs_install=true

if [[ "$needs_install" == "true" ]]; then
  info "Installing packages (the first run takes a few minutes)..."
  (cd "$ROOT_DIR" && pnpm install) || fail "pnpm install failed."
  ok "Packages installed"
else
  ok "Packages up to date"
fi

# ===========================================================================
#  5. SAFETY BACKUP
# ===========================================================================
write_step "Safety backup"

if [[ -x "$ROOT_SCRIPTS/backup.sh" ]]; then
  "$ROOT_SCRIPTS/backup.sh" --quiet 2>/dev/null || warn "Backup skipped"
elif command -v pg_dump &>/dev/null; then
  mkdir -p "$BACKUP_DIR"
  ts=$(date +%Y%m%d_%H%M%S)
  dump_file="$BACKUP_DIR/iq-academy-${ts}.dump"
  export PGPASSWORD="$DB_PASS"
  pg_dump -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -Fc -f "$dump_file" "$DB_NAME" 2>/dev/null && \
    ok "Snapshot saved" "$(basename "$dump_file")" || warn "Backup skipped"
  unset PGPASSWORD
else
  warn "pg_dump not found - backup skipped"
fi

# ===========================================================================
#  6. MIGRATIONS
# ===========================================================================
write_step "Applying database migrations"

(cd "$BACKEND_DIR" && pnpm exec prisma generate 2>&1 | tail -1) || fail "prisma generate failed."
ok "Prisma client generated"

(cd "$BACKEND_DIR" && pnpm exec prisma migrate deploy 2>&1)
[[ $? -eq 0 ]] || fail "Migrations could not be applied."
ok "Database schema is up to date"

(cd "$BACKEND_DIR" && pnpm run db:seed 2>&1 | tail -1)
ok "Administrator account ready"

# ===========================================================================
#  7. START SERVERS
# ===========================================================================
write_step "Starting servers"

mkdir -p "$LOG_DIR"

api_up=false; web_up=false
test_port "$BACKEND_PORT" && api_up=true
test_port "$FRONTEND_PORT" && web_up=true

if [[ "$api_up" == "true" ]]; then
  ok "API already running" "port $BACKEND_PORT"
else
  (cd "$BACKEND_DIR" && nohup pnpm run start:dev > "$LOG_DIR/backend.log" 2>&1 &)
  ok "API starting" "port $BACKEND_PORT"
fi

if [[ "$web_up" == "true" ]]; then
  ok "Web portal already running" "port $FRONTEND_PORT"
else
  (cd "$FRONTEND_DIR" && nohup pnpm run dev > "$LOG_DIR/frontend.log" 2>&1 &)
  ok "Web portal starting" "port $FRONTEND_PORT"
fi

# Wait for servers
wait_for() {
  local port=$1 timeout=${2:-120} elapsed=0
  while ! test_port "$port" && ((elapsed < timeout)); do sleep 2; elapsed=$((elapsed + 2)); done
  test_port "$port"
}

if [[ "$api_up" == "false" ]]; then
  info "Waiting for the API..."
  wait_for "$BACKEND_PORT" 150 && ok "API listening" "port $BACKEND_PORT" || warn "API did not start in time - see logs/backend.log"
fi
if [[ "$web_up" == "false" ]]; then
  info "Waiting for the web portal..."
  wait_for "$FRONTEND_PORT" 150 && ok "Web portal listening" "port $FRONTEND_PORT" || warn "Web portal did not start in time - see logs/frontend.log"
fi

# ===========================================================================
#  8. READY
# ===========================================================================
ADMIN_EMAIL=$(get_env "$BACKEND_ENV" "SEED_ADMIN_EMAIL")
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@iqacademy.com}"

# Open browser
if command -v open &>/dev/null; then open "http://localhost:$FRONTEND_PORT" 2>/dev/null &
elif command -v xdg-open &>/dev/null; then xdg-open "http://localhost:$FRONTEND_PORT" 2>/dev/null &
fi

echo ""
printf '  ┌──────────────────────────────────────────────────────┐\n'
printf '  │  \033[32mIQ ACADEMY IS RUNNING\033[0m                              │\n'
printf '  ├──────────────────────────────────────────────────────┤\n'
printf '  │  Portal    http://localhost:%-22s │\n' "$FRONTEND_PORT"
printf '  │  API docs  http://localhost:%-22s │\n' "$BACKEND_PORT/api/docs"
printf '  │  Sign in   %-42s │\n' "$ADMIN_EMAIL"
printf '  │  Data      %-42s │\n' "$DB_NAME on port $DB_PORT"
printf '  │  Backups   %-42s │\n' "backups/  (snapshot every start)"
printf '  │  Stop      %-42s │\n' "./tools/stop.sh"
printf '  └──────────────────────────────────────────────────────┘\n'
printf "\n  Ready in $(elapsed).\n"
echo "  This terminal can be closed - the servers keep running in the background."
echo ""
