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
Claude Code                    GitHub Copilot (VS Code)
    │                                   │
    │  SessionStart hook (once/session) │  folderOpen task (once/open)
    │  PostToolUse hook (Write/Edit)    │  (no native hook API)
    ▼                                   ▼
┌──────────────────────────────────────────┐
│             hook-receiver.ts             │  Must exit < 100ms
│  SessionStart / session_create           │  → register repo in daemon
│  PostToolUse Write|Edit                  │  → POST /analyze to daemon
└───────────────────┬──────────────────────┘
                    │  HTTP POST to localhost:5379
                    ▼
┌─────────────────────┐         ┌──────────────────────────┐
│     daemon.ts       │────────▶│  ~/.gate-keeper/cache.db │
│   (long-lived)      │         │  SQLite — analyses,      │
│                     │         │  rating_history,         │
│  UniversalAnalyzer  │         │  repositories,           │
│  RatingCalculator   │         │  node_positions          │
│  DependencyGraph    │         └──────────────────────────┘
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

Gate Keeper uses two hooks. `SessionStart` fires **once when a session opens** and registers the repo in the database. `PostToolUse` fires after every `Write`/`Edit` and triggers file analysis. Both call the same `hook-receiver.js`.

### Option A — Global hook (recommended)

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /absolute/path/to/gate-keeper/dist/hook-receiver.js"
          }
        ]
      }
    ],
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

**What each hook does:**

| Hook | Fires | Action |
|------|-------|--------|
| `SessionStart` | Once at session open | Resolves git root, registers repo in SQLite, triggers initial file scan |
| `PostToolUse` (Write\|Edit) | Every file write | Analyzes the file, rates it, broadcasts to dashboard |

### Option B — Project-level hook

Add to `.claude/settings.json` inside any project you want to monitor — same JSON structure as Option A above.

### Verify the hooks are firing

```bash
# Start the daemon manually
node /path/to/gate-keeper/dist/daemon.js

# Simulate a SessionStart event (repo registration)
echo '{"hook_event_name":"SessionStart","session_id":"test-123","cwd":"/path/to/your/project"}' \
  | node /path/to/gate-keeper/dist/hook-receiver.js

# Simulate a file-write event (analysis)
echo '{"tool_name":"Write","tool_input":{"file_path":"/path/to/your/file.ts"}}' \
  | node /path/to/gate-keeper/dist/hook-receiver.js
```

You should see the repo and analysis appear on the daemon's stderr and in the dashboard.

---

## Setup with GitHub Copilot (VS Code)

GitHub Copilot has no hook API, so Gate Keeper uses **VS Code's built-in task runner** as a bridge. The repo ships a ready-to-use `.vscode/tasks.json` with two tasks.

### How it works

VS Code supports `"runOn": "folderOpen"` tasks that execute silently whenever a workspace is opened. The task crafts a `session_create` JSON payload and pipes it to `hook-receiver.js` — the same binary Claude Code calls:

```bash
# What the task runs on every folder open:
echo '{
  "hook_event_name": "session_create",
  "tool_name":       "vscode",
  "session_id":      "copilot-<epoch-timestamp>",
  "session_info": {
    "workspace_path": "${workspaceFolder}",
    "session_type":   "github-copilot"
  }
}' | node /path/to/gate-keeper/dist/hook-receiver.js
```

### Setup

1. Copy `.vscode/tasks.json` from this repo into your project's `.vscode/` folder (or merge if one already exists).
2. Update the path in both task `command` fields to point to your `gate-keeper/dist/hook-receiver.js`.
3. Re-open the folder in VS Code — you should see Gate Keeper register the repo silently.

The included `tasks.json` provides two tasks:

| Task | Trigger | Purpose |
|------|---------|---------|
| Gate Keeper: Register Repo on Open | `folderOpen` (automatic) | Registers the repo + starts initial scan |
| Gate Keeper: Analyze Current File | Manual (Tasks palette) | Analyze `${file}` on demand without editing it |

### Enabling `folderOpen` tasks

VS Code will prompt once to allow automatic tasks. Accept, or run the task manually via **Terminal → Run Task** on first use.

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
| `:5379` (localhost only) | Daemon IPC — receives `/analyze` and `/repo-register` from hook-receiver |
| `~/.gate-keeper/cache.db` | **SQLite database** — stores all file analyses, rating history, repo metadata, and node positions |
| `~/.gate-keeper/config.json` | Daemon config — edit `minRating` (default `6.5`) to change the blocking threshold |
| `~/.gate-keeper/daemon.pid` | PID file — hook-receiver checks daemon liveness via `kill -0` |
| `~/.gate-keeper/sessions/<id>` | Per-session marker files — prevent duplicate `UserPromptSubmit` registrations |
| `dashboard/dist/` | Built dashboard, served at `/viz/` |

### SQLite schema

The database at `~/.gate-keeper/cache.db` has four tables:

| Table | Contents |
|-------|---------|
| `analyses` | One row per file per repo — full `FileAnalysis` JSON, rating, language |
| `rating_history` | Append-only rating log per file — used for trend charts |
| `repositories` | One row per registered repo — path, name, session ID, overall rating, file count |
| `node_positions` | Saved x/y positions for each graph node — persists dashboard layout across reloads |

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
