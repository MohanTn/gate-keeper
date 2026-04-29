#!/usr/bin/env bash
set -e

GATE_KEEPER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

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
