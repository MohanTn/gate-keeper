/**
 * Core setup logic — pure installation functions used by the `setup` CLI command.
 *
 * Each function returns a SetupResult with a step name, icon, message, and
 * optional file path. Independent steps so partial failures don't cascade.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync, spawn } from 'child_process';

export interface SetupOptions {
  all: boolean;
  claude: boolean;
  copilot: boolean;
  cursor: boolean;
  gitHooks: boolean;
  githubAction: boolean;
  scan: boolean;
  force: boolean;
  repoRoot: string;
  gkDir: string;
}

export interface SetupResult {
  step: string;
  icon: string;
  message: string;
  path: string | null;
}

export interface InstallationStep {
  label: string;
  run: () => Promise<SetupResult>;
}

// ── 1. .graphifyignore ────────────────────────────────────

export async function defaultGraphifyIgnore(opts: SetupOptions): Promise<SetupResult> {
  const filePath = path.join(opts.repoRoot, '.graphifyignore');
  if (fs.existsSync(filePath) && !opts.force) {
    return { step: 'Create .graphifyignore', icon: '⏭', message: 'Already exists (use --force to overwrite)', path: filePath };
  }

  const defaults = [
    '# Gate Keeper — graphify ignore patterns',
    '# Files matching these patterns are excluded from the dependency graph.',
    '',
    '# Generated files',
    '*.generated.*',
    '*.g.cs',
    '*.Designer.cs',
    '',
    '# Build output',
    'dist/',
    'build/',
    'out/',
    '',
    '# Dependencies',
    'node_modules/',
    'vendor/',
    '',
    '# Test fixtures and mocks',
    '**/__snapshots__/**',
    '**/fixtures/**',
    '',
    '# Minified and bundled',
    '*.min.js',
    '*.bundle.js',
    '*.d.ts',
  ];

  fs.writeFileSync(filePath, defaults.join('\n') + '\n', 'utf8');
  return { step: 'Create .graphifyignore', icon: '✅', message: 'Created with defaults (8 patterns)', path: filePath };
}

// ── 2. Claude Code hooks ──────────────────────────────────

export async function installClaudeHooks(opts: SetupOptions): Promise<SetupResult> {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  const hookScript = path.join(opts.gkDir, 'dist', 'hook-receiver.js');
  const preEditScript = path.join(opts.gkDir, 'dist', 'hook-pre-tool-use.js');

  if (!fs.existsSync(hookScript)) {
    return { step: 'Install Claude Code hooks', icon: '⚠️', message: `hook-receiver not built at ${hookScript}. Run 'npm run build' first.`, path: settingsPath };
  }

  // Ensure ~/.claude exists
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });

  let settings: Record<string, unknown>;
  try {
    settings = fs.existsSync(settingsPath)
      ? JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
      : {};
  } catch {
    settings = {};
  }

  const hooks: Record<string, unknown[]> = settings['hooks'] as Record<string, unknown[]> ?? {};

  // SessionStart — register repo on session start
  if (!hooks['SessionStart']) hooks['SessionStart'] = [];
  const hasSessionStart = (hooks['SessionStart'] as Array<Record<string, unknown>>).some(
    (h: Record<string, unknown>) => JSON.stringify(h).includes('hook-receiver'),
  );
  if (!hasSessionStart) {
    (hooks['SessionStart'] as Array<Record<string, unknown>>).push({
      hooks: [{ type: 'command', command: `node ${hookScript}` }],
    });
  }

  // PreToolUse — check edit safety before Write/Edit (pre-edit hook)
  // This runs a script that calls check_pre_edit_safety via the daemon API
  if (!hooks['PreToolUse']) hooks['PreToolUse'] = [];

  // Try the compiled pre-tool-use hook, or generate an inline command
  const preToolUseCommand = fs.existsSync(preEditScript)
    ? `node ${preEditScript}`
    : `node -e "
const http = require('http');
const payload = JSON.parse(process.argv[1] || '{}');
const fp = payload?.tool_input?.file_path || payload?.tool_input?.path;
if (!fp || !fp.match(/\\\\.(ts|tsx|js|jsx|cs)$/)) process.exit(0);
const encRepo = encodeURIComponent(require('child_process').execSync('git rev-parse --show-toplevel 2>/dev/null').toString().trim());
const body = JSON.stringify({ file_path: fp, depth: 2, repo: encRepo });
const req = http.request({ hostname:'127.0.0.1', port:5378, path:'/api/impact-set', method:'POST', headers:{'Content-Type':'application/json','Content-Length':body.length} }, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    try {
      const r = JSON.parse(d);
      if (r.verdict === 'block' || (r.fragileCount || 0) >= 3) {
        process.stderr.write('[Gate Keeper] BLOCKED: ' + r.reason + '\\n');
        process.exit(2);
      }
    } catch {}
  });
});
req.write(body); req.end();
setTimeout(() => process.exit(0), 3000);
" \`cat\``.replace(/\n\s*/g, ' ');

  if (!(hooks['PreToolUse'] as Array<Record<string, unknown>>).some(h => JSON.stringify(h).includes('PreToolUse'))) {
    (hooks['PreToolUse'] as Array<Record<string, unknown>>).push({
      matcher: 'Write|Edit',
      hooks: [{ type: 'command', command: preToolUseCommand }],
    });
  }

  // PostToolUse — analyze after Write/Edit
  if (!hooks['PostToolUse']) hooks['PostToolUse'] = [];
  const hasPostToolUse = (hooks['PostToolUse'] as Array<Record<string, unknown>>).some(
    (h: Record<string, unknown>) => JSON.stringify(h).includes('hook-receiver'),
  );
  if (!hasPostToolUse) {
    (hooks['PostToolUse'] as Array<Record<string, unknown>>).push({
      matcher: 'Write|Edit',
      hooks: [{ type: 'command', command: `node ${hookScript}` }],
    });
  }

  // UserPromptSubmit — session dedup
  if (!hooks['UserPromptSubmit']) hooks['UserPromptSubmit'] = [];
  const hasUserPrompt = (hooks['UserPromptSubmit'] as Array<Record<string, unknown>>).some(
    (h: Record<string, unknown>) => JSON.stringify(h).includes('hook-receiver'),
  );
  if (!hasUserPrompt) {
    (hooks['UserPromptSubmit'] as Array<Record<string, unknown>>).push({
      hooks: [{ type: 'command', command: `node ${hookScript}` }],
    });
  }

  settings['hooks'] = hooks;

  // Ensure additional directories includes this repo
  const dirs = (settings['additionalDirectories'] as string[] | undefined) ?? [];
  if (!dirs.includes(opts.repoRoot)) {
    dirs.push(opts.repoRoot);
    settings['additionalDirectories'] = dirs;
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  return { step: 'Install Claude Code hooks', icon: '✅', message: 'SessionStart + PreToolUse + PostToolUse + UserPromptSubmit configured', path: settingsPath };
}

// ── 3. VS Code / Copilot MCP ─────────────────────────────

export async function installVscodeMcp(opts: SetupOptions): Promise<SetupResult> {
  const mcpDir = path.join(opts.repoRoot, '.vscode');
  const mcpFile = path.join(mcpDir, 'mcp.json');

  fs.mkdirSync(mcpDir, { recursive: true });

  const config = {
    servers: {
      'gate-keeper': {
        command: 'node',
        args: [path.join(opts.gkDir, 'dist', 'mcp', 'server.js')],
        cwd: opts.gkDir,
        env: {},
      },
    },
  };

  // Check if copilot-insights.yml exists
  const insightsFile = path.join(opts.repoRoot, '.github', 'copilot-insights.yml');
  const hasInsights = fs.existsSync(insightsFile);

  if (fs.existsSync(mcpFile) && !opts.force) {
    return { step: 'Configure VS Code / Copilot MCP', icon: '⏭', message: 'Already exists (use --force to overwrite)', path: mcpFile };
  }

  fs.writeFileSync(mcpFile, JSON.stringify(config, null, 2), 'utf8');

  const extras = hasInsights ? ' + copilot-insights.yml found' : '';
  return { step: 'Configure VS Code / Copilot MCP', icon: '✅', message: `.vscode/mcp.json created${extras}`, path: mcpFile };
}

// ── 4. Cursor rules ───────────────────────────────────────

export async function installCursorRules(opts: SetupOptions): Promise<SetupResult> {
  const cursorFile = path.join(opts.repoRoot, '.cursorrules');

  if (fs.existsSync(cursorFile) && !opts.force) {
    return { step: 'Configure Cursor rules', icon: '⏭', message: 'Already exists (use --force to overwrite)', path: cursorFile };
  }

  const rules = [
    '# Gate Keeper — Cursor Rules',
    '',
    '## Before editing any file',
    '- Call `check_pre_edit_safety` with the file path',
    '- If verdict is "warn": also call `get_impact_set` to see affected files',
    '- If verdict is "block": fix fragile dependents first',
    '',
    '## Architecture awareness',
    '- Call `get_graph_report` once per session',
    '- Use `summarize_file` instead of reading raw files for context',
    '- Use `find_callers` before renaming any export',
    '',
    '## Quality gates',
    '- After every edit: `analyze_file` → target ≥ 7.0/10',
    '- If rating < 7.0: `suggest_refactoring` → fix → re-analyze',
    '',
    '## MCP Server: node dist/mcp/server.js (in repo root)',
    '',
  ];

  fs.writeFileSync(cursorFile, rules.join('\n'), 'utf8');
  return { step: 'Configure Cursor rules', icon: '✅', message: '.cursorrules created', path: cursorFile };
}

// ── 5. GitHub Actions workflow ────────────────────────────

export async function installGitHubWorkflow(opts: SetupOptions): Promise<SetupResult> {
  const workflowDir = path.join(opts.repoRoot, '.github', 'workflows');
  const workflowFile = path.join(workflowDir, 'gate-keeper.yml');

  if (fs.existsSync(workflowFile) && !opts.force) {
    return { step: 'Create GitHub Actions workflow', icon: '⏭', message: 'Already exists (use --force to overwrite)', path: workflowFile };
  }

  fs.mkdirSync(workflowDir, { recursive: true });

  const workflow = `name: Gate Keeper — Quality Gate

on:
  push:
    branches: ["**"]
  pull_request:
    branches: [main, master]

permissions:
  contents: read
  pull-requests: write

jobs:
  quality-gate:
    name: Gate Keeper analysis
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci

      - name: Build gate-keeper
        run: npm run build

      - name: Run quality analysis
        id: analysis
        run: |
          node -e "
          const { findSourceFiles } = require('${opts.gkDir}/dist/mcp/helpers');
          const { UniversalAnalyzer } = require('${opts.gkDir}/dist/analyzer/universal-analyzer');
          const files = findSourceFiles('.', 200);
          Promise.all(files.map(f => new UniversalAnalyzer().analyze(f).catch(() => null)))
            .then(results => {
              const valid = results.filter(Boolean);
              const avg = valid.reduce((s, r) => s + r.rating, 0) / (valid.length || 1);
              const below = valid.filter(r => r.rating < 7.0);
              console.log('overall_rating=' + avg.toFixed(1));
              console.log('files_analyzed=' + valid.length);
              console.log('below_threshold=' + below.length);
              below.forEach(r => console.log('  FAIL: ' + r.path.split('/').pop() + ' — ' + r.rating + '/10'));
            });
          " 2>&1 | tee -a \$GITHUB_OUTPUT

      - name: Post PR comment
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          github-token: \${{ github.token }}
          script: |
            const fs = require('fs');
            const env = require('process').env;
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: \`## Gate Keeper Quality Report
            **Overall rating:** \${env.overall_rating || 'N/A'}/10
            **Files analyzed:** \${env.files_analyzed || 0}
            **Files below threshold:** \${env.below_threshold || 0}

            *Analysis by Gate Keeper MCP server.*\`
            });
`;

  fs.writeFileSync(workflowFile, workflow, 'utf8');
  return { step: 'Create GitHub Actions workflow', icon: '✅', message: '.github/workflows/gate-keeper.yml created', path: workflowFile };
}

// ── 6. Git hooks ──────────────────────────────────────────

export async function installGitHooks(opts: SetupOptions): Promise<SetupResult> {
  const hooksDir = path.join(opts.repoRoot, '.git', 'hooks');

  if (!fs.existsSync(hooksDir)) {
    return { step: 'Install git hooks', icon: '⚠️', message: 'Not a git repository — skipping', path: null };
  }

  const hookScript = path.join(opts.gkDir, 'dist', 'hook-receiver.js');
  if (!fs.existsSync(hookScript)) {
    return { step: 'Install git hooks', icon: '⚠️', message: 'hook-receiver not built — skipping', path: hooksDir };
  }

  const hooks: Array<{ name: string; content: string }> = [
    {
      name: 'post-commit',
      content: `#!/bin/sh
# Gate Keeper — post-commit hook (non-blocking)
HOOK="${hookScript}"
if [ ! -f "$HOOK" ]; then exit 0; fi
git diff-tree --no-commit-id -r --name-only HEAD | grep -E '\\.(ts|tsx|js|jsx|cs)$' | while read -r file; do
  FP="$(git rev-parse --show-toplevel)/$file"
  [ -f "$FP" ] && echo '{"tool_name":"Write","tool_input":{"file_path":"'"$FP"'"}}' | node "$HOOK" 2>/dev/null &
done
exit 0
`,
    },
    {
      name: 'post-checkout',
      content: `#!/bin/sh
# Gate Keeper — post-checkout hook (non-blocking)
PREV="$1"; NEW="$2"; BRANCH="$3"
if [ "$BRANCH" != "1" ]; then exit 0; fi
HOOK="${hookScript}"
if [ ! -f "$HOOK" ]; then exit 0; fi
git diff --name-only "$PREV" "$NEW" | grep -E '\\.(ts|tsx|js|jsx|cs)$' | head -20 | while read -r file; do
  FP="$(git rev-parse --show-toplevel)/$file"
  [ -f "$FP" ] && echo '{"tool_name":"Write","tool_input":{"file_path":"'"$FP"'"}}' | node "$HOOK" 2>/dev/null &
done
exit 0
`,
    },
  ];

  let created = 0;
  let skipped = 0;

  for (const { name, content } of hooks) {
    const hookPath = path.join(hooksDir, name);
    if (fs.existsSync(hookPath) && !opts.force) {
      skipped++;
      continue;
    }
    fs.writeFileSync(hookPath, content, { mode: 0o755 });
    created++;
  }

  if (created === 0 && skipped > 0) {
    return { step: 'Install git hooks', icon: '⏭', message: `${skipped} hook(s) already exist (use --force to overwrite)`, path: hooksDir };
  }

  return { step: 'Install git hooks', icon: '✅', message: `${created} hook(s) installed (${skipped} skipped)`, path: hooksDir };
}

// ── 7. Initial scan ───────────────────────────────────────

export async function runInitialScan(opts: SetupOptions): Promise<SetupResult> {
  const daemonScript = path.join(opts.gkDir, 'dist', 'daemon.js');

  if (!fs.existsSync(daemonScript)) {
    return { step: 'Start daemon & run initial scan', icon: '⚠️', message: `Daemon not built at ${daemonScript}. Run 'npm run build' first.`, path: null };
  }

  // Kill any existing daemon first
  const pidFile = path.join(os.homedir(), '.gate-keeper', 'daemon.pid');
  if (fs.existsSync(pidFile)) {
    try {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
      if (!isNaN(pid)) {
        try { process.kill(pid, 0); process.kill(pid); } catch { /* not running */ }
      }
    } catch { /* ignore */ }
    try { fs.unlinkSync(pidFile); } catch { /* ignore */ }
  }

  // Start the daemon
  const child = spawn(process.execPath, [daemonScript, '--no-scan'], {
    cwd: opts.gkDir,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });
  child.unref();

  // Wait for it to start
  await sleep(1500);

  // Trigger scan via API
  const scanResult = spawnSync('curl', [
    '-s', '-X', 'POST',
    'http://127.0.0.1:5379/scan',
    '-H', 'Content-Type: application/json',
    '-d', JSON.stringify({}),
  ], { timeout: 5000, encoding: 'utf8' });

  if (scanResult.status !== 0) {
    return { step: 'Start daemon & run initial scan', icon: '⚠️', message: 'Daemon started but scan trigger failed (try `npm run dev` manually)', path: null };
  }

  return { step: 'Start daemon & run initial scan', icon: '✅', message: 'Daemon started, initial scan triggered (check dashboard at http://localhost:5378/viz)', path: null };
}

// ── Summary ───────────────────────────────────────────────

export function printSummary(results: SetupResult[], repoRoot: string): void {
  const successes = results.filter(r => r.icon === '✅').length;
  const warnings = results.filter(r => r.icon === '⚠️').length;
  const skipped = results.filter(r => r.icon === '⏭').length;
  const failures = results.filter(r => r.icon === '❌').length;

  console.log(`\n  ═══════════════════════════════════`);
  console.log(`  Setup complete for ${path.basename(repoRoot)}`);
  console.log(`  ${successes} installed · ${skipped} skipped · ${warnings} warnings · ${failures} failed`);
  console.log(`  ═══════════════════════════════════\n`);

  if (successes > 0) {
    console.log('  Next steps:');
    console.log('    - Open the dashboard: http://localhost:5378/viz');
    console.log('    - Run npm run dev to restart the daemon manually');
    console.log('    - Use `get_graph_report` in your AI assistant');
    console.log('    - The PostToolUse hook will auto-analyze files on Write/Edit\n');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
