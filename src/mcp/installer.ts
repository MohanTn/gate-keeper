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
  const content = `# Gate Keeper — AI Coding Assistant Instructions

## Architecture Context
Before modifying any file in this repository, use the gate-keeper MCP server to understand the codebase structure.

## Available MCP Tools
The gate-keeper MCP server provides 26+ tools. Key tools for pre-edit context:
- \`get_graph_report\` — narrative architecture report with god nodes and surprising connections
- \`check_pre_edit_safety\` — risk assessment before editing (returns safe/warn/block)
- \`get_impact_set\` — files affected by a change (depth-bounded BFS)
- \`summarize_file\` — structured file overview without reading full content
- \`find_callers\` — all call sites for a function/symbol
- \`trace_path\` — shortest import path between two files
- \`query_graph\` — natural language queries (e.g., "what would break if auth.ts changed?")

## MCP Server
\`\`\`json
{
  "mcpServers": {
    "gate-keeper": {
      "command": "${serverPath}",
      "cwd": "${repoRoot}"
    }
  }
}
\`\`\`

## Pre-edit workflow
1. \`get_graph_report\` → understand architecture
2. \`check_pre_edit_safety(file_path)\` → get verdict
3. If warn/block: \`get_impact_set(file_path, depth=2)\` → see affected files
4. Make edit → \`analyze_file(file_path)\` → verify quality ≥ 7.0
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
