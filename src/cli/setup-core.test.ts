/**
 * Unit tests for src/cli/setup-core.ts
 * Coverage target: ≥ 80% line coverage
 */

import * as fs from 'fs';
import * as cp from 'child_process';
import * as path from 'path';

jest.mock('fs');
jest.mock('os', () => ({ homedir: () => '/home/testuser' }));
jest.mock('child_process');
jest.mock('../mcp/installer', () => ({
  copilotConfig: jest.fn().mockReturnValue({
    filePath: '/test/repo/.github/copilot-instructions.md',
    content: '# Gate Keeper\nSome content here',
  }),
}));

const mockFs = jest.mocked(fs);
const mockCp = jest.mocked(cp);

// Import after mocks are registered
import {
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

const baseOpts: SetupOptions = {
  all: false,
  claude: false,
  copilot: false,
  cursor: false,
  gitHooks: false,
  githubAction: false,
  scan: false,
  force: false,
  repoRoot: '/test/repo',
  gkDir: '/home/testuser/.gate-keeper',
};

beforeEach(() => {
  jest.clearAllMocks();
  // Default: files don't exist, dirs/writes succeed
  mockFs.existsSync.mockReturnValue(false);
  mockFs.mkdirSync.mockReturnValue(undefined);
  mockFs.writeFileSync.mockReturnValue(undefined);
  mockFs.readFileSync.mockReturnValue('{}');
});

// ── defaultGraphifyIgnore ─────────────────────────────────────────────────────

describe('defaultGraphifyIgnore', () => {
  it('returns skip icon when file exists and force=false', async () => {
    mockFs.existsSync.mockReturnValue(true);
    const result = await defaultGraphifyIgnore(baseOpts);
    expect(result.icon).toBe('⏭');
    expect(result.step).toBe('Create .graphifyignore');
    expect(result.message).toMatch(/Already exists/);
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });

  it('returns success and writes file when file does not exist', async () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = await defaultGraphifyIgnore(baseOpts);
    expect(result.icon).toBe('✅');
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      path.join('/test/repo', '.graphifyignore'),
      expect.stringContaining('node_modules/'),
      'utf8',
    );
  });

  it('returns success and overwrites when force=true even if file exists', async () => {
    mockFs.existsSync.mockReturnValue(true);
    const result = await defaultGraphifyIgnore({ ...baseOpts, force: true });
    expect(result.icon).toBe('✅');
    expect(mockFs.writeFileSync).toHaveBeenCalled();
  });

  it('writes correct default patterns', async () => {
    mockFs.existsSync.mockReturnValue(false);
    await defaultGraphifyIgnore(baseOpts);
    const written = (mockFs.writeFileSync as jest.Mock).mock.calls[0][1] as string;
    expect(written).toContain('dist/');
    expect(written).toContain('node_modules/');
    expect(written).toContain('*.d.ts');
    expect(written).toContain('**/__snapshots__/**');
  });

  it('returns correct file path in result', async () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = await defaultGraphifyIgnore(baseOpts);
    expect(result.path).toBe(path.join('/test/repo', '.graphifyignore'));
  });
});

// ── installClaudeHooks ────────────────────────────────────────────────────────

describe('installClaudeHooks', () => {
  const settingsPath = '/home/testuser/.claude/settings.json';
  const hookScript = '/home/testuser/.gate-keeper/dist/hook-receiver.js';

  it('returns warning when hook-receiver is not built', async () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = await installClaudeHooks(baseOpts);
    expect(result.icon).toBe('⚠️');
    expect(result.message).toMatch(/hook-receiver not built/);
    expect(result.message).toMatch(/npm run build/);
  });

  it('configures all 4 hook events when settings.json does not exist', async () => {
    // hook-receiver exists, settings.json does not
    mockFs.existsSync.mockImplementation((p) => String(p) === hookScript);
    mockFs.readFileSync.mockReturnValue('{}');

    const result = await installClaudeHooks(baseOpts);

    expect(result.icon).toBe('✅');
    expect(result.message).toContain('SessionStart');
    expect(result.message).toContain('PreToolUse');
    expect(result.message).toContain('PostToolUse');
    expect(result.message).toContain('UserPromptSubmit');

    const writeCall = (mockFs.writeFileSync as jest.Mock).mock.calls[0];
    const written = JSON.parse(writeCall[1]);
    expect(written.hooks).toHaveProperty('SessionStart');
    expect(written.hooks).toHaveProperty('PreToolUse');
    expect(written.hooks).toHaveProperty('PostToolUse');
    expect(written.hooks).toHaveProperty('UserPromptSubmit');
  });

  it('does not duplicate hooks when they already exist in settings.json', async () => {
    const existingSettings = {
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: `node ${hookScript}` }] }],
        PostToolUse: [{ matcher: 'Write|Edit', hooks: [{ type: 'command', command: `node ${hookScript}` }] }],
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: `node ${hookScript}` }] }],
      },
    };

    mockFs.existsSync.mockImplementation((p) =>
      String(p) === hookScript || String(p) === settingsPath,
    );
    mockFs.readFileSync.mockReturnValue(JSON.stringify(existingSettings));

    await installClaudeHooks(baseOpts);

    const writeCall = (mockFs.writeFileSync as jest.Mock).mock.calls[0];
    const written = JSON.parse(writeCall[1]);

    // SessionStart should still have exactly 1 entry (no duplicate)
    expect(written.hooks.SessionStart).toHaveLength(1);
    expect(written.hooks.PostToolUse).toHaveLength(1);
    expect(written.hooks.UserPromptSubmit).toHaveLength(1);
  });

  it('adds repoRoot to additionalDirectories', async () => {
    mockFs.existsSync.mockImplementation((p) => String(p) === hookScript);
    mockFs.readFileSync.mockReturnValue('{}');

    await installClaudeHooks(baseOpts);

    const writeCall = (mockFs.writeFileSync as jest.Mock).mock.calls[0];
    const written = JSON.parse(writeCall[1]);
    expect(written.additionalDirectories).toContain('/test/repo');
  });

  it('does not duplicate repoRoot in additionalDirectories if already present', async () => {
    const existingSettings = {
      additionalDirectories: ['/test/repo'],
    };
    mockFs.existsSync.mockImplementation((p) => String(p) === hookScript);
    mockFs.readFileSync.mockReturnValue(JSON.stringify(existingSettings));

    await installClaudeHooks(baseOpts);

    const writeCall = (mockFs.writeFileSync as jest.Mock).mock.calls[0];
    const written = JSON.parse(writeCall[1]);
    expect(written.additionalDirectories.filter((d: string) => d === '/test/repo')).toHaveLength(1);
  });

  it('handles corrupt settings.json gracefully', async () => {
    mockFs.existsSync.mockImplementation((p) => String(p) === hookScript || String(p) === settingsPath);
    mockFs.readFileSync.mockReturnValue('NOT VALID JSON{{{');

    const result = await installClaudeHooks(baseOpts);
    // Should still succeed — falls back to empty settings
    expect(result.icon).toBe('✅');
  });

  it('writes settings to correct path', async () => {
    mockFs.existsSync.mockImplementation((p) => String(p) === hookScript);
    mockFs.readFileSync.mockReturnValue('{}');

    await installClaudeHooks(baseOpts);

    const writeCall = (mockFs.writeFileSync as jest.Mock).mock.calls[0];
    expect(writeCall[0]).toBe(settingsPath);
  });
});

// ── installCopilotInstructions ────────────────────────────────────────────────

describe('installCopilotInstructions', () => {
  it('returns skip icon when file exists and force=false', async () => {
    mockFs.existsSync.mockReturnValue(true);
    const result = await installCopilotInstructions(baseOpts);
    expect(result.icon).toBe('⏭');
    expect(result.message).toMatch(/Already exists/);
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });

  it('creates the copilot instructions file when absent', async () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = await installCopilotInstructions(baseOpts);
    expect(result.icon).toBe('✅');
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      '/test/repo/.github/copilot-instructions.md',
      '# Gate Keeper\nSome content here',
      'utf8',
    );
  });

  it('overwrites when force=true even if file exists', async () => {
    mockFs.existsSync.mockReturnValue(true);
    const result = await installCopilotInstructions({ ...baseOpts, force: true });
    expect(result.icon).toBe('✅');
    expect(mockFs.writeFileSync).toHaveBeenCalled();
  });

  it('creates parent directory before writing', async () => {
    mockFs.existsSync.mockReturnValue(false);
    await installCopilotInstructions(baseOpts);
    expect(mockFs.mkdirSync).toHaveBeenCalledWith(
      '/test/repo/.github',
      { recursive: true },
    );
  });

  it('includes byte count in success message', async () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = await installCopilotInstructions(baseOpts);
    // content length is 26 ("# Gate Keeper\nSome content here".length)
    expect(result.message).toMatch(/\d+ bytes/);
  });
});

// ── installVscodeMcp ──────────────────────────────────────────────────────────

describe('installVscodeMcp', () => {
  const mcpFile = '/test/repo/.vscode/mcp.json';

  it('returns skip icon when mcp.json exists and force=false', async () => {
    mockFs.existsSync.mockImplementation((p) => String(p) === mcpFile);
    const result = await installVscodeMcp(baseOpts);
    expect(result.icon).toBe('⏭');
    expect(result.message).toMatch(/Already exists/);
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });

  it('creates mcp.json with correct server structure when absent', async () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = await installVscodeMcp(baseOpts);
    expect(result.icon).toBe('✅');

    const writeCall = (mockFs.writeFileSync as jest.Mock).mock.calls[0];
    expect(writeCall[0]).toBe(mcpFile);
    const written = JSON.parse(writeCall[1]);
    expect(written.servers).toHaveProperty('gate-keeper');
    expect(written.servers['gate-keeper'].command).toBe('node');
    expect(written.servers['gate-keeper'].args[0]).toContain('server.js');
  });

  it('creates .vscode directory before writing', async () => {
    mockFs.existsSync.mockReturnValue(false);
    await installVscodeMcp(baseOpts);
    expect(mockFs.mkdirSync).toHaveBeenCalledWith('/test/repo/.vscode', { recursive: true });
  });

  it('includes copilot-insights note when insights file exists', async () => {
    const insightsFile = '/test/repo/.github/copilot-insights.yml';
    mockFs.existsSync.mockImplementation((p) => String(p) === insightsFile);
    const result = await installVscodeMcp(baseOpts);
    expect(result.icon).toBe('✅');
    expect(result.message).toContain('copilot-insights.yml found');
  });

  it('overwrites mcp.json when force=true', async () => {
    mockFs.existsSync.mockImplementation((p) => String(p) === mcpFile);
    const result = await installVscodeMcp({ ...baseOpts, force: true });
    expect(result.icon).toBe('✅');
    expect(mockFs.writeFileSync).toHaveBeenCalled();
  });
});

// ── installCursorRules ────────────────────────────────────────────────────────

describe('installCursorRules', () => {
  const cursorFile = '/test/repo/.cursorrules';

  it('returns skip icon when .cursorrules exists and force=false', async () => {
    mockFs.existsSync.mockReturnValue(true);
    const result = await installCursorRules(baseOpts);
    expect(result.icon).toBe('⏭');
    expect(result.message).toMatch(/Already exists/);
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });

  it('creates .cursorrules with gate-keeper content when absent', async () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = await installCursorRules(baseOpts);
    expect(result.icon).toBe('✅');
    expect(result.message).toContain('.cursorrules created');

    const writeCall = (mockFs.writeFileSync as jest.Mock).mock.calls[0];
    expect(writeCall[0]).toBe(cursorFile);
    const content = writeCall[1] as string;
    expect(content).toContain('Gate Keeper');
    expect(content).toContain('check_pre_edit_safety');
    expect(content).toContain('analyze_file');
  });

  it('overwrites when force=true even if file exists', async () => {
    mockFs.existsSync.mockReturnValue(true);
    const result = await installCursorRules({ ...baseOpts, force: true });
    expect(result.icon).toBe('✅');
    expect(mockFs.writeFileSync).toHaveBeenCalled();
  });

  it('returns correct file path', async () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = await installCursorRules(baseOpts);
    expect(result.path).toBe(cursorFile);
  });
});

// ── installGitHubWorkflow ─────────────────────────────────────────────────────

describe('installGitHubWorkflow', () => {
  const workflowFile = '/test/repo/.github/workflows/gate-keeper.yml';

  it('returns skip icon when workflow file exists and force=false', async () => {
    mockFs.existsSync.mockReturnValue(true);
    const result = await installGitHubWorkflow(baseOpts);
    expect(result.icon).toBe('⏭');
    expect(result.message).toMatch(/Already exists/);
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });

  it('creates workflow file when absent', async () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = await installGitHubWorkflow(baseOpts);
    expect(result.icon).toBe('✅');
    expect(result.message).toContain('gate-keeper.yml');
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      workflowFile,
      expect.stringContaining('Gate Keeper'),
      'utf8',
    );
  });

  it('creates workflows directory before writing', async () => {
    mockFs.existsSync.mockReturnValue(false);
    await installGitHubWorkflow(baseOpts);
    expect(mockFs.mkdirSync).toHaveBeenCalledWith(
      '/test/repo/.github/workflows',
      { recursive: true },
    );
  });

  it('overwrites when force=true', async () => {
    mockFs.existsSync.mockReturnValue(true);
    const result = await installGitHubWorkflow({ ...baseOpts, force: true });
    expect(result.icon).toBe('✅');
    expect(mockFs.writeFileSync).toHaveBeenCalled();
  });

  it('workflow content includes pull_request trigger and quality-gate job', async () => {
    mockFs.existsSync.mockReturnValue(false);
    await installGitHubWorkflow(baseOpts);
    const written = (mockFs.writeFileSync as jest.Mock).mock.calls[0][1] as string;
    expect(written).toContain('pull_request');
    expect(written).toContain('quality-gate');
  });
});

// ── installGitHooks ───────────────────────────────────────────────────────────

describe('installGitHooks', () => {
  const hooksDir = '/test/repo/.git/hooks';
  const hookScript = '/home/testuser/.gate-keeper/dist/hook-receiver.js';

  it('returns warning when not a git repo (no .git/hooks dir)', async () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = await installGitHooks(baseOpts);
    expect(result.icon).toBe('⚠️');
    expect(result.message).toMatch(/Not a git repository/);
    expect(result.path).toBeNull();
  });

  it('returns warning when hook-receiver is not built', async () => {
    mockFs.existsSync.mockImplementation((p) => String(p) === hooksDir);
    const result = await installGitHooks(baseOpts);
    expect(result.icon).toBe('⚠️');
    expect(result.message).toMatch(/hook-receiver not built/);
  });

  it('creates post-commit and post-checkout hooks when both absent', async () => {
    mockFs.existsSync.mockImplementation(
      (p) => String(p) === hooksDir || String(p) === hookScript,
    );
    const result = await installGitHooks(baseOpts);
    expect(result.icon).toBe('✅');
    expect(result.message).toContain('2 hook(s) installed');
    expect(mockFs.writeFileSync).toHaveBeenCalledTimes(2);

    const writtenPaths = (mockFs.writeFileSync as jest.Mock).mock.calls.map(
      (c) => c[0],
    );
    expect(writtenPaths).toContain(path.join(hooksDir, 'post-commit'));
    expect(writtenPaths).toContain(path.join(hooksDir, 'post-checkout'));
  });

  it('returns skip when hooks already exist and force=false', async () => {
    mockFs.existsSync.mockReturnValue(true); // all paths exist
    const result = await installGitHooks(baseOpts);
    expect(result.icon).toBe('⏭');
    expect(result.message).toMatch(/already exist/);
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });

  it('overwrites existing hooks when force=true', async () => {
    mockFs.existsSync.mockReturnValue(true); // all paths exist
    const result = await installGitHooks({ ...baseOpts, force: true });
    expect(result.icon).toBe('✅');
    expect(mockFs.writeFileSync).toHaveBeenCalledTimes(2);
  });

  it('writes hooks with executable mode 0o755', async () => {
    mockFs.existsSync.mockImplementation(
      (p) => String(p) === hooksDir || String(p) === hookScript,
    );
    await installGitHooks(baseOpts);
    const writeCalls = (mockFs.writeFileSync as jest.Mock).mock.calls;
    for (const call of writeCalls) {
      expect(call[2]).toEqual({ mode: 0o755 });
    }
  });

  it('hook content references hook-receiver.js', async () => {
    mockFs.existsSync.mockImplementation(
      (p) => String(p) === hooksDir || String(p) === hookScript,
    );
    await installGitHooks(baseOpts);
    const writeCalls = (mockFs.writeFileSync as jest.Mock).mock.calls;
    for (const call of writeCalls) {
      expect(call[1]).toContain(hookScript);
    }
  });

  it('skips one hook and creates one when one already exists', async () => {
    const postCommitPath = path.join(hooksDir, 'post-commit');
    mockFs.existsSync.mockImplementation(
      (p) =>
        String(p) === hooksDir ||
        String(p) === hookScript ||
        String(p) === postCommitPath,
    );
    const result = await installGitHooks(baseOpts);
    expect(result.icon).toBe('✅');
    expect(result.message).toContain('1 hook(s) installed');
    expect(result.message).toContain('1 skipped');
  });
});

// ── runInitialScan ────────────────────────────────────────────────────────────

describe('runInitialScan', () => {
  const daemonScript = '/home/testuser/.gate-keeper/dist/daemon.js';

  it('returns warning when daemon not built', async () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = await runInitialScan(baseOpts);
    expect(result.icon).toBe('⚠️');
    expect(result.message).toMatch(/Daemon not built/);
    expect(result.message).toMatch(/npm run build/);
  });

  it('starts daemon and returns success when scan succeeds', async () => {
    mockFs.existsSync.mockImplementation((p) => String(p) === daemonScript);
    mockFs.readFileSync.mockReturnValue('{}');

    const mockChild = { unref: jest.fn() };
    (mockCp.spawn as jest.Mock).mockReturnValue(mockChild);
    (mockCp.spawnSync as jest.Mock).mockReturnValue({ status: 0, stdout: '{}', stderr: '' });

    const result = await runInitialScan(baseOpts);
    expect(result.icon).toBe('✅');
    expect(result.message).toContain('Daemon started');
    expect(mockChild.unref).toHaveBeenCalled();
  }, 10000);

  it('returns warning when curl scan trigger fails', async () => {
    mockFs.existsSync.mockImplementation((p) => String(p) === daemonScript);
    mockFs.readFileSync.mockReturnValue('{}');

    const mockChild = { unref: jest.fn() };
    (mockCp.spawn as jest.Mock).mockReturnValue(mockChild);
    (mockCp.spawnSync as jest.Mock).mockReturnValue({ status: 1, stdout: '', stderr: 'error' });

    const result = await runInitialScan(baseOpts);
    expect(result.icon).toBe('⚠️');
    expect(result.message).toMatch(/scan trigger failed/);
  }, 10000);

  it('kills existing daemon pid if pid file exists', async () => {
    const pidFile = '/home/testuser/.gate-keeper/daemon.pid';
    mockFs.existsSync.mockImplementation(
      (p) => String(p) === daemonScript || String(p) === pidFile,
    );
    mockFs.readFileSync.mockImplementation((p) => {
      if (String(p) === pidFile) return '99999';
      return '{}';
    });

    const mockChild = { unref: jest.fn() };
    (mockCp.spawn as jest.Mock).mockReturnValue(mockChild);
    (mockCp.spawnSync as jest.Mock).mockReturnValue({ status: 0 });

    // Should not throw even if kill fails (process not running)
    await expect(runInitialScan(baseOpts)).resolves.toBeDefined();
  }, 10000);
});

// ── printSummary ──────────────────────────────────────────────────────────────

describe('printSummary', () => {
  let writtenOutput: string;
  let originalWrite: typeof process.stdout.write;

  beforeEach(() => {
    writtenOutput = '';
    originalWrite = process.stdout.write.bind(process.stdout);
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      writtenOutput += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const makeResults = (icons: string[]): SetupResult[] =>
    icons.map((icon, i) => ({ step: `Step ${i}`, icon, message: 'msg', path: null }));

  it('writes success/warning/skip/fail counts to stdout', () => {
    const results = makeResults(['✅', '✅', '⚠️', '⏭', '❌']);
    printSummary(results, '/test/repo');
    expect(writtenOutput).toContain('2 installed');
    expect(writtenOutput).toContain('1 skipped');
    expect(writtenOutput).toContain('1 warnings');
    expect(writtenOutput).toContain('1 failed');
  });

  it('writes "Next steps" section when successes > 0', () => {
    const results = makeResults(['✅']);
    printSummary(results, '/test/repo');
    expect(writtenOutput).toContain('Next steps');
    expect(writtenOutput).toContain('http://localhost:5378/viz');
  });

  it('does NOT write next steps when successes = 0', () => {
    const results = makeResults(['⚠️', '⏭']);
    printSummary(results, '/test/repo');
    expect(writtenOutput).not.toContain('Next steps');
  });

  it('uses basename of repoRoot in the header', () => {
    printSummary([], '/some/path/my-project');
    expect(writtenOutput).toContain('my-project');
  });

  it('handles empty results without error', () => {
    expect(() => printSummary([], '/test/repo')).not.toThrow();
    expect(writtenOutput).toContain('0 installed');
  });
});
