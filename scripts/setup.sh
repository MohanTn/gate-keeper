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
echo "[gate-keeper] Build complete!"
echo ""

# Start daemon in background (no auto-scan)
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
echo "[gate-keeper] Configuring Claude Code hooks..."
CLAUDE_SETTINGS="$HOME/.claude/settings.json"
if [[ ! -d "$HOME/.claude" ]]; then
  mkdir -p "$HOME/.claude"
fi

if [[ ! -f "$CLAUDE_SETTINGS" ]]; then
  cat > "$CLAUDE_SETTINGS" << EOF
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "node ${GATE_KEEPER_DIR}/dist/hook-receiver.js"
          }
        ]
      }
    ]
  }
}
EOF
  echo "[gate-keeper] ✓ Created ~/.claude/settings.json with PostToolUse hooks"
else
  if ! grep -q "gate-keeper" "$CLAUDE_SETTINGS"; then
    echo "[gate-keeper] ⚠ ~/.claude/settings.json exists but may not have gate-keeper hooks"
    echo "[gate-keeper] For portable setup, run the CLI tool instead:"
    echo "[gate-keeper]   npx tsx src/cli/setup.ts --claude"
  else
    echo "[gate-keeper] ✓ PostToolUse hooks already configured in ~/.claude/settings.json"
  fi
fi

echo ""
echo "[gate-keeper] Setup Summary:"
echo ""
echo "  ✓ Dependencies installed and built"
echo "  ✓ Daemon running on ports 5378 (WebSocket) and 5379 (IPC)"
echo "  ✓ Dashboard available at http://localhost:5378/viz"
echo ""
echo "  To install other integrations (VS Code, Cursor, CI, git hooks):"
echo "    npx tsx src/cli/setup.ts --all"
echo ""
echo "  MCP Server (AI Assistant Integration):"
echo "    npm run mcp:dev       # Run in development mode"
echo "    npm run mcp           # Run after build"
echo "    npm run daemon        # Run the HTTP daemon"
