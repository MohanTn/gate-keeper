---
applyTo: "**/*.{ts,tsx,jsx,js,cs}"
---

# BLOCKING: Gate Keeper Quality Check — Mandatory Post-Edit Workflow

> **STOP. You are editing a code file. You MUST NOT respond to the user or proceed to any other task until you complete the quality check below. This is a hard gate — no exceptions.**

Every time you edit or create a `.ts`, `.tsx`, `.jsx`, `.js`, or `.cs` file, you **MUST** run a quality check using the Gate Keeper MCP tools before considering the edit complete.

Gate Keeper exposes **11 MCP tools**. Every response includes both **`content[0].text`** (markdown for humans) and **`structuredContent`** (JSON envelope `{ version, tool, generatedAt, data }` for autonomous agents). Read `structuredContent.data` whenever you can — it carries precise spans, deterministic fix replacements, file hashes, priority scores, and topological fix orders that markdown summaries omit.

## Phase 1: Investigation — Gather Context BEFORE Editing

Before making non-trivial changes, use the graph-context tools to understand the file's role in the codebase.

### Session Start (once)

1. Call **`get_quality_rules`** — learn the scoring system and thresholds. `structuredContent.data.rules` lists every canonical `ruleId` (e.g. `ts/no-any`, `cs/empty-catch`) with its `severity`, `deduction`, and a `fixable: boolean` flag telling you which rules support deterministic auto-fix.
2. Call **`get_dependency_graph`** — repository architecture. Reads `structuredContent.data.{nodes, edges, cycles, mostConnected, worstFiles, complexityHotspots, adjacency, reverseAdjacency}`. The `adjacency` / `reverseAdjacency` maps are pre-built so you don't have to rebuild them.

### Before Each Edit

3. Call **`get_file_context`** with the file you plan to edit:
   - `data.file` — full `FileAnalysis` (with span-enriched violations, see Phase 2)
   - `data.imports` / `data.dependents` — `GraphEdge[]` lists
   - `data.cycles` — `CycleInfo[]` the file participates in (−1.0 rating each)
   - `data.ratingBreakdown` — itemized deductions explaining the current score
   - `data.ratingTrend` — historical ratings (improving / declining / stable)
   - `data.gitDiff` — `+added / −removed` lines

4. If the file has **many reverse dependents** (widely imported), call **`get_impact_analysis`**:
   - `data.direct` / `data.transitive` — affected file paths
   - `data.atRisk` — fragile dependents (`rating < 6`) likely to break

5. For surgical, agent-driven remediation of downstream files, call **`predict_impact_with_remediation`**:
   - `data.steps` — `RemediationStep[]` pre-sorted in topological fix order (`dependencyOrder` 0..N, leaves first)
   - each step carries `filePath`, `ruleId`, `span`, `action` (`'replace' | 'manual'`), optional `replacement`, and `estimatedRatingGain`
   - `data.estimatedTotalGain` — expected rating uplift if every step is applied

**Use this context to guide edits**: avoid breaking widely-used modules, fix circular dependencies, prioritize at-risk dependents.

## Phase 2: Quality Gate — Validate AFTER Editing (MANDATORY — DO NOT SKIP)

1. **After every file edit** → call **`analyze_file`** with the absolute path of the edited file.
2. **Read `structuredContent.data`** (a `FileAnalysis`):
   - `rating` — 0–10 score
   - `fileHash` — sha1 of file bytes. **Compare with the previous attempt** — if unchanged, your "fix" was a no-op; stop the retry loop.
   - `analyzerVersion` — schema version (currently `'2.0'`)
   - `ratingBreakdown` — per-category deductions with optional `ruleId`
   - `violations` — **pre-sorted desc by `priorityScore`**, so `violations[0]` is always the highest-leverage fix
3. **If rating < 7.0** → fix the reported violations:
   - For each violation, inspect `v.fix`:
     - If `typeof v.fix === 'object' && v.fix.confidence === 'deterministic'`, splice `v.fix.replacement` at `v.fix.replaceSpan` (byte coordinates via `span.offset` + `span.length`). **No LLM tokens required.** Currently auto-fixable rules: `ts/no-any` → `unknown`, `ts/no-console` → `logger.debug`.
     - Otherwise read `v.codeSnippet` (±1 line of context) and `v.fix.description` (or string), then edit.
4. **Repeat** until the rating is ≥ 7.0 (max 3 cycles). Bail out if `fileHash` stops changing.
5. **If rating ≥ 7.0** → the edit is complete, you may proceed.

**If you skip this step, you are violating a mandatory project policy.**

### Batching N files

For edits spanning multiple files, call **`analyze_many`** instead of looping `analyze_file`:
- Input: `{ file_paths: string[], max_parallel?: number }` (default 4, clamped to 1–16)
- Returns `data.analyses` (parallel-analyzed `FileAnalysis[]`) + `data.fixOrder` — a topologically sorted path list (leaves first) so dependents re-analyze cleanly against already-fixed dependencies. One MCP round-trip instead of N.

## Phase 3: Post-Edit Verification — Check Downstream Impact

After your edits pass the quality gate:

6. Call **`get_file_context`** on the edited file — confirm `data.ratingTrend` is stable or improving.
7. If you edited a shared module (identified in Phase 1), call **`get_impact_analysis`** — check if `data.atRisk` files need re-analysis.
8. For bulk changes, call **`get_codebase_health`**:
   - `data.avgRating` — overall project rating
   - `data.distribution` — `{ excellent, good, poor }` file buckets
   - `data.worstFiles` — `FileAnalysis[]` below the threshold
   - `data.topViolationTypes` — `[{ type, count }, …]` for the codebase
   - `data.fixOrder` — full project topo order, leaves first

## Tool Reference (all 11)

### Analysis Tools

| Tool | When to Use | `structuredContent.data` shape |
|------|-------------|----------------------------|
| `analyze_file` | **MANDATORY** after every file edit | `FileAnalysis` (with span-enriched violations, `ratingBreakdown`, `fileHash`, `analyzerVersion`) |
| `analyze_code` | Preview quality of an in-memory snippet | `StringAnalysisResult` (no `fileHash` / `codeSnippet` — string mode is stateless) |
| `analyze_many` | Batch analyze N files in one call | `{ analyses: FileAnalysis[], fixOrder: string[] }` |
| `get_quality_rules` | Learn scoring rules (read once per session) | `{ minRating, rules: [{ ruleId, severity, deduction, description, fixable }] }` |
| `get_codebase_health` | Check overall project quality after bulk changes | `{ avgRating, fileCount, distribution, worstFiles, topViolationTypes, fixOrder }` |

### Graph Context Tools — Dependency Tree & Relationships

| Tool | When to Use | `structuredContent.data` shape |
|------|-------------|----------------------------|
| `get_file_context` | Before editing — file's role in the graph | `{ filePath, rating, file, imports, dependents, cycles, ratingBreakdown, ratingTrend, gitDiff }` |
| `get_dependency_graph` | Session start — architecture overview | `{ nodes, edges, cycles, overallRating, distribution, mostConnected, worstFiles, complexityHotspots, adjacency, reverseAdjacency }` |
| `get_impact_analysis` | Before editing a shared module | `{ filePath, direct, transitive, atRisk: FileAnalysis[] }` |

### Remediation Tools

| Tool | When to Use | `structuredContent.data` shape |
|------|-------------|----------------------------|
| `suggest_refactoring` | After `analyze_file` returns a rating below 7.0 | `{ file: FileAnalysis, hints: RefactoringHint[], rating, totalPotentialGain }` |
| `predict_impact_with_remediation` | Before editing widely-imported files — get a structured fix plan | `RemediationPlan { rootFile, blastRadius:{direct,transitive}, steps:RemediationStep[], estimatedTotalGain }` |
| `get_violation_patterns` | Cleanup-sprint planning | `{ repo, patterns: PatternReport[], totalGain, fixOrder }` |

## Enriched `Violation` Schema (Phase 1+3+4)

Every violation returned by `analyze_file` / `analyze_many` / `suggest_refactoring` includes:

```ts
{
  type: string;              // legacy kebab id (e.g. 'any_type')
  ruleId: string;            // canonical (e.g. 'ts/no-any', 'cs/empty-catch', 'react/jsx-key')
  severity: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
  span?: {                   // precise 1-based location, offset+length for byte splicing
    line: number; column: number;
    endLine: number; endColumn: number;
    offset?: number; length?: number;
  };
  codeSnippet?: string;      // ±1 line of context around span
  priorityScore?: number;    // severity_weight / (deterministic ? 1 : 3) — already sorted
  fix?: string | {
    description: string;
    replacement?: string;    // splice me when confidence === 'deterministic'
    replaceSpan?: Span;
    confidence: 'deterministic' | 'heuristic' | 'manual';
  };
}
```

## Canonical Rule IDs

**TypeScript / JavaScript:** `ts/no-any`, `ts/no-console` *(both deterministically auto-fixable)*, `ts/no-todo`, `ts/tech-debt`, `ts/no-stub`, `react/jsx-key`, `react/no-inline-handler`, `react/hook-count`, `react/no-duplicate-hooks`.

**C# / .NET:** `cs/god-class`, `cs/long-method`, `cs/tight-coupling`, `cs/magic-number`, `cs/empty-catch`, `cs/no-todo`, `cs/tech-debt`, `cs/no-stub`.

## Fix Priority

Fix violations in this order (highest impact first):
1. **Errors** (−1.5 pts each): missing `key` props, empty catch blocks, unimplemented stubs
2. **Circular dependencies** (−1.0 each): break import cycles between files
3. **Warnings** (−0.5 pts each): `any` usage, god classes, long methods, tight coupling
4. **Info** (−0.1 pts each): console.log statements

Within a file, `violations[0]` from any analyze call is already the highest-priority fix (deterministic-fixable errors come before manual-fix warnings, etc.). Trust the order.

## Autonomous Queue Loop (reference)

Combining the agent-grade features into a fix-and-retry loop:

```text
batch = analyze_many(file_paths=changed, max_parallel=8)
for path in batch.data.fixOrder:                          # leaves before dependents
  analysis = pick(batch.data.analyses, path)
  last_hash = null
  while analysis.rating < 7.0 and analysis.fileHash != last_hash:
    v = analysis.violations[0]                            # highest priorityScore
    if v.fix.confidence == 'deterministic':
      splice(path, v.fix.replaceSpan, v.fix.replacement)  # zero tokens
    else:
      llm.fix(path, v.codeSnippet, v.fix.description)     # spend tokens
    last_hash = analysis.fileHash
    analysis = analyze_file(path)
```

The `fileHash` no-op detection prevents infinite loops. The pre-sorted `violations[0]` greedy choice is provably optimal for rating-gain-per-token.

## Do NOT

- Skip the quality check after editing code files
- Ignore violations and move on to the next task
- Edit widely-imported files without checking impact analysis first
- Use `any` type — use specific types or `unknown` (this rule is **auto-fixable** via the deterministic `Fix.replacement`)
- Leave empty catch blocks — always handle or log errors
- Write methods longer than 50 lines
- Ignore circular dependency warnings — they compound rating penalties
- Parse markdown when `structuredContent.data` is available — the JSON envelope is more precise, more stable, and cheaper to consume

## Quality Thresholds Reference

- Minimum passing rating: **7.0/10**
- Error violations: −1.5 pts each
- Warning violations: −0.5 pts each
- Info violations: −0.1 pts each
- Cyclomatic complexity >20: −2.0 | >10: −1.0
- Import count >30: −2.0 | >15: −0.5
- Lines of code >500: −1.5 | >300: −0.5
- Circular dependency: −1.0 per cycle
- Test coverage <30%: −2.5 | <50%: −2.0 | <80%: −1.0

## MCP Server Setup

The Gate Keeper MCP server runs via `npm run mcp:dev` (TypeScript via `tsx`) or `node dist/mcp/server.js` after `npm run build`. Configure it in VS Code via `.vscode/mcp.json` (see `docs/copilot-setup.md`). The dashboard daemon (`npm run daemon`) on `:5378` is required for graph-backed tools (`get_file_context`, `get_dependency_graph`, `get_impact_analysis`, `predict_impact_with_remediation`, `get_violation_patterns`).
