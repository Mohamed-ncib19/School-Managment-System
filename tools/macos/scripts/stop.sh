#!/usr/bin/env bash
# ============================================================
#  SCHOOL MANAGEMENT SYSTEM - Stop engine (macOS / Linux)
#
#  Internal engine, launched by the in-app Shut Down button
#  (POST /api/system/stop). Kills the API and web portal
#  process trees by port. PostgreSQL is left running.
#
#  Also honours PID files written by start.sh for fast, precise
#  shutdown. Falls back to port-based detection when no PID file
#  exists or it is stale.
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'
DIM='\033[0;90m'; NC='\033[0m'

banner() {
  printf '\n  ┌──────────────────────────────────────────────────────┐\n'
  printf '  │  %-50s │\n' "$1"
  printf '  └──────────────────────────────────────────────────────┘\n\n'
}

ok()   { printf "         ${GREEN}✓${NC}  %s\n" "$1"; }
warn() { printf "         ${YELLOW}!${NC}  %s\n" "$1"; }
info() { printf "            %s\n" "$1"; }

# Kill process tree on macOS/Linux (portable version)
kill_tree() {
  local pid=$1
  # Get child PIDs
  local children
  children=$(pgrep -P "$pid" 2>/dev/null || true)
  for child in $children; do
    kill_tree "$child"
  done
  kill "$pid" 2>/dev/null || true
}

# Read PID from file; returns 0 and prints the PID if alive, 1 otherwise.
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
    # Stale PID file - remove it.
    rm -f "$pid_file"
  fi
  return 1
}

# Find PIDs listening on a port
find_pids() {
  local port=$1
  local pids=""
  if command -v lsof &>/dev/null; then
    # macOS / Linux with lsof
    pids=$(lsof -ti :"$port" -sTCP:LISTEN 2>/dev/null || true)
  elif command -v ss &>/dev/null; then
    # Linux with ss
    pids=$(ss -tlnp "sport = :$port" 2>/dev/null | grep -oP 'pid=\K[0-9]+' || true)
  elif command -v netstat &>/dev/null; then
    # Fallback
    pids=$(netstat -tlnp 2>/dev/null | grep ":$port " | awk '{print $NF}' | cut -d/ -f1 || true)
  fi
  echo "$pids"
}

# ===========================================================================
#  BANNER
# ===========================================================================
clear 2>/dev/null || true
banner "SCHOOL MANAGEMENT SYSTEM - Shutting down"

PORTS=(3000 3001)
LABELS=("Web portal" "API")
PID_NAMES=("frontend" "backend")
stopped=0

for i in "${!PORTS[@]}"; do
  port="${PORTS[$i]}"
  name="${LABELS[$i]}"
  pid_name="${PID_NAMES[$i]}"
  printf "  ==> %s (port %s)\n" "$name" "$port"

  # Try PID file first (fast and precise).
  pid=$(read_pid "$pid_name" 2>/dev/null || true)
  if [[ -n "$pid" ]]; then
    info "Killing PID $pid and its children (from PID file)"
    kill_tree "$pid"
    rm -f "$LOG_DIR/${pid_name}.pid"
  else
    # Fall back to port-based detection.
    pids=$(find_pids "$port")
    if [[ -z "$pids" ]]; then
      info "Not running"
      continue
    fi

    # Kill the process tree for each listener
    for pid in $pids; do
      info "Killing PID $pid and its children"
      kill_tree "$pid"
    done
  fi

  # Wait for port to free up
  freed=false
  for attempt in $(seq 1 10); do
    sleep 0.5
    pid=$(read_pid "$pid_name" 2>/dev/null || true)
    if [[ -z "$pid" ]] && [[ -z "$(find_pids "$port")" ]]; then
      freed=true; break
    fi
  done

  if [[ "$freed" == "true" ]]; then
    ok "$name stopped"
    stopped=$((stopped + 1))
  else
    warn "Port $port is still in use - kill the process manually"
  fi
done

echo ""
printf '  ┌──────────────────────────────────────────────────────┐\n'
if [[ $stopped -gt 0 ]]; then
  printf '  │  \033[33mSCHOOL MANAGEMENT SYSTEM STOPPED\033[0m                                 │\n'
  printf '  ├──────────────────────────────────────────────────────┤\n'
  printf '  │  Servers   %-41s │\n' "$stopped stopped"
  printf '  │  Database  %-41s │\n' "still running - data untouched"
  printf '  │  Restart   %-41s │\n' "./tools/macos/start.sh"
else
  printf '  │  \033[90mNOTHING WAS RUNNING\033[0m                                │\n'
  printf '  ├──────────────────────────────────────────────────────┤\n'
  printf '  │  Start     %-41s │\n' "./tools/macos/start.sh"
fi
printf '  └──────────────────────────────────────────────────────┘\n'
echo ""

