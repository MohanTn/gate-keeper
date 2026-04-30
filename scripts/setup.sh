#!/usr/bin/env bash
set -e

GATE_KEEPER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DAEMON_PID_FILE="$HOME/.gate-keeper/daemon.pid"

# Kill old daemon process if it exists
if [[ -f "$DAEMON_PID_FILE" ]]; then
  OLD_PID=$(cat "$DAEMON_PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "[gate-keeper] Killing old daemon process (PID: $OLD_PID)..."
    kill "$OLD_PID" 2>/dev/null || true
    sleep 1
  fi
  rm -f "$DAEMON_PID_FILE"
fi

# Kill processes on daemon ports if still running
for port in 5378 5379; do
  PID=$(lsof -ti:$port 2>/dev/null || true)
  if [[ -n "$PID" ]]; then
    echo "[gate-keeper] Killing process on port $port (PID: $PID)..."
    kill "$PID" 2>/dev/null || true
  fi
done

sleep 1

echo "[gate-keeper] Installing dependencies..."
cd "$GATE_KEEPER_DIR"
npm install --silent

echo "[gate-keeper] Building TypeScript..."
npx tsc

echo "[gate-keeper] Building dashboard..."
cd "$GATE_KEEPER_DIR/dashboard"
npm install --silent
npm run build

echo ""
echo "[gate-keeper] Setup complete!"
echo ""
echo "To add gate-keeper hooks globally (fires on all projects):"
echo "  Run: node $GATE_KEEPER_DIR/dist/hook-receiver.js --install-global"
echo ""
echo "Or add manually to ~/.claude/settings.json under 'hooks':"
echo "  \"PostToolUse\": ["
echo "    {"
echo "      \"matcher\": \"Write|Edit\","
echo "      \"hooks\": [{\"type\": \"command\", \"command\": \"node $GATE_KEEPER_DIR/dist/hook-receiver.js\"}]"
echo "    }"
echo "  ]"
echo ""
echo "Start the daemon manually: node $GATE_KEEPER_DIR/dist/daemon.js"
echo "Dashboard:                 http://localhost:5378/viz"
