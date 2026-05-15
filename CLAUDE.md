# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@inject `/.github/instructions/gate-keeper.instructions.md` to be mandetory rule to folow for every code action (plan, create, edit)

---

## Commands

```bash
# Build & Install
bash scripts/setup.sh               # First-time: install deps + build everything
npm run build                       # TypeScript only (src/ → dist/)
npm run build:dashboard             # Dashboard only (dashboard/src/ → dashboard/dist/)
npm run build:all                   # Build everything
npm run build:csharp                # Build Roslyn C# analyzer (requires dotnet 8+)

# Run daemon
npm run daemon                      # node dist/daemon.js
npm run dev                         # npx tsx src/daemon.ts (no build step needed)
npm run dev -- --watch              # Watch mode: polls for file changes, auto re-analyzes
npm run dev -- --query              # Interactive graph query REPL

# MCP server
npm run mcp                         # node dist/mcp/server.js
npm run mcp:dev                     # npx tsx src/mcp/server.ts

# Setup (one-shot plugin installation)
npx tsx src/cli/setup.ts --all      # hooks + VS Code + git hooks + CI + daemon
npx tsx src/cli/setup.ts --claude   # Claude Code hooks only
npx tsx src/cli/setup.ts --copilot  # .vscode/mcp.json for VS Code

# Tests
npm test                            # Run all tests (1233 across 45 suites)
npm run test:watch                  # Watch mode
npm run test:coverage               # With coverage report

# Test MCP server manually
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node dist/mcp/server.js | python3 -m json.tool

# Test hook receiver
echo '{"tool_name":"Write","tool_input":{"file_path":"/path/to/file.ts"}}' | node dist/hook-receiver.js

# Test analyzer
node -e "
const { UniversalAnalyzer } = require('./dist/analyzer/universal-analyzer');
new UniversalAnalyzer().analyze('/your/file.ts').then(r => console.log(JSON.stringify(r, null, 2)));
"
```

---

## MCP Server — 27 Tools

### Tier 1 — File Quality
- `analyze_file` — file on disk → rating, violations, metrics
- `analyze_code` — code string in memory (before writing)
- `analyze_many` — batch files, returns topologically sorted fix order
- `get_codebase_health` — scan directory: avg rating, worst files, common issues
- `get_quality_rules` — all rules, thresholds, scoring deductions

### Tier 2 — Graph Context & Dependencies
- `get_dependency_graph` — full graph: nodes, edges, coupling hotspots, cycles
- `get_file_context` — deps, reverse deps, cycles, rating breakdown, trend
- `get_impact_analysis` — direct + transitive dependents, at-risk files
- `suggest_refactoring` — ranked refactoring hints for a file
- `predict_impact_with_remediation` — blast radius + fix instructions for at-risk files
- `get_violation_patterns` — ranked violation table across the codebase

### Tier 3 — Token-Efficient Graph Queries
Replaces reading raw files (~5000 tokens each) with compact structured queries (~100–300 tokens).

- `get_impact_set(file_path, depth=2)` — BFS over dependent chain, fragility flags
- `summarize_file(file_path)` — rating, imports, dependents, violations (no raw content)
- `find_callers(symbol_name)` — call sites across all analyzed files
- `trace_path(source, target)` — shortest dependency path between two files
- `check_pre_edit_safety(file_path)` — safe / warn / block verdict before any edit
- `get_centrality_rank(limit=10)` — most connected files (god nodes), highest blast radius

### Tier 4 — Knowledge Graph Intelligence
- `get_graph_report(repo?)` — narrative: god nodes, surprising connections, suggested questions
- `query_graph(query)` — NL: "what connects X to Y?", "explain Z", "god nodes"
- `explain_node(file_path)` — deep role: centrality rank, impact set, surprising connections
- `export_graph(format, repo?)` — JSON (graphify-compatible), GraphML, Neo4j, SVG
- `merge_graphs(repo_a, repo_b)` — union-merge with min-rating conflict resolution
- `get_graph_viz(repo?, output_path?)` — writes standalone interactive HTML to disk

### Tier 5 — Platform & Workflow
- `install_platform(platform)` — write config: claude-code, copilot, cursor, vscode, github-action
- `install_git_hooks(repo?)` — post-commit + post-checkout + merge driver
- `pr_review(changed_files?)` — GREEN/YELLOW/RED per-file risk
- `get_session_metrics()` — cumulative token savings (~84% reduction vs naive reads)

---

## Architecture

### Process model

Two entry points plus the daemon:

| File | Role | Exit constraint |
|------|------|-----------------|
| `src/hook-receiver.ts` | PostToolUse + SessionStart hook | < 100 ms, exit code 2 = block |
| `src/hook-pre-tool-use.ts` | PreToolUse hook (blocks risky edits) | < 100 ms, exit code 2 = block |
| `src/daemon.ts` | Long-lived: analyzer + graph + dashboard | Binds 5378/5379 |

### Key modules

| Module | Purpose |
|--------|---------|
| `analyzer/typescript-analyzer.ts` | TS Compiler API AST analysis |
| `analyzer/csharp-analyzer.ts` | C# text/regex analysis |
| `analyzer/universal-analyzer.ts` | Language dispatcher |
| `rating/rating-calculator.ts` | 0–10 scoring (10.0 − deductions) |
| `cache/sqlite-cache.ts` | SQLite persistence |
| `graph/dependency-graph.ts` | In-memory graph + DFS cycle detection |
| `graph/graph-algorithms.ts` | BFS impact sets, degree + betweenness centrality, path tracing, token estimates |
| `graph/relationship-extractor.ts` | AST extraction: FUNCTION_CALL, CLASS_EXTENDS, IMPLEMENTS, why-comments |
| `graph/surprising-connections.ts` | Cross-module coupling ranking |
| `graph/question-suggester.ts` | Auto-generated questions from topology |
| `graph/graph-report.ts` | Narrative Markdown report generator |
| `graph/graph-export.ts` | JSON / GraphML / Neo4j / SVG export + merge function |
| `graph/graphify-ignore.ts` | .graphifyignore parser (gitignore-compatible) |
| `graph/global-graph.ts` | Cross-repo index (~/.gate-keeper/global-graph.json) |
| `mcp/server.ts` | MCP server, 27 tool definitions, JSON-RPC over stdio |
| `mcp/handlers/graph-query.ts` | 7 token-efficient query handlers |
| `mcp/handlers/graph-intelligence.ts` | 6 knowledge graph + viz handlers |
| `mcp/handlers/platform-installer.ts` | install_platform + install_git_hooks |
| `mcp/handlers/pr-review.ts` | PR risk assessment (GREEN/YELLOW/RED) |
| `mcp/token-tracker.ts` | Session token savings accumulator |
| `mcp/installer.ts` | Platform config generators (pure logic) |
| `mcp/cache-preload.ts` | Preloads graph data on MCP session start |
| `viz/viz-server.ts` | Express + WebSocket server |
| `viz/viz-routes.ts` | REST API routes including /api/impact-set |
| `viz/viz-scanner.ts` | File system scanner with .graphifyignore support |
| `viz/graph-viz.ts` | Standalone HTML force-directed visualizer (no CDN) |
| `daemon/watch-mode.ts` | fs.watchFile polling (WSL-safe) |
| `cli/setup.ts` / `cli/setup-core.ts` | One-shot plugin installer |
| `cli/query-repl.ts` | Interactive graph query REPL |
| `github/commenter.ts` | PR comment formatter |
| `github/app.ts` | GitHub App webhook skeleton |
| `hooks/git-hooks.ts` | Git hook script generators |

### Data flow

```
hook-receiver (stdin JSON)               hook-pre-tool-use (stdin JSON)
    │                                         │
    │ POST /analyze (:5379)                   │ GET /api/impact-set (:5378)
    ▼                                         ▼
┌──────────────────────────────┐
│          daemon              │
│  UniversalAnalyzer.analyze() │
│  → RatingCalculator          │
│  → SqliteCache.save()        │
│  → DependencyGraph.upsert()  │
│  → VizServer.pushAnalysis()  │
│  → WebSocket broadcast       │
└──────────────────────────────┘
```

---

## Key design decisions

- **Two-process split**: hook-receiver exits in < 100ms (exit code 2 = block). Daemon does async work.
- **PreToolUse gate**: blocks edits before they happen if 3+ fragile dependents.
- **AST-level analysis**: TypeScript Compiler API (`ts.createSourceFile`), not regex heuristics.
- **MCP over stdio**: zero network setup for AI agents. Any MCP-compatible client connects instantly.
- **`getModule()` skips `src/lib/app` prefixes**: surprising connections detect domain boundaries, not filesystem conventions.
- **`mergeGraphs` takes minimum rating on conflict**: conservative — contested quality means the worse estimate wins.
- **Watch mode uses `fs.watchFile` (stat-polling)**: same pattern as existing LCOV watcher — WSL-safe.
- **`.graphifyignore` anchored semantics**: trailing slash `src/` = directory marker, matched against repo-relative path.

---

## Test suite

- **Framework**: Jest with ts-jest preset
- **Config**: `jest.config.js` (Node environment)
- **Location**: `src/**/*.test.ts`
- **Dashboard tests**: separate `dashboard/jest.config.js`

### Coverage goals

| Module | Current | Target |
|--------|---------|--------|
| `src/graph/` | ~96% | ≥ 90% |
| `src/hooks/` | 100% | 100% |
| `src/viz/` | ~86% | ≥ 80% |
| `src/analyzer/` | ~91% | ≥ 90% |

### When adding a new MCP tool

1. Add handler function in `src/mcp/handlers/` (prefer pure logic separate from I/O)
2. Add tool definition in `src/mcp/server.ts` TOOLS array
3. Wire route in `src/mcp/handlers/index.ts`
4. Test: add `*.test.ts` for pure logic + update `server.protocol.test.ts` tool count
5. Update README.md tool listing

### When adding a new graph algorithm

1. Add to `src/graph/` as a pure function (no I/O dependencies)
2. Write unit tests with inline fixture data
3. If exposing via MCP: create handler in `src/mcp/handlers/graph-query.ts` or `graph-intelligence.ts`

---

## Quality workflow

**Mandatory:** Follow the `gate-keeper-quality` skill for every code action — session start setup, pre-edit safety checks, post-edit analysis, and bulk verification. See the skill (loaded automatically at session start) for the complete phased workflow.

---

## Ports & files

| Resource | Purpose |
|----------|---------|
| `:5378` | Dashboard HTTP + WebSocket |
| `:5379` | Daemon IPC (localhost only) |
| `~/.gate-keeper/cache.db` | SQLite — analyses, rating history, repos |
| `~/.gate-keeper/config.json` | minRating threshold (default 6.5) |
| `~/.gate-keeper/daemon.pid` | PID file for liveness checks |
| `~/.gate-keeper/global-graph.json` | Cross-repo merged graph index |
| `dashboard/dist/` | Built React app, served at `/viz/` |
