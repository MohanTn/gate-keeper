# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Quality Checks:** @.github/instructions/gate-keeper-quality-check.instructions.md

## Commands

```bash
# First-time setup (installs deps + builds everything)
bash scripts/setup.sh

# Build TypeScript only (src/ → dist/)
npm run build

# Build dashboard only (dashboard/src/ → dashboard/dist/)
npm run build:dashboard

# Build everything
npm run build:all

# Run daemon (after building)
npm run daemon                    # node dist/daemon.js

# Run daemon in dev mode (no build step needed)
npm run dev                       # npx tsx src/daemon.ts

# Run the MCP server (after building)
npm run mcp                       # node dist/mcp/server.js

# Run the MCP server in dev mode
npm run mcp:dev                   # npx tsx src/mcp/server.ts

# Test the MCP server (send JSON-RPC initialize)
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | node dist/mcp/server.js

# Test the hook receiver manually
echo '{"tool_name":"Write","tool_input":{"file_path":"/path/to/file.ts"}}' | node dist/hook-receiver.js

# Test the analyzer directly (Node REPL)
node -e "
const { UniversalAnalyzer } = require('./dist/analyzer/universal-analyzer');
new UniversalAnalyzer().analyze('/your/file.ts').then(r => console.log(JSON.stringify(r, null, 2)));
"
```

## Test Suite

The project uses **Jest** with **ts-jest** preset for TypeScript support.

### Test Commands

```bash
# Run all tests
npm test

# Run tests in watch mode (re-run on file changes)
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

### Test Structure

- **Test files:** `src/**/*.test.ts` or `src/**/*.spec.ts`
- **Configuration:** `jest.config.js` (Node environment, ts-jest transformer)
- **Coverage:** Collected from `src/**/*.{ts,tsx}`, excludes `.d.ts` files
- **Dashboard tests:** Separate Jest config in `dashboard/jest.config.js`

### Coverage Reports

Coverage reports are generated in multiple formats:
- `text` and `text-summary` — console output
- `lcov` — detailed coverage data
- `cobertura` — XML format for CI integration

View the coverage summary after running `npm run test:coverage`.

## Architecture

Gate Keeper runs as two persistent layers plus a React dashboard.

### Two-process design

**`src/hook-receiver.ts`** — called on every `PostToolUse` (Write/Edit) event by the Claude Code global hook in `~/.claude/settings.json`. It **must exit in under 100ms**: it checks for `.ts/.tsx/.jsx/.js/.cs` extensions, auto-starts the daemon if the PID file (`~/.gate-keeper/daemon.pid`) shows it's dead, then fires a `POST /analyze` to the daemon and returns immediately. It never does analysis itself.

**`src/daemon.ts`** — long-lived Node process. Binds two ports:
- `:5379` (localhost only) — HTTP IPC, receives `/analyze` requests from the hook-receiver
- `:5378` — public Express + WebSocket server that serves the dashboard and broadcasts real-time updates

### Analysis pipeline

Each file write triggers: `UniversalAnalyzer` → language dispatch → `TypeScriptAnalyzer` or `CSharpAnalyzer` → `RatingCalculator` → `SqliteCache.save()` → `VizServer.pushAnalysis()` → WebSocket broadcast.

- **`TypeScriptAnalyzer`** uses the TypeScript Compiler API (`ts.createSourceFile`) for accurate AST-based detection. Detects: hook count per component, missing `key` props in `.map()`, inline JSX handlers, `any` usage, `console.log`.
- **`CSharpAnalyzer`** uses text/regex analysis (Roslyn via `dotnet` CLI if available). Detects: God Class (>20 methods), long methods (>50 lines), tight coupling (>5 constructor params), empty catch blocks.
- **`RatingCalculator`** starts at 10.0, deducts: error −1.5, warning −0.5, info −0.1, complexity >20 −2, imports >30 −2, LOC >500 −1.5. Circular deps apply a separate −1.0 per cycle.

### Dependency graph & cycle detection

`DependencyGraph` maintains an in-memory map of all analyzed `FileAnalysis` objects. `detectCycles()` uses iterative DFS with a visited/stack set. Only edges where both source and target are known files are included (external npm imports are tracked but not graphed). `VizServer` loads the cache on startup so the graph survives daemon restarts.

### Dashboard

`dashboard/` is a standalone Vite + React app. It connects via WebSocket to `:5378`, receives `init` (full graph) on connect and `update` (delta) on each new analysis. Node shapes encode language: circle = TS/JS, square = C#, triangle = TSX/JSX. Node color encodes rating: green ≥8, yellow ≥6, orange ≥4, red <4. The dashboard auto-opens in the browser when overall rating drops below 5.0.

### Persistence

`SqliteCache` writes to `~/.gate-keeper/cache.db`. It stores the full `FileAnalysis` JSON plus a `rating_history` table for trend data. The `VizServer` pre-loads all cached analyses on daemon startup.

### Ports & files

| Port / Path | Purpose |
|---|---|
| `:5378` | Dashboard WebSocket + static files |
| `:5379` | Daemon IPC (localhost only) |
| `~/.gate-keeper/cache.db` | SQLite analysis cache |
| `~/.gate-keeper/daemon.pid` | PID file — hook-receiver uses this to check daemon liveness |
| `dashboard/dist/` | Built dashboard, served at `/viz/` |

### MCP Server (`src/mcp/server.ts`)

Exposes Gate Keeper as an MCP (Model Context Protocol) server over stdio. AI agents (GitHub Copilot, Claude, etc.) call these tools during editing to get real-time quality feedback and self-correct.

**Tools:**

| Tool | Purpose |
|---|---|
| `analyze_file` | Analyze a file on disk → rating, violations, metrics |
| `analyze_code` | Analyze a code string in-memory → rating, violations |
| `get_codebase_health` | Scan a directory → overall rating, worst files, common issues |
| `get_quality_rules` | List all rules, thresholds, and scoring deductions |

**Agent workflow:**
1. Agent edits a file
2. Agent calls `analyze_file` on the edited file
3. Gate Keeper returns rating + violations
4. If rating < threshold → agent fixes violations and re-analyzes
5. Repeat until rating ≥ threshold

**Key files:**
- `src/mcp/server.ts` — MCP server, JSON-RPC over stdio, tool handlers
- `src/analyzer/string-analyzer.ts` — In-memory AST analysis (no disk I/O)
- `src/analyzer/universal-analyzer.ts` — File-based analysis dispatcher

**VS Code setup (`.vscode/mcp.json`):**
```json
{
  "servers": {
    "gate-keeper": {
      "command": "node",
      "args": ["dist/mcp/server.js"],
      "cwd": "/path/to/gate-keeper"
    }
  }
}
```

**Configuration:** Edit `~/.gate-keeper/config.json` to change `minRating` (default 6.5).
