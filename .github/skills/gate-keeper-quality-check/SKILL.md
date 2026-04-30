---
name: gate-keeper-quality-check
description: >
  Automated code quality gate using Gate Keeper MCP tools. Loaded automatically when editing
  .ts, .tsx, .jsx, .js, or .cs files. Enforces a quality-check-then-fix loop after every file
  edit until the code meets the minimum rating threshold. Teaches the agent the scoring system,
  violation types, fix strategies, and the correct tool-call sequence.
---

# Gate Keeper Quality Check Skill

## Purpose

Ensure every code edit passes Gate Keeper's quality analysis before the task is considered done.
The agent calls MCP tools after each file edit, reads the rating and violations, and self-corrects
until the code meets the threshold.

---

## Workflow

```
┌─────────────────────────────────────┐
│  Agent edits / creates a file       │
└──────────────┬──────────────────────┘
               ▼
┌─────────────────────────────────────┐
│  Call: analyze_file(file_path)      │
└──────────────┬──────────────────────┘
               ▼
        ┌─────────────┐
        │ Rating ≥ 7?  │──── YES ──→ ✅ Done
        └──────┬──────┘
               │ NO
               ▼
┌─────────────────────────────────────┐
│  Read violations                    │
│  Fix errors first, then warnings    │
│  Re-edit the file                   │
└──────────────┬──────────────────────┘
               │
               └──→ Loop back to analyze_file
```

### Step-by-Step

1. **Edit the file** as requested by the user
2. **Call `analyze_file`** with the absolute file path
3. **Check the rating** — if ≥ threshold (default 7.0), you're done
4. **If below threshold**, read each violation and fix it:
   - Errors first (−1.5 pts each) — these have the biggest impact
   - Warnings next (−0.5 pts each)
   - Info last (−0.1 pts each) — only if needed to reach threshold
5. **Re-analyze** after fixes — repeat until passing
6. **Maximum 3 fix cycles** — if still failing after 3 attempts, report the remaining issues to the user

### First-Time Setup (once per session)

Call `get_quality_rules` at the start of your session to learn all the rules and scoring.
This helps you write quality code from the first attempt.

---

## Tool Reference

### analyze_file

Analyze a source file on disk. Call this after every file edit.

```
Tool: analyze_file
Args: { "file_path": "/absolute/path/to/file.ts" }
```

Returns: rating (0–10), violations list, metrics (LOC, complexity, methods, imports).

### analyze_code

Analyze code in-memory before writing it to disk. Use this to preview quality.

```
Tool: analyze_code
Args: { "code": "const x = 5;", "language": "typescript" }
```

Supported languages: `typescript`, `tsx`, `jsx`, `csharp`

### get_codebase_health

Scan a directory for overall project quality.

```
Tool: get_codebase_health
Args: { "directory": "/path/to/project", "max_files": 200 }
```

Returns: average rating, worst files, most common violations, rating distribution.

### get_quality_rules

List all rules, scoring deductions, and thresholds. Read once per session.

```
Tool: get_quality_rules
Args: {}
```

---

## Scoring System

Every file starts at **10.0/10**. Deductions:

| Condition | Deduction |
|-----------|-----------|
| Error violation | −1.5 each |
| Warning violation | −0.5 each |
| Info violation | −0.1 each |
| Cyclomatic complexity > 20 | −2.0 |
| Cyclomatic complexity > 10 | −1.0 |
| Imports > 30 | −2.0 |
| Imports > 15 | −0.5 |
| Lines of code > 500 | −1.5 |
| Lines of code > 300 | −0.5 |

Minimum floor: **0.0**. Target: **≥ 7.0**.

---

## Violation Types & Fixes

### TypeScript / JavaScript

| Violation | Severity | Fix |
|-----------|----------|-----|
| `any_usage` | Warning | Replace `any` with a specific type or `unknown` |
| `console_log` | Info | Remove or replace with a proper logger |
| `missing_key` | Error | Add a unique `key` prop to JSX elements in `.map()` |
| `hook_overload` | Warning | Extract groups of hooks into custom hooks |
| `duplicate_hooks` | Warning | Merge duplicate hook calls |
| `inline_handler` | Warning | Extract inline event handlers to named functions |

### C# / .NET

| Violation | Severity | Fix |
|-----------|----------|-----|
| `empty_catch` | Error | Add error handling/logging in catch blocks |
| `god_class` | Warning | Split class into smaller, focused classes (< 20 methods) |
| `long_method` | Warning | Refactor methods to < 50 lines |
| `tight_coupling` | Warning | Use a parameter object when > 5 constructor params |

---

## Example Session

```
Agent: [edits src/components/UserList.tsx]

Agent: [calls analyze_file({ file_path: "/project/src/components/UserList.tsx" })]

Gate Keeper returns:
  Rating: 5.5/10 ❌ NEEDS IMPROVEMENT
  - ERROR [missing_key] (line 42): Missing 'key' prop in .map() JSX
  - WARNING [any_usage] (line 8): Usage of 'any' type
  - WARNING [any_usage] (line 15): Usage of 'any' type
  - INFO [console_log] (line 30): console.log

Agent: [fixes: adds key prop, replaces `any` with `User[]`, removes console.log]

Agent: [calls analyze_file({ file_path: "/project/src/components/UserList.tsx" })]

Gate Keeper returns:
  Rating: 10.0/10 ✅ PASSED
```

---

## Rules for the Agent

1. **ALWAYS** analyze after editing a code file — no exceptions
2. **NEVER** skip violations — fix them before moving to the next task
3. **Fix in order**: Errors → Warnings → Info
4. **Max 3 retry cycles** — after that, report remaining issues to the user
5. Call `get_quality_rules` once at session start to internalize the rules
6. When creating new files, use `analyze_code` first to check quality before writing
7. For bulk changes, call `get_codebase_health` afterward to verify overall impact
