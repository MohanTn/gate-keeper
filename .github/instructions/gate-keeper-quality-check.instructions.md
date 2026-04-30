---
applyTo: "**/*.{ts,tsx,jsx,js,cs}"
---

# BLOCKING: Gate Keeper Quality Check — Mandatory Post-Edit Workflow

> **STOP. You are editing a code file. You MUST NOT respond to the user or proceed to any other task until you complete the quality check below. This is a hard gate — no exceptions.**

Every time you edit or create a `.ts`, `.tsx`, `.jsx`, `.js`, or `.cs` file, you **MUST** run a quality check using the Gate Keeper MCP tools before considering the edit complete.

## Phase 1: Investigation — Gather Context BEFORE Editing

Before making non-trivial changes, use the graph-context tools to understand the file's role in the codebase. This prevents blind edits that break downstream consumers or miss circular dependency issues.

### Session Start (once)

1. Call `get_quality_rules` — learn the scoring system and thresholds
2. Call `get_dependency_graph` — understand the repository architecture, coupling hotspots, worst-rated files, and circular dependencies

### Before Each Edit

3. Call `get_file_context` with the file you plan to edit — this returns:
   - **Dependencies** — files it imports (with their ratings)
   - **Reverse dependencies** — files that import *this* file (the "used by" list)
   - **Circular dependency cycles** the file participates in (−1.0 rating penalty each)
   - **Rating breakdown** — itemized deductions explaining the current score
   - **Rating trend** — whether quality is improving or declining over time
   - **Git diff** — size of uncommitted changes

4. If the file has **many reverse dependencies** (widely imported), call `get_impact_analysis` to see the full blast radius:
   - **Direct dependents** — files that import the changed file
   - **Transitive dependents** — the full cascade of affected files
   - **At-risk dependents** — already-fragile files (rating < 6) that may break from upstream changes

**Use this context to guide your edits:** avoid introducing breaking changes to widely-used modules, fix circular dependencies when you encounter them, and prioritize fixing at-risk dependents.

## Phase 2: Quality Gate — Validate AFTER Editing (MANDATORY — DO NOT SKIP)

1. **After every file edit** → call `analyze_file` with the absolute path of the edited file
2. **Read the result** — rating, violations, and metrics are returned
3. **If rating < 7.0** → fix the reported violations, then re-analyze
4. **Repeat** until the rating is ≥ 7.0 (max 3 cycles)
5. **If rating ≥ 7.0** → the edit is complete, you may proceed

**If you skip this step, you are violating a mandatory project policy.**

## Phase 3: Post-Edit Verification — Check Downstream Impact

After your edit passes the quality gate:

6. Call `get_file_context` again on the edited file — verify the rating trend is stable or improving
7. If you edited a shared module (identified in Phase 1), call `get_impact_analysis` — check if at-risk dependents need re-analysis
8. For bulk changes across multiple files, call `get_codebase_health` to verify overall project quality has not degraded

## Tool Reference

### Analysis Tools

| Tool | When to Use |
|------|-------------|
| `analyze_file` | **MANDATORY** after every file edit |
| `analyze_code` | Before writing code to disk (preview quality) |
| `get_quality_rules` | Learn scoring rules (read once per session) |
| `get_codebase_health` | Check overall project quality after bulk changes |

### Graph Context Tools — Dependency Tree & Relationships

| Tool | When to Use |
|------|-------------|
| `get_file_context` | Before editing — understand a file's dependencies, dependents, cycles, rating trend, and breakdown |
| `get_dependency_graph` | At session start — understand architecture, coupling hotspots, worst files, circular dependencies |
| `get_impact_analysis` | Before editing a shared module — find all direct and transitive dependents and at-risk files |

### How Graph Context Improves Your Analysis

- **Dependency awareness** — Know what a file imports and what imports it. Avoid breaking changes to widely-used exports.
- **Circular dependency detection** — Each cycle costs −1.0 rating. Break cycles by extracting shared types or using dependency inversion.
- **Coupling hotspots** — Files with the most connections are the riskiest to change. Proceed with extra caution.
- **Rating trends** — A declining trend means the file is getting worse over time. Prioritize fixing it now.
- **Impact radius** — Before editing a utility or type definition, check how many files will be affected downstream.
- **At-risk dependents** — Files already below rating 6 are fragile. Upstream changes may push them further down.

## Fix Priority

Fix violations in this order (highest impact first):
1. **Errors** (−1.5 pts each): missing `key` props, empty catch blocks
2. **Warnings** (−0.5 pts each): `any` usage, god classes, long methods, tight coupling
3. **Info** (−0.1 pts each): console.log statements
4. **Circular dependencies** (−1.0 each): break import cycles between files

## Do NOT

- Skip the quality check after editing code files
- Ignore violations and move on to the next task
- Edit widely-imported files without checking impact analysis first
- Use `any` type — use specific types or `unknown`
- Leave empty catch blocks — always handle or log errors
- Write methods longer than 50 lines
- Ignore circular dependency warnings — they compound rating penalties
