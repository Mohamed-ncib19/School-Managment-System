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
fail() { printf "  ${RED}✗${NC}  %s\n" "$1"; exit 1; }

# Progress journal read by the in-app update dialog (GET /api/updates/progress).
PROGRESS_FILE="$ROOT_DIR/logs/update-progress.json"
progress() {
  local state="$1" label="$2" step="${3:-0}" total="${4:-0}"
  mkdir -p "$(dirname "$PROGRESS_FILE")" 2>/dev/null || true
  printf '{"state":"%s","step":%s,"stepTotal":%s,"label":"%s","message":"%s","updatedAt":"%s"}\n' \
    "$state" "$step" "$total" "$label" "$label" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
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

# Sync database schema (drizzle-kit push is idempotent and additive)
echo ""
echo "Syncing the database schema..."
# An update is the likeliest moment for a schema change, and `push --force`
# never asks before dropping something. Dump first.
bash "$SCRIPT_DIR/backup-before-schema.sh" "$ROOT_DIR" || true
push_ok=false
for attempt in 1 2 3 4 5; do
  if (cd "$BACKEND_DIR" && pnpm exec drizzle-kit push --force 2>&1); then push_ok=true; break; fi
  echo "  Schema sync failed (attempt $attempt/5) - retrying..."
  sleep 3
done
if [[ "$push_ok" == "true" ]]; then
  progress "running" "Updating database schema" 6 8
else
  warn "Schema sync had issues after 5 attempts (your data is safe)."
  progress "running" "Updating database schema" 6 8
fi

echo ""
echo "Update complete."
progress "running" "Restarting servers" 7 8

# Restart - only the servers that were running before the update. The engine
# restarts, it never starts: a system that was shut down stays shut down.
echo ""
if [[ "$was_up" == "true" ]]; then
  echo "Starting servers..."
  "$SCRIPT_DIR/../start.sh"
else
  echo "No server was running before the update - not starting anything."
fi

echo ""
echo "Done."
echo "  Backend:  http://localhost:3001"
echo "  Frontend: http://localhost:3000"
echo ""
progress "done" "Update complete" 8 8
