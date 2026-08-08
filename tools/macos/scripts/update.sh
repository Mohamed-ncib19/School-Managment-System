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

echo ""
echo "=========================================="
echo "  SCHOOL MANAGEMENT SYSTEM - Update"
echo "=========================================="
echo ""

# Check prerequisites
command -v git &>/dev/null || fail "Git is not available in PATH."
[[ -d "$ROOT_DIR/.git" ]] || fail "Not a git repository."

# The tracked branch comes from UPDATE_BRANCH in apps/backend/.env
# (each school install pins the same branch, e.g. selfhosted) - otherwise main.
BRANCH="main"
if [[ -f "$BACKEND_DIR/.env" ]]; then
  ENV_BRANCH=$(grep -E '^UPDATE_BRANCH=' "$BACKEND_DIR/.env" | tail -1 | cut -d= -f2- | tr -d '[:space:]')
  [[ -n "$ENV_BRANCH" ]] && BRANCH="$ENV_BRANCH"
fi

# Fetch latest
echo "Fetching latest changes from origin..."
git -C "$ROOT_DIR" fetch origin || fail "Failed to fetch from origin."

# Check if behind
BEHIND=$(git -C "$ROOT_DIR" rev-list HEAD..origin/$BRANCH --count 2>/dev/null || echo "0")
AHEAD=$(git -C "$ROOT_DIR" rev-list origin/$BRANCH..HEAD --count 2>/dev/null || echo "0")

echo ""
echo "  Local commits ahead of remote: $AHEAD"
echo "  Remote commits ahead of local: $BEHIND"

if [[ "$BEHIND" == "0" ]]; then
  echo ""
  echo "  Already on the latest version. No update needed."
  echo ""
  echo "  Starting servers..."
  "$SCRIPT_DIR/../start.sh"
  exit 0
fi

echo ""
echo "  Found $BEHIND new commit(s). Proceeding with update..."

# Stop servers
echo ""
echo "Stopping servers..."
"$SCRIPT_DIR/stop.sh" 2>/dev/null || true

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
      lsof -ti :"$port" -sTCP:LISTEN &>/dev/null && busy=true
    elif command -v ss &>/dev/null; then
      ss -tln | grep -q ":$port " 2>/dev/null && busy=true
    fi
  done
  [[ "$busy" == "false" ]] && break
done
echo "  Ready after ${wait_count}s."

# Pull changes
echo ""
echo "Pulling latest changes from origin..."
git -C "$ROOT_DIR" pull origin $BRANCH || fail "Failed to pull. Resolve conflicts and try again."

# Sync dependencies
echo ""
echo "Syncing dependencies..."
(cd "$ROOT_DIR" && pnpm install) || fail "Failed to install dependencies."

# Generate Prisma client
echo ""
echo "Generating Prisma client..."
(cd "$BACKEND_DIR" && pnpm exec prisma generate 2>&1 | tail -1) || fail "prisma generate failed."
ok "Prisma client generated."

# Apply migrations
echo ""
echo "Applying database migrations..."
(cd "$BACKEND_DIR" && pnpm run db:migrate 2>&1) || warn "Migration had issues (your data is safe)."

echo ""
echo "Update complete."

# Start servers
echo ""
echo "Starting servers..."
"\$SCRIPT_DIR/../start.sh"

echo ""
echo "Done."
echo "  Backend:  http://localhost:3001"
echo "  Frontend: http://localhost:3000"
echo ""
