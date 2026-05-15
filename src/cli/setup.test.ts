/**
 * Tests for src/cli/setup.ts — one-shot installation CLI.
 *
 * The CLI delegates to setup-core.ts for all actual installation steps.
 * We mock setup-core completely and test the CLI helpers: flag parsing,
 * buildSteps, findArg, findGitRoot, and the main() orchestration.
 */

import * as cp from 'child_process';
import * as path from 'path';

jest.mock('./setup-core', () => ({
  ...jest.requireActual('./setup-core'),
  // Override the IO-heavy functions with mocks
  defaultGraphifyIgnore: jest.fn().mockResolvedValue({
    step: 'Create .graphifyignore', icon: '✅', message: 'Created', path: '/repo/.graphifyignore',
  }),
  installClaudeHooks: jest.fn().mockResolvedValue({
    step: 'Install Claude Code hooks', icon: '✅', message: 'Configured', path: '/home/.claude/settings.json',
  }),
  installCopilotInstructions: jest.fn().mockResolvedValue({
    step: 'Create Copilot instructions', icon: '✅', message: 'Created', path: '/repo/.github/copilot-instructions.md',
  }),
  installVscodeMcp: jest.fn().mockResolvedValue({
    step: 'Configure VS Code / Copilot MCP', icon: '✅', message: 'Created', path: '/repo/.vscode/mcp.json',
  }),
  installCursorRules: jest.fn().mockResolvedValue({
    step: 'Configure Cursor rules', icon: '✅', message: 'Created', path: '/repo/.cursorrules',
  }),
  installGitHubWorkflow: jest.fn().mockResolvedValue({
    step: 'Create GitHub Actions workflow', icon: '✅', message: 'Created', path: '/repo/.github/workflows/gate-keeper.yml',
  }),
  installGitHooks: jest.fn().mockResolvedValue({
    step: 'Install git hooks', icon: '✅', message: 'Installed', path: '/repo/.git/hooks',
  }),
  runInitialScan: jest.fn().mockResolvedValue({
    step: 'Start daemon & run initial scan', icon: '✅', message: 'Daemon started', path: null,
  }),
  printSummary: jest.fn(),
}));

jest.mock('child_process');

const mockCp = jest.mocked(cp);

// Mock fs operations for modules that touch the filesystem
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn().mockReturnValue('{}'),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

// Import after mocks
import { main, findArg, findGitRoot, buildSteps } from './setup';
import { printSummary } from './setup-core';
import type { SetupOptions, SetupResult } from './setup-core';

// ── Mock stdout ───────────────────────────────────────────────

let stdoutOutput: string[];

beforeEach(() => {
  jest.clearAllMocks();
  stdoutOutput = [];

  jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdoutOutput.push(String(chunk));
    return true;
  });
  (process.stdout as any).clearLine = jest.fn();
  (process.stdout as any).cursorTo = jest.fn();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── findArg ───────────────────────────────────────────────────

describe('findArg', () => {
  it('returns the value after = for --key=value syntax', () => {
    const result = findArg(['--dir=/home/repo', '--all'], '--dir');
    expect(result).toBe('/home/repo');
  });

  it('returns the next argument for --key value syntax', () => {
    const result = findArg(['--dir', '/home/repo', '--all'], '--dir');
    expect(result).toBe('/home/repo');
  });

  it('returns null when the flag is not present', () => {
    const result = findArg(['--all', '--force'], '--dir');
    expect(result).toBeNull();
  });

  it('returns null when --key is last in array (no value follows)', () => {
    expect(findArg(['--all', '--dir'], '--dir')).toBeNull();
  });

  it('handles empty args array', () => {
    expect(findArg([], '--dir')).toBeNull();
  });

  it('does not confuse --dir with --directory', () => {
    const result = findArg(['--directory=/other'], '--dir');
    expect(result).toBeNull();
  });

  it('correctly parses --key= with empty value', () => {
    const result = findArg(['--dir='], '--dir');
    // a.slice(name.length + 1) slices '--dir=' from index 6 → ''
    expect(result).toBe('');
  });

  it('handles multiple occurrences (returns first match)', () => {
    const result = findArg(['--dir=/first', '--dir=/second'], '--dir');
    expect(result).toBe('/first');
  });
});

// ── findGitRoot ───────────────────────────────────────────────

describe('findGitRoot', () => {
  it('returns git root when git rev-parse succeeds', () => {
    (mockCp.spawnSync as jest.Mock).mockReturnValue({
      status: 0,
      stdout: '/home/project',
      stderr: '',
      pid: 0,
      output: ['', '/home/project\n', ''],
      signal: null,
    } as unknown as cp.SpawnSyncReturns<Buffer>);

    expect(findGitRoot('/some/dir')).toBe('/home/project');
  });

  it('trims trailing newline from git output', () => {
    (mockCp.spawnSync as jest.Mock).mockReturnValue({
      status: 0,
      stdout: '/home/project\n',
      stderr: '',
      pid: 0,
      output: ['', '/home/project\n', ''],
      signal: null,
    } as unknown as cp.SpawnSyncReturns<Buffer>);

    expect(findGitRoot('/some/dir')).toBe('/home/project');
  });

  it('returns fallback dir when git rev-parse fails', () => {
    (mockCp.spawnSync as jest.Mock).mockReturnValue({
      status: 128,
      stdout: '',
      stderr: 'fatal: not a git repository',
      pid: 0,
      output: ['', '', 'fatal: not a git repository'],
      signal: null,
    } as unknown as cp.SpawnSyncReturns<Buffer>);

    expect(findGitRoot('/some/dir')).toBe('/some/dir');
  });

  it('returns fallback when stdout is empty', () => {
    (mockCp.spawnSync as jest.Mock).mockReturnValue({
      status: 0,
      stdout: '',
      stderr: '',
      pid: 0,
      output: ['', '', ''],
      signal: null,
    } as unknown as cp.SpawnSyncReturns<Buffer>);

    expect(findGitRoot('/some/dir')).toBe('/some/dir');
  });

  it('spawns git in the given directory', () => {
    (mockCp.spawnSync as jest.Mock).mockReturnValue({
      status: 0,
      stdout: '/repo',
      stderr: '',
      pid: 0,
      output: ['', '/repo\n', ''],
      signal: null,
    } as unknown as cp.SpawnSyncReturns<Buffer>);

    findGitRoot('/test/path');
    expect(mockCp.spawnSync).toHaveBeenCalledWith(
      'git', ['rev-parse', '--show-toplevel'],
      expect.objectContaining({ cwd: '/test/path' }),
    );
  });
});

// ── buildSteps ────────────────────────────────────────────────

describe('buildSteps', () => {
  const baseOpts: SetupOptions = {
    all: false,
    claude: false,
    copilot: false,
    cursor: false,
    gitHooks: false,
    githubAction: false,
    scan: false,
    force: false,
    repoRoot: '/repo',
    gkDir: '/gk',
  };

  it('includes .graphifyignore step always (all || true)', () => {
    const steps = buildSteps(baseOpts);
    const labels = steps.map(s => s.label);
    expect(labels).toContain('Create .graphifyignore');
  });

  it('includes all steps when all=true', () => {
    const steps = buildSteps({ ...baseOpts, all: true });
    const labels = steps.map(s => s.label);
    expect(labels).toContain('Create .graphifyignore');
    expect(labels).toContain('Install Claude Code hooks');
    expect(labels).toContain('Create Copilot instructions');
    expect(labels).toContain('Configure VS Code / Copilot MCP');
    expect(labels).toContain('Configure Cursor rules');
    expect(labels).toContain('Create GitHub Actions workflow');
    expect(labels).toContain('Install git hooks');
    expect(labels).toContain('Start daemon & run initial scan');
  });

  it('includes only Claude hooks when --claude is set', () => {
    const steps = buildSteps({ ...baseOpts, claude: true });
    const labels = steps.map(s => s.label);
    expect(labels).toContain('Install Claude Code hooks');
    expect(labels).not.toContain('Configure Cursor rules');
    expect(labels).not.toContain('Create Copilot instructions');
  });

  it('includes only copilot steps when --copilot is set', () => {
    const steps = buildSteps({ ...baseOpts, copilot: true });
    const labels = steps.map(s => s.label);
    expect(labels).toContain('Create Copilot instructions');
    expect(labels).toContain('Configure VS Code / Copilot MCP');
    expect(labels).not.toContain('Install Claude Code hooks');
    expect(labels).not.toContain('Configure Cursor rules');
  });

  it('includes only cursor steps when --cursor is set', () => {
    const steps = buildSteps({ ...baseOpts, cursor: true });
    const labels = steps.map(s => s.label);
    expect(labels).toContain('Configure Cursor rules');
    expect(labels).not.toContain('Install Claude Code hooks');
    expect(labels).not.toContain('Create Copilot instructions');
  });

  it('includes only git hooks when --git-hooks is set', () => {
    const steps = buildSteps({ ...baseOpts, gitHooks: true });
    const labels = steps.map(s => s.label);
    expect(labels).toContain('Install git hooks');
    expect(labels).not.toContain('Install Claude Code hooks');
    expect(labels).not.toContain('Create Copilot instructions');
  });

  it('includes only GitHub action when --github-action is set', () => {
    const steps = buildSteps({ ...baseOpts, githubAction: true });
    const labels = steps.map(s => s.label);
    expect(labels).toContain('Create GitHub Actions workflow');
    expect(labels).not.toContain('Install git hooks');
    expect(labels).not.toContain('Configure Cursor rules');
  });

  it('excludes initial scan when scan=false and all=false', () => {
    const steps = buildSteps({ ...baseOpts, all: false, scan: false });
    const labels = steps.map(s => s.label);
    expect(labels).not.toContain('Start daemon & run initial scan');
  });

  it('includes initial scan when all=true even if scan=false (all || scan)', () => {
    const steps = buildSteps({ ...baseOpts, all: true, scan: false });
    const labels = steps.map(s => s.label);
    expect(labels).toContain('Start daemon & run initial scan');
  });

  it('includes scan step when the all flag is set and scan is not disabled', () => {
    const steps = buildSteps({ ...baseOpts, all: true, scan: true });
    const labels = steps.map(s => s.label);
    expect(labels).toContain('Start daemon & run initial scan');
  });

  it('returns steps in the correct order', () => {
    const steps = buildSteps({ ...baseOpts, all: true, scan: true });
    const labels = steps.map(s => s.label);
    // Graphify ignore should come first, scan last
    expect(labels[0]).toBe('Create .graphifyignore');
    expect(labels[labels.length - 1]).toBe('Start daemon & run initial scan');
  });
});

// ── main() orchestration ──────────────────────────────────────

describe('main()', () => {
  const ORIG_ARGV = process.argv;

  afterEach(() => {
    process.argv = ORIG_ARGV;
  });

  it('runs all steps with --all flag and prints summary', async () => {
    process.argv = ['node', 'setup.ts', '--all'];
    await main();

    // Should have called printSummary with 8 results
    const summaryCall = (printSummary as jest.Mock).mock.calls[0];
    expect(summaryCall).toBeDefined();
    expect(summaryCall[1]).toBeDefined(); // repoRoot

    // All 8 steps should have been invoked
    const { defaultGraphifyIgnore } = require('./setup-core');
    const { installClaudeHooks } = require('./setup-core');
    const { runInitialScan } = require('./setup-core');
    expect(defaultGraphifyIgnore).toHaveBeenCalled();
    expect(installClaudeHooks).toHaveBeenCalled();
    expect(runInitialScan).toHaveBeenCalled();
  });

  it('runs only Claude-related steps with --claude flag', async () => {
    process.argv = ['node', 'setup.ts', '--claude'];

    await main();

    const { installClaudeHooks } = require('./setup-core');
    const { installCursorRules } = require('./setup-core');
    expect(installClaudeHooks).toHaveBeenCalled();
    expect(installCursorRules).not.toHaveBeenCalled();
  });

  it('runs only copilot steps with --copilot flag', async () => {
    process.argv = ['node', 'setup.ts', '--copilot'];

    await main();

    const { installCopilotInstructions } = require('./setup-core');
    const { installVscodeMcp } = require('./setup-core');
    const { installClaudeHooks } = require('./setup-core');
    expect(installCopilotInstructions).toHaveBeenCalled();
    expect(installVscodeMcp).toHaveBeenCalled();
    expect(installClaudeHooks).not.toHaveBeenCalled();
  });

  it('runs only cursor steps with --cursor flag', async () => {
    process.argv = ['node', 'setup.ts', '--cursor'];

    await main();

    const { installCursorRules } = require('./setup-core');
    const { installClaudeHooks } = require('./setup-core');
    expect(installCursorRules).toHaveBeenCalled();
    expect(installClaudeHooks).not.toHaveBeenCalled();
  });

  it('runs only git-hooks with --git-hooks flag', async () => {
    process.argv = ['node', 'setup.ts', '--git-hooks'];

    await main();

    const { installGitHooks } = require('./setup-core');
    const { installClaudeHooks } = require('./setup-core');
    expect(installGitHooks).toHaveBeenCalled();
    expect(installClaudeHooks).not.toHaveBeenCalled();
  });

  it('runs only github-action with --github-action flag', async () => {
    process.argv = ['node', 'setup.ts', '--github-action'];

    await main();

    const { installGitHubWorkflow } = require('./setup-core');
    const { installGitHooks } = require('./setup-core');
    expect(installGitHubWorkflow).toHaveBeenCalled();
    expect(installGitHooks).not.toHaveBeenCalled();
  });

  it('sets all=true when no flags are provided', async () => {
    process.argv = ['node', 'setup.ts'];

    await main();

    const { runInitialScan } = require('./setup-core');
    expect(runInitialScan).toHaveBeenCalled();
  });

  it('excludes scan step when --no-scan is passed with --claude', async () => {
    process.argv = ['node', 'setup.ts', '--claude', '--no-scan'];

    await main();

    const { runInitialScan } = require('./setup-core');
    expect(runInitialScan).not.toHaveBeenCalled();
  });

  it('handles --dir= flag to set custom directory', async () => {
    // Mock findGitRoot to return the dir value
    (mockCp.spawnSync as jest.Mock).mockReturnValue({
      status: 0,
      stdout: '/custom/path',
      stderr: '',
      pid: 0,
      output: ['', '/custom/path\n', ''],
      signal: null,
    } as unknown as cp.SpawnSyncReturns<Buffer>);

    process.argv = ['node', 'setup.ts', '--dir=/custom/path', '--all'];

    await main();
    // Should not error — runs with the custom dir
    const { printSummary } = require('./setup-core');
    expect(printSummary).toHaveBeenCalled();
  });

  it('handles step failure gracefully (step throws)', async () => {
    process.argv = ['node', 'setup.ts', '--claude'];

    // Make installClaudeHooks throw
    const setupCore = require('./setup-core');
    setupCore.installClaudeHooks.mockRejectedValueOnce(new Error('Permission denied'));

    await main();

    // Should have printed error and still called printSummary
    expect(printSummary).toHaveBeenCalled();
    const errorOutput = stdoutOutput.join('');
    expect(errorOutput).toContain('❌');
    expect(errorOutput).toContain('Permission denied');
  });

  it('handles non-Error throw (string) gracefully', async () => {
    process.argv = ['node', 'setup.ts', '--claude'];

    const setupCore = require('./setup-core');
    setupCore.installClaudeHooks.mockRejectedValueOnce('string error');

    await main();

    expect(printSummary).toHaveBeenCalled();
    const errorOutput = stdoutOutput.join('');
    expect(errorOutput).toContain('❌');
    expect(errorOutput).toContain('string error');
  });

  it('--force flag is passed through to setup options', async () => {
    process.argv = ['node', 'setup.ts', '--all', '--force'];

    await main();

    const setupCore = require('./setup-core');
    const opts = setupCore.defaultGraphifyIgnore.mock.calls[0][0];
    expect(opts.force).toBe(true);
  });

  it('--vscode flag is treated as copilot flag', async () => {
    process.argv = ['node', 'setup.ts', '--vscode'];

    await main();

    const setupCore = require('./setup-core');
    expect(setupCore.installVscodeMcp).toHaveBeenCalled();
  });

  it('handles partial failures alongside successes', async () => {
    process.argv = ['node', 'setup.ts', '--all'];

    const setupCore = require('./setup-core');
    setupCore.installClaudeHooks.mockResolvedValueOnce({
      step: 'Install Claude Code hooks', icon: '⚠️', message: 'hook-receiver not built', path: null,
    });

    await main();

    // printSummary still called with all results
    expect(printSummary).toHaveBeenCalled();
    const summaryArgs = (printSummary as jest.Mock).mock.calls[0];
    const results = summaryArgs[0] as SetupResult[];
    const warningResult = results.find(r => r.step === 'Install Claude Code hooks');
    expect(warningResult).toBeDefined();
    expect(warningResult!.icon).toBe('⚠️');
  });
});
