---
name: gate-keeper-quality
description: "Mandatory quality workflow for this project — every code action must pass through gate-keeper MCP tools. Invoke automatically on session start and before/after every edit."
applyTo: "**/*.{ts,tsx,jsx,js,cs}"
---

# Gate Keeper Quality Check — Mandatory Workflow

> **Every code action (plan, create, edit) must pass through the gate-keeper MCP tools. No exceptions.**

---

## Tool Cheat Sheet

| Trigger | Tools to call |
|---------|--------------|
| Session start | `get_quality_rules` → `get_graph_report` |
| Planning a change | `summarize_file` → `check_pre_edit_safety` |
| Creating a new file | `analyze_code` (preview before writing) → `analyze_file` (after writing) |
| Editing an existing file | `check_pre_edit_safety` → edit → `analyze_file` → `suggest_refactoring` (if rating < 7.0) |
| Rating still < 7.0 after fix | `analyze_file` again → repeat up to 3 cycles |
| After bulk changes (3+ files) | `get_codebase_health` |
| Starting a cleanup sprint | `get_violation_patterns` |

---

## Phase 0 — Session Start (once per session)

```
get_quality_rules   ← learn scoring thresholds
get_graph_report    ← god nodes, surprising cross-module connections, architecture overview,
                       auto-suggested questions (~1 call replaces get_dependency_graph +
                       get_centrality_rank + 5–15 summarize_file calls)
```

---

## Phase 1 — Before Any Change (plan or edit)

For any file you haven't recently touched, one call returns rating, metrics, imports, dependents, and violation counts (~300 tokens):
```
summarize_file <file>       ← replaces analyze_file + get_dependency_graph + get_impact_analysis
```

Then gate the edit with a combined impact-set BFS + fragility verdict:
```
check_pre_edit_safety <file>  ← safe / warn / block verdict with blast-radius reasoning
                                 (replaces analyze_file + get_impact_analysis + manual interpretation)
```

If the verdict is **block**, run `predict_impact_with_remediation <file>` for targeted fix steps before proceeding.

---

## Phase 2 — Writing Code

### New file
```
analyze_code <code string>   ← preview quality BEFORE writing to disk
```
Write the file only if the preview rating ≥ 7.0, or adjust the code first.

### Existing file
Edit the file, then immediately:

---

## Phase 3 — After Every Edit (MANDATORY)

```
analyze_file <absolute path>
```

| Rating | Action |
|--------|--------|
| ≥ 7.0 | ✅ Done — proceed |
| < 7.0 | Call `suggest_refactoring` → fix violations → `analyze_file` again (max 3 cycles) |

---

## Phase 4 — Post-Edit Verification

```
get_file_context <file>     ← confirm rating trend is stable or improving
```

After bulk changes (3+ files):
```
get_codebase_health         ← verify overall project quality has not degraded
```

---

## Fix Priority

1. **Errors −1.5 each** — missing `key` props, empty catch blocks
2. **Warnings −0.5 each** — `any` types, god classes, long methods (>50 lines), tight coupling
3. **Circular deps −1.0 each** — break import cycles via shared types or dependency inversion
4. **Info −0.1 each** — console.log statements

---

## Hard Rules

- Never use `any` — use specific types or `unknown`
- Never leave empty catch blocks
- Never skip `analyze_file` after editing a code file
- Never edit a file not recently touched without running `check_pre_edit_safety` first
- Never call `analyze_file + get_dependency_graph + get_impact_analysis` separately — use `summarize_file` + `check_pre_edit_safety` instead

---

## Quality Thresholds

| Metric | Deduction |
|--------|-----------|
| Error violation | −1.5 |
| Warning violation | −0.5 |
| Info violation | −0.1 |
| Cyclomatic complexity >20 / >10 | −2.0 / −1.0 |
| Import count >30 / >15 | −2.0 / −0.5 |
| Lines >500 / >300 | −1.5 / −0.5 |
| Circular dependency | −1.0 per cycle |
| Test coverage <30% / <50% / <80% | −2.5 / −2.0 / −1.0 |

**Minimum passing rating: 7.0 / 10**
