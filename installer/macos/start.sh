#!/usr/bin/env bash
# ============================================================
#  SCHOOL MANAGEMENT SYSTEM - Unified Launcher
#  Double-click to start, or pass a subcommand:
#    start.sh            start the servers (default)
#    start.sh start      start the servers
#    start.sh stop       stop the servers
#    start.sh restart    restart the servers
#    start.sh status     show running status
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKEND_DIR="$ROOT_DIR/apps/backend"
FRONTEND_DIR="$ROOT_DIR/apps/frontend"
LOG_DIR="$ROOT_DIR/logs"

BACKEND_PORT=3001
FRONTEND_PORT=3000

# --- console helpers -------------------------------------------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'
CYAN='\033[0;36m'; DIM='\033[0;90m'; BOLD='\033[1;37m'; NC='\033[0m'

step_i=0; step_total=6; ui_start=$(date +%s)

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

# School identity helpers - fall back to the generic name until the wizard fires.
to_slug() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]\+/-/g' | sed 's/^-//; s/-$//'; }
rand_str() { head -c 32 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9' | head -c "$1"; }
school_name() {
  local n; n=$(get_env "$BACKEND_DIR/.env" "SCHOOL_NAME")
  printf '%s' "${n:-School Management System}"
}

# --- PID file management ---------------------------------------------------
write_pid() {
  local name="$1" pid="$2"
  mkdir -p "$LOG_DIR"
  echo "$pid" > "$LOG_DIR/${name}.pid"
}

cleanup_stale_pids() {
  rm -f "$LOG_DIR/backend.pid" "$LOG_DIR/frontend.pid"
}

read_pid() {
  local name="$1"
  local pid_file="$LOG_DIR/${name}.pid"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid=$(cat "$pid_file" 2>/dev/null)
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      echo "$pid"
      return 0
    fi
    rm -f "$pid_file"
  fi
  return 1
}

# ===========================================================================
#  PREFLIGHT (mirrors tools/windows/start.bat: node first, then pnpm, then
#  the build-dependency check - so the launcher below only starts what can run)
# ===========================================================================
do_preflight() {
  # Node first: without it nothing below can run, and the message it fails with
  # otherwise ("command not found: node") does not say what to install.
  if ! command -v node &>/dev/null; then
    echo ""
    echo "  [preflight] Node.js is not installed."
    echo ""
    echo "  Install Node.js 20 LTS or newer, then run start.sh again:"
    echo "    brew install node@20        (macOS)"
    echo "    sudo apt install nodejs     (Debian/Ubuntu)"
    echo "  or download it from https://nodejs.org"
    echo ""
    exit 1
  fi

  if command -v pnpm &>/dev/null; then
    if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
      echo "  [preflight] Installing dependencies (first run)..."
      if ! (cd "$ROOT_DIR" && pnpm install); then
        echo ""
        echo "  [preflight] Dependency installation failed."
        echo "  Check your internet connection, then run start.sh again."
        echo ""
        exit 1
      fi
    else
      echo "  [preflight] Dependencies present"
      echo "  [preflight] Checking build dependencies..."
      node "$ROOT_DIR/scripts/check-builds.mjs"
    fi
  else
    # The start sequence enables pnpm via corepack, so a missing pnpm here is
    # not fatal - it just means the dependency check is deferred to that step.
    echo "  [preflight] pnpm not found - the launcher will install it"
  fi
}

# ===========================================================================
#  START SEQUENCE
# ===========================================================================
run_start_sequence() {

# Flags passed through from the command line (backward compatibility with
# start.bat, e.g. "start.sh -Prod"). Unknown arguments are ignored.
PROD=0
for arg in "$@"; do
  case "${arg,,}" in
    -prod|--prod) PROD=1 ;;
  esac
done

step_total=$(( PROD ? 7 : 6 ))

# ===========================================================================
#  BANNER
# ===========================================================================
clear 2>/dev/null || true
if [[ "$PROD" == "1" ]]; then
  banner "$(school_name)" "School Management System   -   production mode"
else
  banner "$(school_name)" "School Management System"
fi

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

first_run=false
if [[ ! -f "$BACKEND_ENV" ]]; then
  first_run=true
  echo ""
  echo "  No installation found - let's set up your school."
  echo "  (Answer only the first three prompts; the database, secrets and"
  echo "   admin account are generated from the school name automatically.)"
  echo ""
  read -rp "  School name: " school_name_answer
  [[ -z "$school_name_answer" ]] && school_name_answer="School"
  read -rp "  Admin email (Enter = admin@$(to_slug "$school_name_answer").com): " admin_email_answer
  admin_email_answer="${admin_email_answer:-admin@$(to_slug "$school_name_answer").com}"
  read -rp "  Admin password (at least 12 chars): " admin_password_answer
  if [[ ${#admin_password_answer} -lt 12 ]]; then
    fail "The admin password must be at least 12 characters."
  fi
fi

if [[ ! -f "$BACKEND_ENV" ]]; then
  EXAMPLE="$BACKEND_DIR/.env.example"
  if [[ ! -f "$EXAMPLE" ]]; then
    fail "apps/backend/.env is missing." "Neither .env nor .env.example exists."
  fi
  cp "$EXAMPLE" "$BACKEND_ENV"

  # Drop any template keys we are about to set, so parsers never see two
  # definitions of the same variable.
  keys_to_strip="SCHOOL_NAME|SCHOOL_SLUG|DATABASE_URL|DATABASE_NAME|DATABASE_USER|DATABASE_PASSWORD|POSTGRES_SUPERUSER_PASSWORD|JWT_SECRET|JWT_REFRESH_SECRET|API_KEY|SEED_ADMIN_NAME|SEED_ADMIN_EMAIL|SEED_ADMIN_PASSWORD|GITHUB_TOKEN"
  tmp_env="$BACKEND_ENV.tmp"
  grep -v -E "^\s*($keys_to_strip)\s*=" "$BACKEND_ENV" > "$tmp_env" || true
  mv "$tmp_env" "$BACKEND_ENV"

  slug="$(to_slug "$school_name_answer")"
  db_name="$slug"
  db_user="${slug}_user"
  db_pass="$(rand_str 24)"
  super_pass="$(rand_str 24)"
  jwt_secret="$(rand_str 32)"
  jwt_refresh="$(rand_str 32)"
  api_key="$(rand_str 32)"
  school_name_answer="${school_name_answer:-School}"

  printf '\n# --- generated by the first-run setup (tools/macos/start.sh) ---\n' >> "$BACKEND_ENV"
  printf 'SCHOOL_NAME=%s\n' "$school_name_answer" >> "$BACKEND_ENV"
  printf 'SCHOOL_SLUG=%s\n' "$slug" >> "$BACKEND_ENV"
  printf 'DATABASE_URL=postgresql://%s:%s@localhost:5432/%s?schema=public\n' "$db_user" "$db_pass" "$db_name" >> "$BACKEND_ENV"
  printf 'DATABASE_NAME=%s\n' "$db_name" >> "$BACKEND_ENV"
  printf 'DATABASE_USER=%s\n' "$db_user" >> "$BACKEND_ENV"
  printf 'DATABASE_PASSWORD=%s\n' "$db_pass" >> "$BACKEND_ENV"
  printf 'POSTGRES_SUPERUSER_PASSWORD=%s\n' "$super_pass" >> "$BACKEND_ENV"
  printf 'JWT_SECRET=%s\n' "$jwt_secret" >> "$BACKEND_ENV"
  printf 'JWT_REFRESH_SECRET=%s\n' "$jwt_refresh" >> "$BACKEND_ENV"
  printf 'API_KEY=%s\n' "$api_key" >> "$BACKEND_ENV"
  printf 'SEED_ADMIN_NAME=%s Administrator\n' "$school_name_answer" >> "$BACKEND_ENV"
  printf 'SEED_ADMIN_EMAIL=%s\n' "$admin_email_answer" >> "$BACKEND_ENV"
  printf 'SEED_ADMIN_PASSWORD=%s\n' "$admin_password_answer" >> "$BACKEND_ENV"
  printf '\n# If the release repository is private, create a GitHub token with repo read access\n' >> "$BACKEND_ENV"
  printf '# and paste it below. Public repos work without it.\n' >> "$BACKEND_ENV"
  printf '# GITHUB_TOKEN=\n' >> "$BACKEND_ENV"
  ok "Created apps/backend/.env for $school_name_answer"
fi

if [[ ! -f "$FRONTEND_ENV" && "$first_run" == "true" ]]; then
  EXAMPLE="$FRONTEND_DIR/.env.example"
  if [[ -f "$EXAMPLE" ]]; then
    cp "$EXAMPLE" "$FRONTEND_ENV"
    # The portal sends the install API key on every call: the template only
    # documents the empty slot, so stamp the generated key in (portable sed:
    # macOS needs the -i backup suffix, GNU tolerates it too).
    if grep -q '^NEXT_PUBLIC_API_KEY=' "$FRONTEND_ENV"; then
      sed -i.bak "s/^NEXT_PUBLIC_API_KEY=.*/NEXT_PUBLIC_API_KEY=$api_key/" "$FRONTEND_ENV"
      rm -f "$FRONTEND_ENV.bak"
    else
      printf 'NEXT_PUBLIC_API_KEY=%s\n' "$api_key" >> "$FRONTEND_ENV"
    fi
    ok "Created apps/frontend/.env.local"
  fi
fi

# Upgrade backfill: installs created before the install API key existed have
# neither value, and the API now refuses keyed routes without one.
existing_api_key="$(get_env "$BACKEND_ENV" "API_KEY")"
if [[ -z "$existing_api_key" && -f "$BACKEND_ENV" ]]; then
  existing_api_key="$(rand_str 32)"
  printf 'API_KEY=%s\n' "$existing_api_key" >> "$BACKEND_ENV"
  echo "  Generated install API key (apps/backend/.env)"
fi
if [[ -f "$FRONTEND_ENV" && -z "$(get_env "$FRONTEND_ENV" "NEXT_PUBLIC_API_KEY")" && -n "$existing_api_key" ]]; then
  if grep -q '^NEXT_PUBLIC_API_KEY=' "$FRONTEND_ENV"; then
    sed -i.bak "s/^NEXT_PUBLIC_API_KEY=.*/NEXT_PUBLIC_API_KEY=$existing_api_key/" "$FRONTEND_ENV"
    rm -f "$FRONTEND_ENV.bak"
  else
    printf 'NEXT_PUBLIC_API_KEY=%s\n' "$existing_api_key" >> "$FRONTEND_ENV"
  fi
  echo "  Synced install API key (apps/frontend/.env.local)"
fi

if [[ "$first_run" == "true" ]]; then
  echo ""
  echo "  Setup complete for $school_name_answer"
  echo "  Admin account : $admin_email_answer"
  echo "  (password: as chosen during setup)"
  echo ""
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
    SUPER_PASS="$(get_env "$BACKEND_ENV" "POSTGRES_SUPERUSER_PASSWORD")"
    SUPER_PASS="${SUPER_PASS:-iq_academy_local}"
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
  warn "psql not found - skipping the database check (drizzle-kit will report any problem)"
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
#  5. DATABASE SCHEMA
# ===========================================================================
write_step "Applying database schema"

# Skip the introspection+diff when the schema definitions are unchanged since
# the last successful push. The hash is kept per machine.
mkdir -p "$LOG_DIR"
SCHEMA_STATE="$LOG_DIR/schema.hash"
SCHEMA_HASH="$(sha256sum "$BACKEND_DIR/src/db/schema.ts" "$BACKEND_DIR/src/db/relations.ts" "$BACKEND_DIR/drizzle.config.ts" 2>/dev/null | sha256sum | cut -d' ' -f1)"
push_needed=true
if [[ -n "$SCHEMA_HASH" && -f "$SCHEMA_STATE" ]] && [[ "$(cat "$SCHEMA_STATE")" == "$SCHEMA_HASH" ]]; then
  push_needed=false
fi

if [[ "$push_needed" == "true" ]]; then
  # `push --force` applies destructive statements without asking. Take a dump
  # first so a mistaken schema change is a restore, not a loss.
  bash "$SCRIPT_DIR/scripts/backup-before-schema.sh" "$ROOT_DIR" || true
  (cd "$BACKEND_DIR" && pnpm exec drizzle-kit push --force 2>&1 | tail -5) || \
    fail "Database schema could not be applied - your data has NOT been changed."
  echo "$SCHEMA_HASH" > "$SCHEMA_STATE"
  ok "Database schema is up to date"
else
  ok "Database schema is up to date" "push skipped - schema unchanged"
fi

# The admin seed is an upsert - it never touches existing data. Skip the cold
# ts-node run (~12s) when the account and the settings rows it creates already
# exist; without psql, run it and let it report loudly.
seed_needed=true
if command -v psql &>/dev/null; then
  export PGPASSWORD="$DB_PASS"
  seed_count="$(psql -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -d "$DB_NAME" -tAc \
    "SELECT (SELECT count(*) FROM users) + (SELECT count(*) FROM system_settings)" 2>/dev/null || echo "")"
  unset PGPASSWORD
  if [[ "$seed_count" =~ ^[0-9]+$ ]] && (( 10#$seed_count >= 2 )); then
    seed_needed=false
  fi
fi

if [[ "$seed_needed" == "true" ]]; then
  (cd "$BACKEND_DIR" && pnpm run db:seed 2>&1 | tail -1) || fail "Administrator seed failed."
fi
ok "Administrator account ready"

# ===========================================================================
#  6. BUILD (production mode only)
# ===========================================================================
if [[ "$PROD" == "1" ]]; then
  write_step "Building the application"

  # Skip the full nest+next rebuild when no source file has changed since the
  # last build; dist/.next are left untouched in that case. The hash covers
  # sources and the lockfile only - node_modules/.next/dist/public etc. are
  # build outputs or dependencies, not inputs.
  BUILD_STATE="$LOG_DIR/build.hash"
  BUILD_HASH="$(find "$BACKEND_DIR" "$FRONTEND_DIR" -type f \
    \( -path '*/node_modules/*' -o -path '*/.next/*' -o -path '*/dist/*' \
       -o -path '*/logs/*' -o -path '*/backups/*' -o -path '*/.postgres/*' \
       -o -path '*/public/*' \) -prune -o -type f -print0 2>/dev/null | \
    sort -z | xargs -0 sha256sum 2>/dev/null | sha256sum | cut -d' ' -f1)"
  rebuild_needed=true
  if [[ -n "$BUILD_HASH" && -f "$BUILD_STATE" ]] && [[ "$(cat "$BUILD_STATE")" == "$BUILD_HASH" ]]; then
    rebuild_needed=false
  fi

  if [[ "$rebuild_needed" == "true" ]]; then
    (cd "$ROOT_DIR" && pnpm build) || fail "Build failed." "Run 'pnpm build' to see the error, or start without -Prod."
    echo "$BUILD_HASH" > "$BUILD_STATE"
    ok "Build complete"
  else
    ok "Build is up to date" "sources unchanged - build skipped"
  fi
fi

# ===========================================================================
#  7. START SERVERS
# ===========================================================================
write_step "Starting servers"

cleanup_stale_pids

if [[ "$PROD" == "1" ]]; then
  backend_cmd="pnpm run start:prod"
  frontend_cmd="pnpm run start"
else
  backend_cmd="pnpm run start:dev"
  frontend_cmd="pnpm run dev"
fi

api_up=false; web_up=false
test_port "$BACKEND_PORT" && api_up=true
test_port "$FRONTEND_PORT" && web_up=true

if [[ "$api_up" == "true" ]]; then
  ok "API already running" "port $BACKEND_PORT"
else
  (cd "$BACKEND_DIR" && nohup $backend_cmd > "$LOG_DIR/backend.log" 2>&1 &)
  echo $! > "$LOG_DIR/backend.pid"
  ok "API starting" "port $BACKEND_PORT"
fi

if [[ "$web_up" == "true" ]]; then
  ok "Web portal already running" "port $FRONTEND_PORT"
else
  (cd "$FRONTEND_DIR" && nohup $frontend_cmd > "$LOG_DIR/frontend.log" 2>&1 &)
  echo $! > "$LOG_DIR/frontend.pid"
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
ADMIN_EMAIL="${ADMIN_EMAIL:-see apps/backend/.env (SEED_ADMIN_EMAIL)}"

# Open browser
if command -v open &>/dev/null; then open "http://localhost:$FRONTEND_PORT" 2>/dev/null &
elif command -v xdg-open &>/dev/null; then xdg-open "http://localhost:$FRONTEND_PORT" 2>/dev/null &
fi

echo ""
printf '  ┌──────────────────────────────────────────────────────┐\n'
printf '  │  \033[32mSCHOOL MANAGEMENT SYSTEM IS RUNNING\033[0m                              │\n'
printf '  ├──────────────────────────────────────────────────────┤\n'
printf '  │  Portal    http://localhost:%-22s │\n' "$FRONTEND_PORT"
printf '  │  API docs  http://localhost:%-22s │\n' "$BACKEND_PORT/api/docs"
printf '  │  Sign in   %-42s │\n' "$ADMIN_EMAIL"
printf '  │  Data      %-42s │\n' "$DB_NAME on port $DB_PORT"
printf '  │  Backups   %-42s │\n' "manage in the app (Settings)"
printf '  │  Stop      %-42s │\n' "the power button in the app"
printf '  └──────────────────────────────────────────────────────┘\n'
printf "\n  Ready in $(elapsed).\n"
echo "  This terminal can be closed - the servers keep running in the background."
echo ""

} # end run_start_sequence

# ===========================================================================
#  STOP
# ===========================================================================
do_stop() {
  "$SCRIPT_DIR/scripts/stop.sh"
}

# ===========================================================================
#  STATUS
# ===========================================================================
do_status() {
  api_up=false; web_up=false
  test_port "$BACKEND_PORT" && api_up=true
  test_port "$FRONTEND_PORT" && web_up=true

  if $api_up; then
    printf "  ${GREEN}API is running${NC}       port %s\n" "$BACKEND_PORT"
  else
    printf "  ${DIM}API is stopped${NC}       port %s\n" "$BACKEND_PORT"
  fi

  if $web_up; then
    printf "  ${GREEN}Web portal is running${NC} port %s\n" "$FRONTEND_PORT"
  else
    printf "  ${DIM}Web portal is stopped${NC} port %s\n" "$FRONTEND_PORT"
  fi
}

# ===========================================================================
#  MAIN - dispatch on the first argument (mirrors tools/windows/start.bat)
# ===========================================================================
CMD="${1:-start}"

case "$CMD" in
  start)
    # Backward compatibility: everything after "start" goes to the sequence
    # as flags (e.g. "start.sh start -Prod").
    do_preflight
    run_start_sequence "${@:2}"
    ;;
  stop)
    do_stop
    ;;
  restart)
    do_stop 2>/dev/null || true
    sleep 2
    do_preflight
    run_start_sequence
    ;;
  status)
    do_status
    ;;
  *)
    # Backward compatibility (matching start.bat): if the first argument is
    # not a known subcommand, pass everything straight to the start sequence
    # (e.g. "start.sh -Prod").
    run_start_sequence "$@"
    ;;
esac