#!/usr/bin/env node
/**
 * gate-keeper setup — one-shot installation for all platforms.
 *
 * Usage:
 *   npx tsx src/cli/setup.ts                     ← auto-detect, ask for targets
 *   npx tsx src/cli/setup.ts --dir=/path/to/repo --all
 *   npx tsx src/cli/setup.ts --claude --copilot --git-hooks
 *
 * What it does:
 *   1. Detects repo root and writes .graphifyignore with defaults
 *   2. Installs Claude Code hooks in ~/.claude/settings.json
 *   3. Creates .vscode/mcp.json for Copilot / VS Code
 *   4. Creates .cursorrules for Cursor
 *   5. Creates .github/workflows/gate-keeper.yml for CI
 *   6. Installs post-commit + post-checkout git hooks
 *   7. Starts the daemon and runs an initial scan
 *   8. Generates the first graph report
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync, spawn } from 'child_process';
import {
  InstallationStep,
  defaultGraphifyIgnore,
  installClaudeHooks,
  installCopilotInstructions,
  installVscodeMcp,
  installCursorRules,
  installGitHubWorkflow,
  installGitHooks,
  runInitialScan,
  printSummary,
  SetupOptions,
  SetupResult,
} from './setup-core';

// ── Main ───────────────────────────────────────────────────

export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const repoDir = findArg(args, '--dir') ?? process.cwd();
  const repoRoot = findGitRoot(repoDir);
  const gkDir = path.resolve(__dirname, '..', '..');

  const flags: SetupOptions = {
    all: args.includes('--all'),
    claude: args.includes('--claude'),
    copilot: args.includes('--copilot') || args.includes('--vscode'),
    cursor: args.includes('--cursor'),
    gitHooks: args.includes('--git-hooks'),
    githubAction: args.includes('--github-action'),
    scan: !args.includes('--no-scan'),
    force: args.includes('--force'),
    repoRoot,
    gkDir,
  };

  // If no specific flags, prompt for targets
  if (!flags.all && !flags.claude && !flags.copilot && !flags.cursor && !flags.gitHooks && !flags.githubAction) {
    console.log('\n  ⬡ Gate Keeper Setup\n');
    console.log(`  Repository: ${repoRoot}`);
    console.log(`  Gate Keeper: ${gkDir}\n`);
    console.log('  Installing with defaults for detected environment...\n');
    flags.all = true;
  }

  const results: SetupResult[] = [];
  const steps = buildSteps(flags);

  for (const step of steps) {
    process.stdout.write(`  [ ] ${step.label}... `);
    try {
      const result = await step.run();
      results.push(result);
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write(`  ${result.icon} ${result.message}\n`);
    } catch (err) {
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(`  ❌ ${step.label}: ${msg}\n`);
      results.push({ step: step.label, icon: '❌', message: msg, path: null });
    }
  }

  printSummary(results, repoRoot);
}

// ── CLI helpers ───────────────────────────────────────────

export function findArg(args: string[], name: string): string | null {
  for (const a of args) {
    if (a.startsWith(`${name}=`)) return a.slice(name.length + 1);
    if (a === name) return args[args.indexOf(a) + 1] ?? null;
  }
  return null;
}

export function findGitRoot(dir: string): string {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: dir, encoding: 'utf8', timeout: 3000,
  });
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : dir;
}

export function buildSteps(opts: SetupOptions): InstallationStep[] {
  const steps: InstallationStep[] = [];

  if (opts.all || true) {
    steps.push({ label: 'Create .graphifyignore', run: () => defaultGraphifyIgnore(opts) });
  }

  if (opts.all || opts.claude) {
    steps.push({ label: 'Install Claude Code hooks', run: () => installClaudeHooks(opts) });
  }

  if (opts.all || opts.copilot) {
    steps.push({ label: 'Create Copilot instructions', run: () => installCopilotInstructions(opts) });
    steps.push({ label: 'Configure VS Code / Copilot MCP', run: () => installVscodeMcp(opts) });
  }

  if (opts.all || opts.cursor) {
    steps.push({ label: 'Configure Cursor rules', run: () => installCursorRules(opts) });
  }

  if (opts.all || opts.githubAction) {
    steps.push({ label: 'Create GitHub Actions workflow', run: () => installGitHubWorkflow(opts) });
  }

  if (opts.all || opts.gitHooks) {
    steps.push({ label: 'Install git hooks', run: () => installGitHooks(opts) });
  }

  if (opts.all || opts.scan) {
    steps.push({ label: 'Start daemon & run initial scan', run: () => runInitialScan(opts) });
  }

  return steps;
}

// ── Entry point ───────────────────────────────────────────

if (require.main === module) {
  main().catch(err => {
    console.error('Setup failed:', err);
    process.exit(1);
  });
}
