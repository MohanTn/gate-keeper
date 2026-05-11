#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════════
# Gate Keeper — Autonomous Quality Improvement Loop
# ═══════════════════════════════════════════════════════════════════
# Single command to start the autonomous code quality improvement
# loop. Scans all registered repos, builds a priority queue of files
# below threshold, and uses Claude Code CLI (or API) to fix them,
# re-validating after each fix.
#
# Usage:
#   ./run-quality-loop.sh                     # start with defaults
#   ./run-quality-loop.sh --help              # show help
#   ./run-quality-loop.sh --threshold 8.0     # custom threshold
#   ./run-quality-loop.sh --workers 1         # single worker (safe)
#   ./run-quality-loop.sh --repos "/path/to/repo"    # target specific repo
#   ./run-quality-loop.sh --api-key "sk-..."  # use Anthropic API mode
#   ./run-quality-loop.sh --no-dashboard      # headless (no browser open)
#
# Config: ~/.gate-keeper/quality-config.json
# Logs:   /tmp/gk-quality-loop.log
# PID:    ~/.gate-keeper/quality-loop.pid
# ═══════════════════════════════════════════════════════════════════

GATE_KEEPER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
QUALITY_CONFIG_DIR="$HOME/.gate-keeper"
QUALITY_CONFIG="$QUALITY_CONFIG_DIR/quality-config.json"
LOG_FILE="/tmp/gk-quality-loop.log"
PID_FILE="$QUALITY_CONFIG_DIR/quality-loop.pid"
BUILD_FLAG=false

# ── Parse arguments ──────────────────────────────────────────────

show_help() {
  sed -n 's/^# \?//p' "$0" | sed '1,/^Usage:/d' | head -n -1
  exit 0
}

THRESHOLD=""
WORKERS=""
REPOS=""
API_KEY=""
NO_DASHBOARD=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help) show_help ;;
    --stop)
      if [[ -f "$PID_FILE" ]]; then
        OLD_PID=$(cat "$PID_FILE")
        if kill -0 "$OLD_PID" 2>/dev/null; then
          echo "[quality-loop] Stopping (PID: $OLD_PID)..."
          curl -sf -X POST http://127.0.0.1:5379/api/quality/stop > /dev/null 2>&1 || true
          kill "$OLD_PID" 2>/dev/null || true
          sleep 1
          rm -f "$PID_FILE"
          echo "[quality-loop] Stopped"
        else
          echo "[quality-loop] No process running (stale PID)"
          rm -f "$PID_FILE"
        fi
      else
        # Try killing by process name
        pkill -f "daemon.ts.*--quality-loop" 2>/dev/null || true
        echo "[quality-loop] Stopped"
      fi
      exit 0
      ;;
    --threshold) THRESHOLD="$2"; shift 2 ;;
    --workers) WORKERS="$2"; shift 2 ;;
    --repos) REPOS="$2"; shift 2 ;;
    --api-key) API_KEY="$2"; shift 2 ;;
    --no-dashboard) NO_DASHBOARD=true; shift ;;
    --build) BUILD_FLAG=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Prerequisites ───────────────────────────────────────────────

check_command() {
  if ! command -v "$1" &>/dev/null; then
    echo "[ERROR] $1 is not installed. Please install it first."
    exit 1
  fi
}

check_command node
check_command npm

# Optional: check for claude CLI
CLI_AVAILABLE=false
if command -v claude &>/dev/null; then
  CLI_AVAILABLE=true
fi

if [[ -z "$API_KEY" && "$CLI_AVAILABLE" == "false" ]]; then
  echo "[WARN] Neither claude CLI nor ANTHROPIC_API_KEY found."
  echo "  - Install Claude Code CLI: npm install -g @anthropic-ai/claude-code"
  echo "  - Or set ANTHROPIC_API_KEY for API mode"
  echo "  Continuing anyway — worker mode will be 'auto' (fallback may fail)"
fi

# ── Build if needed ─────────────────────────────────────────────

if [[ ! -d "$GATE_KEEPER_DIR/dist" ]] || [[ "$BUILD_FLAG" == "true" ]]; then
  echo "[quality-loop] Building gate-keeper..."
  cd "$GATE_KEEPER_DIR"
  npm run build
fi

if [[ ! -d "$GATE_KEEPER_DIR/dashboard/dist" ]] || [[ "$BUILD_FLAG" == "true" ]]; then
  echo "[quality-loop] Building dashboard..."
  cd "$GATE_KEEPER_DIR/dashboard"
  npm install --silent --no-audit --no-fund 2>/dev/null
  npm run build
fi

# ── Write quality config ────────────────────────────────────────

mkdir -p "$QUALITY_CONFIG_DIR"

if [[ -n "$REPOS" ]]; then
  IFS=' ' read -ra REPO_ARRAY <<< "$REPOS"
  REPO_JSON=""
  for r in "${REPO_ARRAY[@]}"; do
    REPO_JSON="$REPO_JSON\"$r\","
  done
  REPO_JSON="[${REPO_JSON%,}]"
else
  REPO_JSON='[]'
fi

cat > "$QUALITY_CONFIG" <<CONF
{
  "threshold": ${THRESHOLD:-7.0},
  "maxWorkers": ${WORKERS:-2},
  "maxAttemptsPerFile": 3,
  "workerMode": "auto",
  "repos": $REPO_JSON,
  "excludePatterns": [
    "**/node_modules/**",
    "**/dist/**",
    "**/.git/**",
    "**/bin/**",
    "**/obj/**",
    "**/Migrations/*.cs",
    "**/generated/**",
    "*.Designer.cs",
    "*.g.cs",
    "*.generated.cs"
  ],
  "checkpointIntervalSec": 30,
  "heartbeatIntervalSec": 10
}
CONF

echo "[quality-loop] Config written: $QUALITY_CONFIG"
echo "  Threshold:   $(node -e "console.log(require('$QUALITY_CONFIG').threshold)")/10"
echo "  Max Workers: $(node -e "console.log(require('$QUALITY_CONFIG').maxWorkers)")"
echo "  Repos:       $(node -e "console.log(require('$QUALITY_CONFIG').repos.join(', ') || '(auto-detect on scan)')")"

# Set API key if provided
if [[ -n "$API_KEY" ]]; then
  export ANTHROPIC_API_KEY="$API_KEY"
  echo "  API mode:    enabled"
fi

# ── Kill old loop if running ───────────────────────────────────

# Check PID file first
if [[ -f "$PID_FILE" ]]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "[quality-loop] Stopping previous loop (PID: $OLD_PID)..."
    kill "$OLD_PID" 2>/dev/null || true
    sleep 2
  fi
  rm -f "$PID_FILE"
fi

# Also kill any stale processes on our ports (handles manual starts & stale PID files)
for port in 5378 5379; do
  if lsof -ti :$port &>/dev/null; then
    echo "[quality-loop] Freeing port $port..."
    lsof -ti :$port | xargs -r kill 2>/dev/null || true
    sleep 1
  fi
done

# ── Start daemon with quality loop ─────────────────────────────

echo "[quality-loop] Starting daemon..."
rm -f "$LOG_FILE"

cd "$GATE_KEEPER_DIR"
npx tsx src/daemon.ts --quality-loop --no-scan > "$LOG_FILE" 2>&1 &
DAEMON_PID=$!
echo $DAEMON_PID > "$PID_FILE"

# Wait for daemon to be ready
echo "[quality-loop] Waiting for daemon..."
for port in 5378 5379; do
  for i in $(seq 1 15); do
    if curl -sf "http://127.0.0.1:$port/health" > /dev/null 2>&1; then
      break
    fi
    sleep 1
  done
done

echo "[quality-loop] Daemon ready (PID: $DAEMON_PID)"
echo "  Dashboard: http://localhost:5378/viz"
echo "  IPC:       http://127.0.0.1:5379"
echo "  Log:       $LOG_FILE"

# ── Trigger initial enqueue and start ──────────────────────────

sleep 2

echo "[quality-loop] Enqueuing files below threshold..."
curl -s -X POST "http://127.0.0.1:5379/api/quality/enqueue" > /dev/null 2>&1 || true

echo "[quality-loop] Starting orchestrator..."
curl -s -X POST "http://127.0.0.1:5379/api/quality/start" > /dev/null 2>&1 || true

# ── Open dashboard ────────────────────────────────────────────

if [[ "$NO_DASHBOARD" == "false" ]]; then
  if command -v xdg-open &>/dev/null; then
    xdg-open "http://localhost:5378/viz" 2>/dev/null || true
  elif command -v open &>/dev/null; then
    open "http://localhost:5378/viz" 2>/dev/null || true
  fi
fi

# ── Show status ────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Quality Loop Running"
echo ""
echo "  Dashboard:  http://localhost:5378/viz (click 'Quality Loop' tab)"
echo "  Log:        tail -f $LOG_FILE"
echo "  Stop:       ./run-quality-loop.sh --stop"
echo "  Or:         kill $DAEMON_PID"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Waiting for initial scan to populate the queue..."

# ── Tail the log ───────────────────────────────────────────────

trap "echo ''; echo '[quality-loop] Stopped'; exit 0" SIGINT SIGTERM

tail -f "$LOG_FILE" &
TAIL_PID=$!
wait $DAEMON_PID 2>/dev/null
kill $TAIL_PID 1>/dev/null 2>&1 || true
rm -f "$PID_FILE"
