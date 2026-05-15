/**
 * Platform integration installer — generates config files that wire gate-keeper
 * into various AI coding assistants.
 *
 * Each platform generator returns the target file path and content to write.
 * The handler is responsible for actually writing to disk and checking conflicts.
 */

import * as path from 'path';

export type Platform = 'claude-code' | 'copilot' | 'cursor' | 'vscode' | 'github-action';

export interface PlatformConfig {
  platform: Platform;
  filePath: string;
  content: string;
  description: string;
  append: boolean; // true = append to existing file; false = create/overwrite
}

// ── Platform config generators ─────────────────────────────

export function claudeCodeConfig(repoRoot: string): PlatformConfig {
  const content = `
## Gate Keeper — Graphify Integration

**Session Start Protocol:**
1. Call \`get_graph_report\` to understand the architecture before writing any code.
2. Call \`get_centrality_rank\` to identify high-blast-radius files.
3. Before editing any file, call \`check_pre_edit_safety\` — treat **block** verdicts as hard stops.

**MCP Tools available:** get_impact_set, trace_path, summarize_file, find_callers, check_pre_edit_safety, get_graph_report, query_graph, explain_node, get_session_metrics

**Token efficiency:** Use these tools instead of reading raw files. One graph query (~100–300 tokens) replaces reading 5+ files (~25 000 tokens).
`;
  return {
    platform: 'claude-code',
    filePath: path.join(repoRoot, 'CLAUDE.md'),
    content,
    description: 'Appends gate-keeper session protocol to CLAUDE.md',
    append: true,
  };
}

export function copilotConfig(repoRoot: string, mcpServerPath?: string): PlatformConfig {
  const serverPath = mcpServerPath ?? 'node dist/mcp/server.js';
  const content = `# Gate Keeper — Mandatory Quality Workflow

> **Every code action (plan, create, edit) must pass through the gate-keeper MCP tools. No exceptions.**

---

## MCP Server Configuration

Add this to your VS Code settings (or \`mcp.json\`) to register the gate-keeper MCP server:

\`\`\`json
{
  "mcpServers": {
    "gate-keeper": {
      "command": "node",
      "args": ["${serverPath}"],
      "cwd": "${repoRoot}"
    }
  }
}
\`\`\`

---

## Tool Quick Reference

| Category | Tool | What it does |
|----------|------|-------------|
| **Quality** | \`analyze_file\` | Rate a file 0–10, get violations |
| | \`analyze_code\` | Preview quality before writing a new file |
| | \`get_quality_rules\` | Learn scoring thresholds and deductions |
| **Context** | \`summarize_file\` | Get file overview without reading raw content |
| | \`get_file_context\` | Dependencies, reverse deps, cycles, rating |
| | \`get_dependency_graph\` | Full architecture: coupling, hotspots, cycles |
| | \`get_graph_report\` | Narrative report: god nodes, surprises |
| **Safety** | \`check_pre_edit_safety\` | Risk verdict before editing (safe/warn/block) |
| | \`get_impact_set\` | Files that would break if you change this one |
| | \`predict_impact_with_remediation\` | Blast radius + fix instructions |
| | \`find_callers\` | All call sites before renaming a function |
| **Analysis** | \`suggest_refactoring\` | Ranked fixes for a low-rated file |
| | \`get_codebase_health\` | Overall project quality scan |
| | \`get_violation_patterns\` | Most common violations across the codebase |

---

## Session Start (once per session)

\`\`\`
get_quality_rules          ← learn scoring thresholds
get_dependency_graph       ← see architecture, coupling hotspots, circular deps, worst-rated files
\`\`\`

---

## Before Any Change

\`\`\`
get_file_context <file>
\`\`\`

If the file has **many reverse dependencies**:
\`\`\`
get_impact_analysis <file>             ← direct + transitive dependents
predict_impact_with_remediation <file>  ← remediation for at-risk downstream files
\`\`\`

---

## Writing Code

### New file
1. \`analyze_code <code string>\` — preview quality BEFORE writing to disk
2. Only write if rating ≥ 7.0, or fix the code first
3. After writing: \`analyze_file <path>\` to verify

### Existing file
1. Edit the file
2. Immediately: \`analyze_file <absolute path>\` (MANDATORY)

| Rating | Action |
|--------|--------|
| ≥ 7.0 | ✅ Done — proceed |
| < 7.0 | \`suggest_refactoring\` → fix → \`analyze_file\` again (max 3 cycles) |

---

## After Bulk Changes (3+ files)

\`\`\`
get_codebase_health  ← verify overall project quality has not degraded
\`\`\`

---

## Hard Rules

- Never use \`any\` — use specific types or \`unknown\`
- Never leave empty catch blocks
- Never skip \`analyze_file\` after editing a code file
- Never edit a widely-imported file without \`get_impact_analysis\` first

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

---

## Fix Priority

1. **Errors −1.5 each** — missing \`key\` props, empty catch blocks
2. **Warnings −0.5 each** — \`any\` types, god classes, long methods (>50 lines), tight coupling
3. **Circular deps −1.0 each** — break import cycles via shared types or dependency inversion
4. **Info −0.1 each** — console.log statements
`;
  return {
    platform: 'copilot',
    filePath: path.join(repoRoot, '.github', 'copilot-instructions.md'),
    content,
    description: 'Creates .github/copilot-instructions.md with gate-keeper usage guide',
    append: false,
  };
}

export function cursorConfig(repoRoot: string): PlatformConfig {
  const content = `# Gate Keeper — Cursor Rules

## Before editing any file
1. Call MCP tool \`check_pre_edit_safety\` with the file path.
2. If verdict is "warn": also call \`get_impact_set\` to see affected files.
3. If verdict is "block": fix fragile dependents first.

## Architecture awareness
- Call \`get_graph_report\` once per session to understand module structure.
- Use \`summarize_file\` instead of reading raw files for context.
- Use \`find_callers\` before renaming or deleting any function/export.
- Use \`trace_path\` to understand why two modules are coupled.

## Quality gates
- After every file edit, call \`analyze_file\`. Target rating ≥ 7.0/10.
- If rating < 7.0, call \`suggest_refactoring\` and fix violations.

## MCP Server: node dist/mcp/server.js (in repo root)
`;
  return {
    platform: 'cursor',
    filePath: path.join(repoRoot, '.cursorrules'),
    content,
    description: 'Creates .cursorrules with gate-keeper workflow instructions',
    append: false,
  };
}

export function vscodeConfig(repoRoot: string, gateKeeperPath?: string): PlatformConfig {
  const serverPath = gateKeeperPath ?? repoRoot;
  const config = {
    servers: {
      'gate-keeper': {
        command: 'node',
        args: ['dist/mcp/server.js'],
        cwd: serverPath,
        env: {},
      },
    },
  };
  return {
    platform: 'vscode',
    filePath: path.join(repoRoot, '.vscode', 'mcp.json'),
    content: JSON.stringify(config, null, 2),
    description: 'Creates .vscode/mcp.json registering gate-keeper as a VS Code MCP server',
    append: false,
  };
}

export function githubActionConfig(): PlatformConfig {
  const content = `name: Gate Keeper — Code Quality Analysis

on:
  push:
    branches: ["**"]
  pull_request:
    branches: [main, master]

jobs:
  quality-analysis:
    name: Analyze code quality
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: |
            package-lock.json

      - name: Install gate-keeper
        run: npm ci

      - name: Build gate-keeper
        run: npm run build

      - name: Run quality analysis
        id: analysis
        run: |
          node -e "
          const { UniversalAnalyzer } = require('./dist/analyzer/universal-analyzer');
          const { findSourceFiles } = require('./dist/mcp/helpers');
          const files = findSourceFiles('.', 100);
          Promise.all(files.map(f => new UniversalAnalyzer().analyze(f)))
            .then(results => {
              const avg = results.reduce((s, r) => s + r.rating, 0) / results.length;
              const failed = results.filter(r => r.rating < 7.0);
              console.log('overall_rating=' + avg.toFixed(1));
              console.log('failed_files=' + failed.length);
              if (failed.length > 0) process.exit(1);
            })
            .catch(e => { console.error(e); process.exit(1); });
          " | tee -a "\$GITHUB_OUTPUT"

      - name: Post quality summary
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const overall = '\${{ steps.analysis.outputs.overall_rating }}';
            const failed = '\${{ steps.analysis.outputs.failed_files }}';
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: \`## Gate Keeper Quality Report\\n\\n**Overall rating:** \${overall}/10\\n**Files below threshold:** \${failed}\\n\\nRun \\\`get_graph_report\\\` in gate-keeper MCP for full analysis.\`
            });
`;
  return {
    platform: 'github-action',
    filePath: path.join('.github', 'workflows', 'gate-keeper.yml'),
    content,
    description: 'Creates .github/workflows/gate-keeper.yml for CI quality analysis',
    append: false,
  };
}

export function getPlatformConfig(
  platform: Platform,
  repoRoot: string,
  gateKeeperPath?: string,
): PlatformConfig {
  switch (platform) {
    case 'claude-code': return claudeCodeConfig(repoRoot);
    case 'copilot': return copilotConfig(repoRoot, gateKeeperPath);
    case 'cursor': return cursorConfig(repoRoot);
    case 'vscode': return vscodeConfig(repoRoot, gateKeeperPath);
    case 'github-action': return githubActionConfig();
  }
}
