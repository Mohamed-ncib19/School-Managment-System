#!/usr/bin/env bash
# ============================================================
#  IQ Academy - Stop All Servers (macOS / Linux)
#
#  Kills the API and web portal dev servers by finding
#  processes that hold the expected ports. PostgreSQL is
#  deliberately left running.
#
#  Run via:  ./tools/stop.sh
# ============================================================
set -euo pipefail

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
banner "IQ ACADEMY - Shutting down"

PORTS=(3000 3001)
LABELS=("Web portal" "API")
stopped=0

for i in "${!PORTS[@]}"; do
  port="${PORTS[$i]}"
  name="${LABELS[$i]}"
  printf "  ==> %s (port %s)\n" "$name" "$port"

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

  # Wait for port to free up
  freed=false
  for attempt in $(seq 1 10); do
    sleep 0.5
    if [[ -z "$(find_pids "$port")" ]]; then
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
  printf '  │  \033[33mIQ ACADEMY STOPPED\033[0m                                 │\n'
  printf '  ├──────────────────────────────────────────────────────┤\n'
  printf '  │  Servers   %-41s │\n' "$stopped stopped"
  printf '  │  Database  %-41s │\n' "still running - data untouched"
  printf '  │  Restart   %-41s │\n' "./tools/start.sh"
else
  printf '  │  \033[90mNOTHING WAS RUNNING\033[0m                                │\n'
  printf '  ├──────────────────────────────────────────────────────┤\n'
  printf '  │  Start     %-41s │\n' "./tools/start.sh"
fi
printf '  └──────────────────────────────────────────────────────┘\n'
echo ""
