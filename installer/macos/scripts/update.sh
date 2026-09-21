#!/usr/bin/env bash
# ============================================================
#  SCHOOL MANAGEMENT SYSTEM - Update Script (macOS / Linux)
#
#  Fetches from GitHub, pulls changes, syncs dependencies,
#  runs migrations (data-safe), and restarts the app.
#
#  Invoked by the in-app "Update now" dialog (and the do-update engine)
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKEND_DIR="$ROOT_DIR/apps/backend"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; NC='\033[0m'

ok()   { printf "  ${GREEN}✓${NC}  %s\n" "$1"; }
warn() { printf "  ${YELLOW}!${NC}  %s\n" "$1"; }

# Data-state note so "your data is safe" is always SPECIFIC: each stage
# updates it, and fail() prints exactly what has and has not been touched.
DATA_NOTE="nothing was changed - the update stopped before any action"
STOPPED_ANY=false
set_data_note() { DATA_NOTE="$1"; }

fail() {
  printf "  ${RED}✗${NC}  %s\n" "$1"
  printf "  Data: %s\n" "$DATA_NOTE"
  progress "failed" "$1" 0 0
  # Operability: if the update stopped AFTER taking the servers down, bring
  # them back so a failed update never leaves the school dark.
  if [[ "$STOPPED_ANY" == "true" ]]; then
    echo ""
    echo "  Restarting your servers (nothing critical was changed)..."
    "$SCRIPT_DIR/../start.sh" >/dev/null 2>&1 || true
  fi
  exit 1
}

# Progress journal read by the in-app update dialog (GET /api/updates/progress).
PROGRESS_FILE="$ROOT_DIR/logs/update-progress.json"
# progress <state> <label> <step> <total> [extra-json]
#   extra-json: optional comma-prefixed fields, e.g. ,"backupPath":"..."
progress() {
  local state="$1" label="$2" step="${3:-0}" total="${4:-0}" extra="${5:-}"
  mkdir -p "$(dirname "$PROGRESS_FILE")" 2>/dev/null || true
  printf '{"state":"%s","step":%s,"stepTotal":%s,"label":"%s","message":"%s","updatedAt":"%s"%s}\n' \
    "$state" "$step" "$total" "$label" "$label" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$extra" \
    > "$PROGRESS_FILE" 2>/dev/null || true
}

echo ""
echo "=========================================="
echo "  SCHOOL MANAGEMENT SYSTEM - Update"
echo "=========================================="
echo ""

# Check prerequisites
command -v git &>/dev/null || fail "Git is not available in PATH."
[[ -d "$ROOT_DIR/.git" ]] || fail "Not a git repository."
progress "running" "Checking prerequisites" 1 8

# The tracked branch comes from UPDATE_BRANCH in apps/backend/.env
# (every school install pins the same branch) - otherwise selfhosted:
# every install updates from the same release branch, never main.
BRANCH="selfhosted"
if [[ -f "$BACKEND_DIR/.env" ]]; then
  ENV_BRANCH=$(grep -E '^UPDATE_BRANCH=' "$BACKEND_DIR/.env" | tail -1 | cut -d= -f2- | tr -d '[:space:]')
  [[ -n "$ENV_BRANCH" ]] && BRANCH="$ENV_BRANCH"
fi

# Fetch latest
echo "Fetching latest changes from origin..."
git -C "$ROOT_DIR" fetch origin || fail "Failed to fetch from origin."
progress "running" "Fetching updates" 2 8

# Check if behind
BEHIND=$(git -C "$ROOT_DIR" rev-list HEAD..origin/$BRANCH --count 2>/dev/null || echo "0")
AHEAD=$(git -C "$ROOT_DIR" rev-list origin/$BRANCH..HEAD --count 2>/dev/null || echo "0")

echo ""
echo "  Local commits ahead of remote: $AHEAD"
echo "  Remote commits ahead of local: $BEHIND"

# Snapshot which servers are running BEFORE stopping anything. The engine is
# a restarter, never a starter (mirrors do-update.ps1): a system the operator
# shut down stays shut down.
was_up=false
for port in 3000 3001; do
  if command -v lsof &>/dev/null; then
    if lsof -ti :"$port" -sTCP:LISTEN &>/dev/null; then was_up=true; fi
  elif command -v ss &>/dev/null; then
    if ss -tln 2>/dev/null | grep -q ":$port "; then was_up=true; fi
  fi
done

if [[ "$BEHIND" == "0" ]]; then
  echo ""
  echo "  Already on the latest version. No update needed."
  echo ""
  if [[ "$was_up" == "true" ]]; then
    echo "  Starting servers..."
    "$SCRIPT_DIR/../start.sh"
  else
    echo "  Servers were not running - leaving them stopped."
  fi
  exit 0
fi

echo ""
echo "  Found $BEHIND new commit(s). Proceeding with update..."

# Stop servers - only if they were actually running. Watchers would otherwise
# hold locks on node_modules and the update would fail.
echo ""
if [[ "$was_up" == "true" ]]; then
  echo "Stopping servers..."
  "$SCRIPT_DIR/stop.sh" 2>/dev/null || true
  STOPPED_ANY=true
  set_data_note "servers were stopped - the database has not been touched yet"
  progress "running" "Stopping servers" 3 8

  # Wait for processes to release file handles
  echo ""
  echo "Waiting for processes to release file handles..."
  wait_count=0
  while ((wait_count < 10)); do
    sleep 1
    wait_count=$((wait_count + 1))
    # Check if ports are still in use
    busy=false
    for port in 3000 3001; do
      if command -v lsof &>/dev/null; then
        if lsof -ti :"$port" -sTCP:LISTEN &>/dev/null; then busy=true; fi
      elif command -v ss &>/dev/null; then
        if ss -tln 2>/dev/null | grep -q ":$port "; then busy=true; fi
      fi
    done
    [[ "$busy" == "false" ]] && break
  done
  echo "  Ready after ${wait_count}s."
else
  echo "Nothing was running - skipping the shutdown."
fi

# Pull changes
echo ""
echo "Pulling latest changes from origin..."
git -C "$ROOT_DIR" pull origin $BRANCH || fail "Failed to pull. Resolve conflicts and try again."
progress "running" "Pulling changes" 4 8

# Sync dependencies
echo ""
echo "Syncing dependencies..."
(cd "$ROOT_DIR" && pnpm install) || fail "Failed to install dependencies."
progress "running" "Installing dependencies" 5 8

# Sync database schema - DATA-SAFETY CRITICAL SECTION (mirrors do-update.ps1):
#   a) verified safety backup (gate - failure aborts the update),
#   b) push WITHOUT --force: drizzle refuses data-loss statements when
#      non-interactive, so a destructive change is detected with nothing
#      applied; only additive changes auto-apply,
#   c) a destructive result ABORTS the update - a human decides.
echo ""
echo "Protecting your data (safety backup)..."
rm -f "$ROOT_DIR/logs/pre-schema-result.json" 2>/dev/null || true
if ! bash "$SCRIPT_DIR/backup-before-schema.sh" "$ROOT_DIR"; then
  fail "The safety backup failed - the update stopped before touching the schema."
fi
BACKUP_PATH=""
if [[ -f "$ROOT_DIR/logs/pre-schema-result.json" ]] \
   && grep -q '"ok":true' "$ROOT_DIR/logs/pre-schema-result.json"; then
  BACKUP_PATH="$(sed -n 's/.*"path":"\([^"]*\)".*/\1/p' "$ROOT_DIR/logs/pre-schema-result.json" | head -1)"
fi
if [[ -n "$BACKUP_PATH" ]]; then
  ok "Safety backup verified: $BACKUP_PATH"
  set_data_note "protected - verified safety backup at $BACKUP_PATH"
  progress "running" "Protecting your data (safety backup)" 6 8 ",\"backupPath\":\"$BACKUP_PATH\""
else
  echo "  No existing data to back up yet (first run) - proceeding."
fi

echo ""
echo "Syncing the database schema..."
PUSH_LOG="$ROOT_DIR/logs/schema-push.log"
push_ok=false
push_destructive=false
for attempt in 1 2 3; do
  # Deliberately NO --force: data-loss statements make push exit 1 in a
  # non-interactive session WITHOUT executing anything, so this both
  # classifies the change and stays safe.
  if (cd "$BACKEND_DIR" && pnpm exec drizzle-kit push) >"$PUSH_LOG" 2>&1; then push_ok=true; break; fi
  if grep -qiE "data loss|will cause data|delete .* column|drop .* column|truncate" "$PUSH_LOG" 2>/dev/null; then
    push_destructive=true
    break
  fi
  echo "  Schema sync failed (attempt $attempt/3) - retrying..."
  sleep 3
done

if [[ "$push_destructive" == "true" ]]; then
  set_data_note "safe - the schema change was blocked before anything was applied (your data is untouched)"
  echo ""
  warn "The new version wants to CHANGE existing columns - this can move or remove data."
  warn "Nothing was applied: your database is exactly as it was before the update."
  echo ""
  echo "  What is in the new version (from the schema check):"
  grep -E "ALTER TABLE|DROP|DELETE|TRUNCATE" "$PUSH_LOG" 2>/dev/null | head -8 | sed 's/^/      /'
  echo ""
  echo "  Your verified safety backup: ${BACKUP_PATH:-none was needed yet}"
  echo "  Contact support (or your system administrator) to apply this version safely."
  fail "Update paused for a data-safety decision - no changes were applied."
fi
if [[ "$push_ok" != "true" ]]; then
  fail "The schema sync failed after 3 attempts (not a data-loss issue) - your data is untouched."
fi
echo "  Database schema is up to date (additive changes only)."
set_data_note "protected - schema synced (additive only), safety backup kept at ${BACKUP_PATH:-n/a}"
progress "running" "Updating database schema" 6 8

echo ""
echo "Update complete."
progress "running" "Restarting servers" 7 8

# Restart - only the servers that were running before the update. The engine
# restarts, it never starts: a system that was shut down stays shut down.
echo ""
if [[ "$was_up" == "true" ]]; then
  echo "Starting servers..."
  "$SCRIPT_DIR/../start.sh"

  # Health verification - the update is only a success if the school can
  # actually work afterwards. Say so loudly (with the exact recovery step)
  # instead of printing a green "done" over a dead system.
  HEALTH_OK=false
  echo ""
  echo "Waiting for the API to accept connections (up to 90s)..."
  for _ in $(seq 1 45); do
    if command -v curl &>/dev/null; then
      if curl -sf -m 3 -o /dev/null http://127.0.0.1:3001/api/health 2>/dev/null; then HEALTH_OK=true; break; fi
    elif command -v lsof &>/dev/null; then
      if lsof -ti :3001 -sTCP:LISTEN &>/dev/null; then HEALTH_OK=true; break; fi
    fi
    sleep 2
  done
  if [[ "$HEALTH_OK" == "true" ]]; then
    ok "API is back up (port 3001 accepting connections)"
  else
    warn "The API did not come back within 90 seconds."
    echo "  Your DATA IS SAFE - only the restart may have failed."
    echo "  Run start.sh (or the desktop shortcut) to start the system."
  fi
else
  echo "No server was running before the update - not starting anything."
  HEALTH_OK=true
fi

HEALTH_JSON="false"
[[ "$HEALTH_OK" == "true" ]] && HEALTH_JSON="true"

echo ""
echo "Done."
echo "  Backend:  http://localhost:3001"
echo "  Frontend: http://localhost:3000"
echo "  Safety backup: ${BACKUP_PATH:-not needed (no existing data)}"
echo "  Data: untouched - additive schema changes only"
echo ""
progress "done" "Update complete" 8 8 ",\"healthOk\":$HEALTH_JSON,\"backupPath\":\"$BACKUP_PATH\""
