# ⬡ Gate Keeper

> **Real-time architectural analysis for AI-assisted development.**  
> Gate Keeper hooks into Claude Code and GitHub Copilot, silently analyzing every file you write and broadcasting live quality metrics to a force-directed dependency graph in your browser.

---

## What It Does

Every time an AI agent (or you) writes or edits a `.ts`, `.tsx`, `.jsx`, `.js`, or `.cs` file, Gate Keeper:

1. **Intercepts** the `PostToolUse` event via a hook (exits in <100 ms — zero disruption to the AI)
2. **Analyzes** the file in a background daemon using the TypeScript Compiler API or C# Roslyn
3. **Rates** each file on a 0–10 architectural quality scale
4. **Broadcasts** a live update to a React dashboard over WebSocket
5. **Auto-opens** the dashboard when your overall codebase rating drops below 5.0

The result: you can see your codebase architecture health in real time, alongside the AI writing the code.

---

## Screenshots

```
┌─────────────────────────────────────────────┐
│  ⬡ Gate Keeper   ● connected   Last: App.tsx │
│                           48 files · Arch: 7.2/10 │
├──────────────────────────────┬──────────────┤
│                              │ Architecture │
│   Force-directed dependency  │ Health       │
│   graph                      │              │
│                              │ Rating 7.2   │
│   ● circle = TS/JS           │ Files    48  │
│   ■ square = C#              │ Cycles    0  │
│   ▲ triangle = TSX/JSX       │ Violations 3 │
│                              │              │
│   ■ ≥8  ■ ≥6  ■ ≥4  ■ <4   │ Hotspots ... │
└──────────────────────────────┴──────────────┘
```

---

## Architecture

Gate Keeper runs as **two separate processes** plus a React dashboard.

```
Claude Code / Copilot
       │
       │  PostToolUse hook (Write/Edit)
       ▼
┌─────────────────────┐
│   hook-receiver.ts  │  Must exit < 100ms
│   (short-lived)     │  Checks extension → wakes daemon → fires POST /analyze
└──────────┬──────────┘
           │  HTTP POST to localhost:5379
           ▼
┌─────────────────────┐         ┌──────────────────────┐
│     daemon.ts       │────────▶│   SQLite cache.db    │
│   (long-lived)      │         │  ~/.gate-keeper/     │
│                     │         └──────────────────────┘
│  UniversalAnalyzer  │
│  RatingCalculator   │
│  DependencyGraph    │
│  VizServer          │
└──────────┬──────────┘
           │  WebSocket broadcast
           ▼
┌─────────────────────┐
│  React Dashboard    │  http://localhost:5378/viz
│  (Vite + force-graph│
└─────────────────────┘
```

### Two-Process Design

The **hook-receiver** (`src/hook-receiver.ts`) is called synchronously by Claude Code's hook system on every `Write`/`Edit` operation. It must exit in under 100 ms so it never blocks the AI. It does only three things: validates the file extension, starts the daemon if it isn't running (checking `~/.gate-keeper/daemon.pid`), and fires a fire-and-forget `POST /analyze` to the daemon.

The **daemon** (`src/daemon.ts`) is a long-lived Node process that does all the heavy work. It binds two ports:
- `:5379` — localhost-only HTTP IPC, receives `/analyze` requests from the hook-receiver
- `:5378` — public Express + WebSocket server that serves the dashboard and pushes real-time updates

### Analysis Pipeline

```
File write
  → UniversalAnalyzer         (routes by extension)
  → TypeScriptAnalyzer        (.ts/.tsx/.js/.jsx — TypeScript Compiler API AST)
    or CSharpAnalyzer         (.cs — Roslyn CLI or text/regex fallback)
  → RatingCalculator          (starts at 10.0, deducts for violations + metrics)
  → SqliteCache.save()        (persists FileAnalysis + rating_history)
  → VizServer.pushAnalysis()  (upsert DependencyGraph → WebSocket broadcast)
```

---

## Rating System

Each file is rated **0–10** (higher is better):

| Deduction | Condition |
|-----------|-----------|
| −1.5 per `error` violation | e.g. missing `key` prop, empty catch |
| −0.5 per `warning` violation | e.g. `any` type, god class, hook overload |
| −0.1 per `info` violation | e.g. `console.log`, inline handler, magic number |
| −2.0 | Cyclomatic complexity > 20 |
| −1.0 | Cyclomatic complexity > 10 |
| −2.0 | Import count > 30 (coupling signal) |
| −0.5 | Import count > 15 |
| −1.5 | Lines of code > 500 |
| −0.5 | Lines of code > 300 |
| −1.0 per cycle | Circular dependencies (applied separately) |

The overall codebase rating is the mean across all analyzed files. Dropping below **5.0** auto-opens the dashboard.

---

## Violation Detection

### TypeScript / JavaScript / React (`.ts`, `.tsx`, `.js`, `.jsx`)

Uses **TypeScript Compiler API** (`ts.createSourceFile`) for accurate AST-based detection — no regex heuristics.

| Violation | Severity | Description |
|-----------|----------|-------------|
| `missing_key` | **error** | JSX elements inside `.map()` missing the `key` prop |
| `empty_catch` | **error** | Empty catch blocks that silently swallow exceptions |
| `hook_overload` | warning | React component with more than 7 hooks |
| `duplicate_hooks` | warning | Same hook called more than once in a component |
| `any_type` | warning | Explicit `any` usage — use explicit types or `unknown` |
| `inline_handler` | info | Inline arrow functions in JSX event props (new reference each render) |
| `console_log` | info | `console.log` left in production code |

### C# (`.cs`)

Uses **Roslyn CLI** if `dotnet` is available; falls back to text/regex analysis.

| Violation | Severity | Description |
|-----------|----------|-------------|
| `empty_catch` | **error** | Empty catch block |
| `god_class` | warning | Class with more than 20 methods (Single Responsibility violation) |
| `long_method` | warning | Method body longer than 50 lines |
| `tight_coupling` | warning | Constructor with more than 5 parameters |
| `magic_number` | info | Unnamed numeric constants (should be named constants) |

---

## Dashboard

Open **http://localhost:5378/viz** after starting the daemon.

### Graph View
- **Force-directed layout** powered by `react-force-graph-2d`
- **Node shape** encodes language: circle = TS/JS, square = C#, triangle = TSX/JSX
- **Node color** encodes rating: green ≥8, yellow ≥6, orange ≥4, red <4
- **Node size** scales with lines of code
- **Edge direction** shows import direction; blue = `import`, orange = other
- Click any node to drill into its violations, metrics, and dependencies

### Sidebar
- Overall architecture rating and trend
- Total files analyzed
- Circular dependency count (flagged as alert if > 0)
- Total violations (flagged if any `error` severity)
- Top 5 hotspots (lowest-rated files)
- Per-file: lines, cyclomatic complexity, method count, import count, full violation list with fix suggestions

### REST API

| Endpoint | Description |
|----------|-------------|
| `GET /api/graph` | Full graph data (nodes + edges) |
| `GET /api/hotspots` | Top 5 lowest-rated files |
| `GET /api/status` | Daemon status, overall rating, cycle count |
| `GET /api/cycles` | All detected circular dependency cycles |
| `GET /api/trends?file=<path>` | Rating history for a specific file |

---

## Prerequisites

- **Node.js** 18 or later
- **npm** 9 or later
- **.NET 8 SDK** (optional — enables Roslyn-based C# analysis; falls back to text analysis without it)

---

## Installation

### 1. Clone and build

```bash
git clone https://github.com/your-org/gate-keeper.git
cd gate-keeper
bash scripts/setup.sh
```

`setup.sh` installs npm dependencies, compiles TypeScript (`src/` → `dist/`), and builds the React dashboard (`dashboard/src/` → `dashboard/dist/`).

### 2. Manual build (if you prefer step-by-step)

```bash
npm install          # root deps
npm run build        # compile src/ → dist/
npm run build:dashboard  # compile dashboard/src/ → dashboard/dist/
```

---

## Setup with Claude Code

Gate Keeper integrates with Claude Code via the `PostToolUse` hook. The hook fires after every `Write` or `Edit` tool call, pipes the event JSON to `hook-receiver.js`, and returns immediately — Gate Keeper never adds latency to the AI.

### Option A — Global hook (recommended)

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "node /absolute/path/to/gate-keeper/dist/hook-receiver.js"
          }
        ]
      }
    ]
  }
}
```

Replace `/absolute/path/to/gate-keeper` with the actual path where you cloned this repo.

### Option B — Project-level hook

Add to `.claude/settings.json` inside any project you want to monitor:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "node /absolute/path/to/gate-keeper/dist/hook-receiver.js"
          }
        ]
      }
    ]
  }
}
```

### Verify the hook is firing

```bash
# Start the daemon manually
node /path/to/gate-keeper/dist/daemon.js

# In another terminal, simulate a hook event
echo '{"tool_name":"Write","tool_input":{"file_path":"/path/to/your/file.ts"}}' \
  | node /path/to/gate-keeper/dist/hook-receiver.js
```

You should see the analysis appear on the daemon's stderr and in the dashboard.

---

## Setup with GitHub Copilot (VS Code Agent)

GitHub Copilot Agent in VS Code fires events when it writes files via its agent loop. You can wire Gate Keeper into those events using VS Code tasks.

### Option A — VS Code Task on file save

Add to `.vscode/tasks.json` in your project:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Gate Keeper: Analyze on Save",
      "type": "shell",
      "command": "echo '{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"${file}\"}}' | node /absolute/path/to/gate-keeper/dist/hook-receiver.js",
      "runOptions": {
        "runOn": "folderOpen"
      },
      "presentation": {
        "reveal": "silent",
        "panel": "shared"
      }
    }
  ]
}
```

### Option B — VS Code Extension `onDidSaveTextDocument`

If you maintain a VS Code extension, call the hook-receiver on every save:

```typescript
import * as vscode from 'vscode';
import { exec } from 'child_process';

export function activate(context: vscode.ExtensionContext) {
  const hookReceiver = '/absolute/path/to/gate-keeper/dist/hook-receiver.js';

  vscode.workspace.onDidSaveTextDocument(doc => {
    const payload = JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: doc.fileName }
    });
    const cmd = `echo '${payload}' | node "${hookReceiver}"`;
    exec(cmd, { timeout: 5000 });
  });
}
```

### Option C — Shell alias for any Copilot workflow

If you use Copilot CLI or apply patches manually, add an alias to trigger analysis:

```bash
# Add to ~/.bashrc or ~/.zshrc
gk-analyze() {
  echo "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$1\"}}" \
    | node /absolute/path/to/gate-keeper/dist/hook-receiver.js
}
```

Then call `gk-analyze ./src/MyComponent.tsx` after any Copilot-generated file write.

---

## Running the Daemon

The daemon auto-starts when the hook-receiver fires and detects it isn't running. You can also start it manually:

```bash
# Production (after build)
npm run daemon
# or
node dist/daemon.js

# Development (no build step needed — uses tsx)
npm run dev
```

The daemon writes its PID to `~/.gate-keeper/daemon.pid` so the hook-receiver can check liveness with a zero-cost `kill -0`.

---

## Development

### Project layout

```
gate-keeper/
├── src/
│   ├── hook-receiver.ts         # Invoked by AI agent hooks, exits < 100ms
│   ├── daemon.ts                # Long-lived process: IPC + WebSocket server
│   ├── types.ts                 # Shared TypeScript interfaces
│   ├── analyzer/
│   │   ├── universal-analyzer.ts  # Routes to language-specific analyzer
│   │   ├── typescript-analyzer.ts # TypeScript Compiler API analysis
│   │   └── csharp-analyzer.ts     # Roslyn CLI / text fallback
│   ├── cache/
│   │   └── sqlite-cache.ts      # SQLite persistence (analyses + rating_history)
│   ├── graph/
│   │   └── dependency-graph.ts  # In-memory graph, DFS cycle detection
│   ├── rating/
│   │   └── rating-calculator.ts # 0–10 rating formula
│   └── viz/
│       └── viz-server.ts        # Express + WebSocket server
├── dashboard/
│   └── src/
│       ├── App.tsx              # WebSocket client, state management
│       ├── components/
│       │   ├── GraphView.tsx    # react-force-graph-2d canvas renderer
│       │   ├── Sidebar.tsx      # Metrics panel + violation list
│       │   └── MetricCard.tsx   # Individual metric display card
│       └── types.ts             # Shared dashboard types
└── scripts/
    └── setup.sh                 # One-shot install + build script
```

### Manual testing

```bash
# Test the hook-receiver
echo '{"tool_name":"Write","tool_input":{"file_path":"/path/to/file.ts"}}' \
  | node dist/hook-receiver.js

# Test the analyzer directly
node -e "
  const { UniversalAnalyzer } = require('./dist/analyzer/universal-analyzer');
  new UniversalAnalyzer().analyze('/your/file.ts').then(r => console.log(JSON.stringify(r, null, 2)));
"

# Query the REST API while daemon is running
curl http://localhost:5378/api/status
curl http://localhost:5378/api/hotspots
curl 'http://localhost:5378/api/trends?file=/path/to/file.ts'
```

---

## Ports & Files Reference

| Resource | Purpose |
|----------|---------|
| `:5378` | Dashboard HTTP + WebSocket server |
| `:5379` (localhost only) | Daemon IPC — receives `/analyze` from hook-receiver |
| `~/.gate-keeper/cache.db` | SQLite database — stores analyses and rating history |
| `~/.gate-keeper/daemon.pid` | PID file — hook-receiver checks daemon liveness here |
| `dashboard/dist/` | Built dashboard, served at `/viz/` |

---

## How the Dependency Graph Works

`DependencyGraph` maintains an in-memory `Map<path, FileAnalysis>`. On each `upsert`:
- The file's AST-extracted imports are turned into directed edges
- Only edges where **both** source and target are known analyzed files are included (external npm imports are tracked but not graphed — they would create noise)
- `detectCycles()` runs an iterative DFS with separate `visited` and `stack` sets to find back-edges, which identify cycles

The graph survives daemon restarts because `VizServer` pre-loads all entries from `SqliteCache` on startup.

---

## Contributing

1. Fork the repo and create a feature branch
2. Make your changes in `src/` or `dashboard/src/`
3. Build: `npm run build:all`
4. Test manually using the snippet in the **Manual testing** section above
5. Open a pull request — describe what violation or metric you added and why

There is no automated test suite yet. Contributions that add one are very welcome.

---

## License

MIT — see [LICENSE](LICENSE) for details.
