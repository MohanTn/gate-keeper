<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg" alt="Node >= 18">
  <img src="https://img.shields.io/badge/TypeScript-5.0+-3178C6.svg" alt="TypeScript">
  <img src="https://img.shields.io/badge/MCP-ready-6C47FF.svg" alt="MCP Ready">
</p>

<h1 align="center">⬡ Gate Keeper</h1>
<p align="center"><strong>Graph-aware quality gates for AI-assisted development.</strong></p>
<p align="center">Every AI agent edit runs through real-time architectural analysis — violations are caught, trends are tracked, and a live dependency graph keeps the big picture in view. Your AI doesn't just lint files; it understands the <em>codebase</em>.</p>

---

## Why Gate Keeper?

AI agents are great at writing code — but they edit blind. An agent refining a utility function has no idea that 12 files depend on it, that it sits at the center of a circular dependency, or that three downstream modules are already fragile. **Gate Keeper is the observability layer that fixes that.**

Every file write is analyzed in real time (TypeScript Compiler API / Roslyn), rated on a 0–10 architectural quality scale, and published to a live force-directed dependency graph — visible in your browser and queryable by AI agents through an MCP server.

---

## Quick Start

```bash
git clone https://github.com/your-org/gate-keeper.git
cd gate-keeper
bash scripts/setup.sh        # install + build everything
npm run daemon               # start the daemon
```

Open **http://localhost:5378/viz** — you're live.

---

## What Makes It Different

### AI agents see the graph, not just the file

Most code quality tools are linters — they look at one file and flag one violation. Gate Keeper gives AI agents a **full architectural model** of the project. Before an agent edits a file, it can ask:

| Without Gate Keeper | With Gate Keeper |
|---|---|
| "This file has rating 8.5 — looks clean, go ahead." | "12 files import this. 3 dependents are already at rating 5. Renaming this export will break them — use a backward-compatible approach." |
| No signal about coupling. | "This is the #1 most-connected node in the repo — proceed carefully." |
| No trend data. | "Rating declined from 10 → 8.5 over the last 20 edits — this file needs care, not more churn." |
| No cycle detection. | "0 circular dependencies — safe on that front." |

The result: agents produce **architecturally coherent** code on the first attempt, not just syntactically correct code.

### Live dashboard — real-time visibility

A force-directed dependency graph updates with every edit. Node colors encode quality (green → red), shapes encode language, and size encodes complexity. Click any node to drill into violations, metrics, dependencies, and rating history.

### Two layers, zero latency impact

Gate Keeper splits into a **hook-receiver** (exits in < 100 ms — never blocks your AI agent) and a **daemon** (long-lived process that does the heavy lifting). The AI never waits.

---

## Features

- **Real-time analysis** — every Write/Edit triggers AST-level analysis via TypeScript Compiler API or Roslyn
- **7 MCP tools for AI agents** — dependency graph context, impact analysis, quality rules, file context with trends
- **Live dashboard** — force-directed graph with color-coded quality metrics, drill-down detail, and hot spot tracking
- **Circular dependency detection** — iterative DFS with per-cycle scoring (−1.0 per cycle)
- **Rating history & trends** — per-file append-only log, visible from MCP tools and dashboard
- **Dual-platform hooks** — Claude Code (native hooks) + GitHub Copilot (VS Code tasks)
- **Multi-language** — TypeScript, JavaScript, React/JSX, C# (Roslyn or text fallback)
- **Configurable quality gates** — set your own `minRating` threshold

---

## MCP Server — Your Agent's Architecture Radar

Gate Keeper ships with an **MCP (Model Context Protocol) server** that any MCP-compatible AI client (Claude Code, GitHub Copilot in VS Code, any MCP host) can call during a session.

### The 7 Tools

```
Tier 1 — File Quality (classic linting)
  analyze_file       →  rating + violations + metrics for a file on disk
  analyze_code       →  same, but for a code string in memory (before writing)
  get_codebase_health →  scan a directory: average rating, worst files, common violations
  get_quality_rules  →  all rules, thresholds, and scoring deductions

Tier 2 — Graph Context & Relationships (what makes Gate Keeper unique)
  get_file_context       →  dependencies, reverse deps, cycles, rating breakdown, trend
  get_dependency_graph   →  full graph: nodes, edges, coupling hotspots, circular deps
  get_impact_analysis    →  blast radius: direct + transitive dependents, at-risk files
```

### Agent Workflow

```
1. get_quality_rules        → learn what "good" means in this project
2. get_dependency_graph     → understand architecture before the first edit
3. get_file_context         → before touching a file: who depends on it?
4. [edit file]
5. analyze_file             → validate quality after every edit
6. get_file_context         → verify rating trend is stable or improving
7. get_impact_analysis      → if it's a shared module: check downstream blast radius
```

### VS Code MCP Setup

Add to `.vscode/mcp.json`:

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

# List tools
echo '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | node dist/mcp/server.js

# Analyze a file
echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"analyze_file","arguments":{"file_path":"/path/to/file.ts"}}}' | node dist/mcp/server.js

# Get file context
echo '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_file_context","arguments":{"file_path":"/path/to/file.ts"}}}' | node dist/mcp/server.js

# Get dependency graph
echo '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"get_dependency_graph","arguments":{"repo":"/path/to/repo"}}}' | node dist/mcp/server.js

# Get impact analysis
echo '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"get_impact_analysis","arguments":{"file_path":"/path/to/shared/types.ts"}}}' | node dist/mcp/server.js
```

---

## Dashboard

Open **http://localhost:5378/viz** after starting the daemon.

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

- **Node shape** encodes language: circle = TS/JS, square = C#, triangle = TSX/JSX
- **Node color** encodes rating: green ≥8, yellow ≥6, orange ≥4, red <4
- **Node size** scales with lines of code
- **Edge direction** shows import direction; blue = `import`, orange = other
- Click any node to drill into violations, metrics, and dependencies

### Sidebar

- Overall architecture rating and trend
- Total files, cycles, and violations
- Top 5 hotspots (lowest-rated files)
- Per-file details: LOC, cyclomatic complexity, method count, import count, violations

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

## Installation

### Prerequisites

- **Node.js** 18 or later
- **npm** 9 or later
- **.NET 8 SDK** (optional — enables Roslyn-based C# analysis; falls back to text analysis without it)

### Setup

```bash
git clone https://github.com/your-org/gate-keeper.git
cd gate-keeper
bash scripts/setup.sh
```

Or step by step:

```bash
npm install
npm run build
npm run build:dashboard
```

### Claude Code Setup

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node /path/to/gate-keeper/dist/hook-receiver.js" }] }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [{ "type": "command", "command": "node /path/to/gate-keeper/dist/hook-receiver.js" }]
      }
    ]
  }
}
```

Replace `/path/to/gate-keeper` with the actual installation path.

### GitHub Copilot (VS Code)

Copy `.vscode/tasks.json` into your project and update the path. The `folderOpen` task registers your repo with Gate Keeper automatically on workspace open.

---

## Architecture

Gate Keeper runs as **two processes** plus a React dashboard.

```
Claude Code                    GitHub Copilot (VS Code)
    │                                   │
    │  SessionStart hook                 │  folderOpen task
    │  PostToolUse hook (Write/Edit)     │
    ▼                                   ▼
┌──────────────────────────────────────────┐
│             hook-receiver.ts             │  exits < 100 ms
│  POST /analyze → daemon                  │  fire-and-forget
└───────────────────┬──────────────────────┘
                    │  HTTP :5379
                    ▼
┌──────────────────────────────────────┐
│            daemon.ts                 │
│  UniversalAnalyzer → RatingCalc      │
│  DependencyGraph → VizServer         │
│  SqliteCache (persistence)           │
└──────────┬───────────────────────────┘
           │  WebSocket :5378
           ▼
┌──────────────────────┐
│  React Dashboard     │  http://localhost:5378/viz
│  (Vite + force-graph)│
└──────────────────────┘
```

### Key Design Decisions

| Decision | Why |
|----------|-----|
| **Two-process split** | Hook-receiver exits in < 100 ms so the AI agent is never blocked. The daemon does all heavy work asynchronously. |
| **AST-level analysis** | TypeScript Compiler API and Roslyn give accurate, structure-aware detection — not regex heuristics. |
| **MCP over stdio** | Zero network setup for AI agents. Any MCP-compatible client connects instantly. |
| **SQLite persistence** | Rating history and graphs survive daemon restarts. No external database needed. |
| **WebSocket broadcast** | Dashboard updates in real time — no polling, no refresh. |

---

## Rating System

Each file is rated **0–10** (higher is better).

| Deduction | Condition |
|-----------|-----------|
| −1.5 per `error` violation | e.g. missing `key` prop, empty catch |
| −0.5 per `warning` violation | e.g. `any` type, god class |
| −0.1 per `info` violation | e.g. `console.log`, magic number |
| −2.0 | Cyclomatic complexity > 20 |
| −1.0 | Cyclomatic complexity > 10 |
| −2.0 | Import count > 30 |
| −0.5 | Import count > 15 |
| −1.5 | Lines of code > 500 |
| −0.5 | Lines of code > 300 |
| −1.0 per cycle | Circular dependencies |

The overall codebase rating is the mean across all analyzed files. The dashboard auto-opens when overall rating drops below **5.0**.

---

## Violation Reference

### TypeScript / JavaScript / React (`.ts`, `.tsx`, `.js`, `.jsx`)

| Violation | Severity | What it catches |
|-----------|----------|-----------------|
| `missing_key` | **error** | JSX elements in `.map()` missing the `key` prop |
| `empty_catch` | **error** | Empty catch blocks swallowing exceptions |
| `hook_overload` | warning | React component with > 7 hooks |
| `duplicate_hooks` | warning | Same hook called more than once |
| `any_type` | warning | Explicit `any` — use specific types or `unknown` |
| `inline_handler` | info | Inline arrow functions in JSX event props |
| `console_log` | info | `console.log` in production code |

### C# (`.cs`)

| Violation | Severity | What it catches |
|-----------|----------|-----------------|
| `empty_catch` | **error** | Empty catch block |
| `god_class` | warning | Class with > 20 methods |
| `long_method` | warning | Method body > 50 lines |
| `tight_coupling` | warning | Constructor with > 5 parameters |
| `magic_number` | info | Unnamed numeric constants |

---

## Development

### Project Layout

```
gate-keeper/
├── src/
│   ├── hook-receiver.ts              # Invoked by AI hooks, exits < 100ms
│   ├── daemon.ts                     # Long-lived process
│   ├── types.ts                      # Shared interfaces
│   ├── analyzer/
│   │   ├── universal-analyzer.ts     # Language dispatch
│   │   ├── typescript-analyzer.ts    # TS Compiler API
│   │   ├── csharp-analyzer.ts        # Roslyn / text fallback
│   │   ├── coverage-analyzer.ts      # lcov coverage
│   │   └── string-analyzer.ts        # In-memory analysis
│   ├── cache/sqlite-cache.ts         # SQLite persistence
│   ├── graph/dependency-graph.ts     # In-memory graph + cycle detection
│   ├── mcp/server.ts                 # MCP server (7 tools)
│   ├── rating/rating-calculator.ts   # 0–10 scoring
│   └── viz/viz-server.ts            # Express + WebSocket
├── dashboard/src/
│   ├── App.tsx                       # WebSocket client + state
│   └── components/
│       ├── GraphView.tsx             # Force-directed graph
│       ├── DetailPanel.tsx           # File drill-down
│       ├── Sidebar.tsx               # Metrics panel
│       ├── ViolationsPanel.tsx       # Violation summary
│       └── MetricCard.tsx            # Metric display
└── scripts/setup.sh
```

### Commands

```bash
npm run build              # Compile src/ → dist/
npm run build:dashboard    # Build dashboard
npm run build:all          # Build everything
npm run daemon             # Start daemon (node dist/daemon.js)
npm run dev                # Start daemon (tsx, no build)
npm run mcp                # Start MCP server
npm run mcp:dev            # Start MCP server in dev mode
npm test                   # Run tests
npm run test:coverage      # Tests with coverage report
```

### Test the Hook Receiver

```bash
# Register a repo (simulates SessionStart)
echo '{"hook_event_name":"SessionStart","session_id":"test-123","cwd":"/path/to/repo"}' \
  | node dist/hook-receiver.js

# Analyze a file (simulates PostToolUse Write/Edit)
echo '{"tool_name":"Write","tool_input":{"file_path":"/path/to/file.ts"}}' \
  | node dist/hook-receiver.js
```

---

## Ports & Files Reference

| Resource | Purpose |
|----------|---------|
| `:5378` | Dashboard HTTP + WebSocket |
| `:5379` | Daemon IPC (localhost only) |
| `~/.gate-keeper/cache.db` | SQLite — analyses, rating history, repos, node positions |
| `~/.gate-keeper/config.json` | Daemon config — change `minRating` (default `6.5`) |
| `~/.gate-keeper/daemon.pid` | PID file for liveness checks |
| `dashboard/dist/` | Built React app, served at `/viz/` |

---

## Contributing

1. Fork and create a feature branch
2. Make changes in `src/` or `dashboard/src/`
3. Build: `npm run build:all`
4. Test with the manual testing commands above
5. Open a PR describing what violation or metric you added and why

---

## License

MIT — see [LICENSE](LICENSE).
