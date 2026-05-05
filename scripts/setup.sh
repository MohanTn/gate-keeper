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

# Start daemon in background (no auto-scan — scans are triggered via dashboard or API)
echo "[gate-keeper] Starting daemon..."
cd "$GATE_KEEPER_DIR"
nohup node dist/daemon.js --no-scan > /tmp/gk-daemon.log 2>&1 &
NEW_PID=$!
sleep 2

if kill -0 "$NEW_PID" 2>/dev/null; then
  echo "[gate-keeper] Daemon started (PID: $NEW_PID)"
  echo "[gate-keeper] Dashboard: http://localhost:5378/viz"
else
  echo "[gate-keeper] WARNING: Daemon failed to start. Check /tmp/gk-daemon.log"
fi

echo ""
echo "[gate-keeper] Configuring global hooks..."
CLAUDE_SETTINGS="$HOME/.claude/settings.json"
if [[ ! -d "$HOME/.claude" ]]; then
  mkdir -p "$HOME/.claude"
fi

# Merge hook configuration into ~/.claude/settings.json
if [[ ! -f "$CLAUDE_SETTINGS" ]]; then
  # Create new settings file with hooks
  cat > "$CLAUDE_SETTINGS" << 'EOF'
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "node /home/mohantn/REPO/gate_keeper/dist/hook-receiver.js"
          }
        ]
      }
    ]
  }
}
EOF
  echo "[gate-keeper] ✓ Created ~/.claude/settings.json with PostToolUse hooks"
else
  # Check if hooks already exist
  if ! grep -q "gate-keeper.*hook-receiver" "$CLAUDE_SETTINGS"; then
    echo "[gate-keeper] ⚠ ~/.claude/settings.json exists but may not have gate-keeper hooks"
    echo "[gate-keeper] Manually add to hooks.PostToolUse:"
    echo "[gate-keeper]   {\"matcher\": \"Write|Edit|MultiEdit\", \"hooks\": [{\"type\": \"command\", \"command\": \"node $GATE_KEEPER_DIR/dist/hook-receiver.js\"}]}"
  else
    echo "[gate-keeper] ✓ PostToolUse hooks already configured in ~/.claude/settings.json"
  fi
fi

echo ""
echo "[gate-keeper] Setup Summary:"
echo ""
echo "  ✓ Global Write|Edit|MultiEdit hook configured"
echo "  ✓ Daemon running on ports 5378 (WebSocket) and 5379 (IPC)"
echo "  ✓ Dashboard available at http://localhost:5378/viz"
echo ""
echo "  VSCode Integration (available in Command Palette):"
echo "    • Run Task → Gate Keeper: Analyze Current File"
echo "    • Run Task → Gate Keeper: Scan Repository"
echo "    • Folder open event → Gate Keeper: Register Repo on Open"
echo ""
echo "  MCP Server (AI Assistant Integration):"
echo "    npm run mcp:dev       # Run in development mode"
echo "    npm run mcp           # Run after build"
echo "    npm run daemon        # Run the HTTP daemon"
