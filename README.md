# ⬡ Gate Keeper

> **Real-time architectural analysis for AI-assisted development.**  
> Gate Keeper hooks into Claude Code and GitHub Copilot, silently analyzing every file you write and broadcasting live quality metrics to a force-directed dependency graph in your browser. Its MCP server feeds dependency-graph context directly into AI agents so they understand the architecture *before* they edit.

---

## What It Does

Every time an AI agent (or you) writes or edits a `.ts`, `.tsx`, `.jsx`, `.js`, or `.cs` file, Gate Keeper:

1. **Intercepts** the `PostToolUse` event via a hook (exits in <100 ms — zero disruption to the AI)
2. **Analyzes** the file in a background daemon using the TypeScript Compiler API or C# Roslyn
3. **Rates** each file on a 0–10 architectural quality scale
4. **Broadcasts** a live update to a React dashboard over WebSocket
5. **Auto-opens** the dashboard when your overall codebase rating drops below 5.0
6. **Feeds graph context** to AI agents via MCP tools — dependencies, reverse dependencies, impact radius, cycles, and trends

The result: you can see your codebase architecture health in real time, and AI agents can *reason about* it while writing code.

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
| `GET /api/file-detail?file=<path>&repo=<root>` | Full analysis + rating breakdown + git diff |
| `GET /api/repos` | All registered repositories |

---

## MCP Server — AI Agent Integration

Gate Keeper exposes an **MCP (Model Context Protocol) server** over stdio that AI agents call during editing sessions. This is what transforms an agent from a file-level linter into an **architecture-aware code quality partner**.

### The Problem: Agents Edit Blind

Without Gate Keeper's graph context, an AI agent editing a file sees **only that file**. It has no idea:
- How many other files depend on the module it's changing
- Whether renaming an export will break 12 downstream consumers
- Whether the file sits at the center of a circular dependency cycle
- Whether quality has been trending up or down over time
- Which files in the project are already fragile and at risk

### The Solution: 7 MCP Tools

The MCP server provides **7 tools** organized in two tiers:

#### Tier 1 — File-Level Analysis (existing)

| Tool | Purpose |
|------|---------|
| `analyze_file` | Analyze a file on disk → rating, violations, metrics |
| `analyze_code` | Analyze a code string in-memory → rating, violations |
| `get_codebase_health` | Scan a directory → overall rating, worst files, common issues |
| `get_quality_rules` | List all rules, thresholds, and scoring deductions |

#### Tier 2 — Graph Context & Relationships (new)

| Tool | Purpose |
|------|---------|
| `get_file_context` | Rich context for one file: dependencies, reverse dependencies (who imports it), circular dependency cycles, rating breakdown, rating trend over time, and git diff |
| `get_dependency_graph` | Full repository dependency graph: all nodes with ratings, coupling hotspots (most-connected files), worst-rated files, circular dependencies, and complexity hotspots |
| `get_impact_analysis` | Blast radius of a file change: direct dependents, transitive dependents (BFS), and at-risk files (rating < 6) that may break from upstream changes |

### Agent Workflow

```
1. get_quality_rules        → Learn scoring system (once per session)
2. get_dependency_graph     → Understand architecture (once per session)
3. get_file_context         → Before editing: understand relationships + trends
4. [edit file]
5. analyze_file             → Validate quality (mandatory after every edit)
6. get_file_context         → After editing: verify trend is stable
7. get_impact_analysis      → If shared module: check downstream blast radius
```

### Comparison: Without vs With Graph Context

Here's a real example — an agent is asked to **refactor `types.ts`** (a shared type definitions module).

#### Without MCP graph tools — the agent sees:

```
## types.ts
Rating: 8.5/10 ✅ PASSED

Violations (1):
- WARNING [no_test_file]: No corresponding test file found

Metrics:
- Lines of Code: 136
- Cyclomatic Complexity: 1
- Methods/Functions: 0
- Imports: 0
```

The agent knows the file's rating and its 1 violation. That's it. It has **zero awareness** of how this file relates to the rest of the codebase.

#### With MCP graph tools — the agent also sees:

**`get_file_context` returns:**
```
## File Context: types.ts
Rating: 8.5/10

Used By (12 files depend on this):
- viz-server.ts (rating: 5)
- mcp/server.ts (rating: 5)
- coverage-analyzer.ts (rating: 5)
- rating-calculator.ts (rating: 7.5)
- dependency-graph.ts (rating: 6.5)
- daemon.ts (rating: 7.5)
- ... and 6 more

Rating Breakdown:
- Warnings (1): −0.5
- Low Test Coverage: −1.0 (0% < 50%)
Final: 8.5/10

Rating Trend (last 20 analyses):
10 → 8.5 (📉 declining)
```

**`get_impact_analysis` returns:**
```
## Impact Analysis: types.ts
Direct dependents: 12 | Total affected (transitive): 12

⚠️ At-Risk Dependents (rating < 6):
- 5/10 — viz-server.ts (1 violations)
- 5/10 — mcp/server.ts (1 violations)
- 5/10 — coverage-analyzer.ts (1 violations)
```

**`get_dependency_graph` returns:**
```
## Dependency Graph
Files: 25 | Edges: 41 | Overall Rating: 6.6/10

Most Connected Files (coupling hotspots):
- 12 connections — types.ts (rating: 8.5)   ← #1 most connected
- 8 connections — universal-analyzer.ts
- 8 connections — dashboard/types.ts
```

#### How this changes agent behavior:

| Decision Point | Without Context | With Context |
|---|---|---|
| **Should I rename this interface?** | "Rating is 8.5, looks fine — go ahead" | "12 files import this. 3 dependents are already at rating 5. Renaming will break them — use a backward-compatible approach" |
| **How cautious should I be?** | No signal | "This is the #1 most-connected node in the repo — proceed carefully" |
| **Is quality improving here?** | No signal | "Declining from 10 → 8.5 — this file needs care, not more churn" |
| **What to fix next?** | No signal | "3 at-risk dependents at 5/10 — fix those before they fail further" |
| **Are there circular deps?** | No signal | "0 cycles — safe on that front" |

### VS Code MCP Setup

Add to your VS Code `settings.json` or `.vscode/mcp.json`:

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

### Test the MCP Server

```bash
# Initialize
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | node dist/mcp/server.js

# List available tools
echo '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | node dist/mcp/server.js

# Analyze a file
echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"analyze_file","arguments":{"file_path":"/path/to/file.ts"}}}' | node dist/mcp/server.js

# Get file context (dependencies, dependents, cycles, trends)
echo '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_file_context","arguments":{"file_path":"/path/to/file.ts"}}}' | node dist/mcp/server.js

# Get dependency graph for the repo
echo '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"get_dependency_graph","arguments":{"repo":"/path/to/repo"}}}' | node dist/mcp/server.js

# Get impact analysis before editing a shared module
echo '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"get_impact_analysis","arguments":{"file_path":"/path/to/shared/types.ts"}}}' | node dist/mcp/server.js
```

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
│   │   ├── csharp-analyzer.ts     # Roslyn CLI / text fallback
│   │   ├── coverage-analyzer.ts   # lcov.info test coverage analysis
│   │   └── string-analyzer.ts     # In-memory code string analysis
│   ├── cache/
│   │   └── sqlite-cache.ts      # SQLite persistence (analyses + rating_history)
│   ├── graph/
│   │   └── dependency-graph.ts  # In-memory graph, DFS cycle detection
│   ├── mcp/
│   │   └── server.ts            # MCP server — 7 tools for AI agents (stdio JSON-RPC)
│   ├── rating/
│   │   └── rating-calculator.ts # 0–10 rating formula
│   └── viz/
│       └── viz-server.ts        # Express + WebSocket server
├── dashboard/
│   └── src/
│       ├── App.tsx              # WebSocket client, state management
│       ├── components/
│       │   ├── GraphView.tsx    # react-force-graph-2d canvas renderer
│       │   ├── DetailPanel.tsx  # File detail: rating breakdown, violations, deps
│       │   ├── FileListDrawer.tsx # Sortable file list with search
│       │   ├── Sidebar.tsx      # Metrics panel + violation list
│       │   ├── ViolationsPanel.tsx # Violation summary panel
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
curl 'http://localhost:5378/api/file-detail?file=/path/to/file.ts&repo=/path/to/repo'
curl 'http://localhost:5378/api/graph?repo=/path/to/repo'
curl 'http://localhost:5378/api/cycles?repo=/path/to/repo'

# Test MCP tools (JSON-RPC over stdio)
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_dependency_graph","arguments":{"repo":"/path/to/repo"}}}' \
  | node dist/mcp/server.js
echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_file_context","arguments":{"file_path":"/path/to/file.ts"}}}' \
  | node dist/mcp/server.js
echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_impact_analysis","arguments":{"file_path":"/path/to/file.ts"}}}' \
  | node dist/mcp/server.js
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

The database at `~/.gate-keeper/cache.db` has five tables:

| Table | Contents |
|-------|---------|
| `analyses` | One row per file per repo — full `FileAnalysis` JSON, rating, language |
| `rating_history` | Append-only rating log per file — used for trend charts |
| `repositories` | One row per registered repo — path, name, session ID, overall rating, file count |
| `node_positions` | Saved x/y positions for each graph node — persists dashboard layout across reloads |
| `exclude_patterns` | User-defined scan exclusion patterns per repo |

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
