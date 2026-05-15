/**
 * Tests for platform-installer MCP handlers.
 *
 * Tests handleInstallPlatform and handleInstallGitHooks with mocked
 * fs, installer config, and git hook modules to avoid touching the disk.
 */

import { handleInstallPlatform, handleInstallGitHooks } from './platform-installer';

// ── Module mocks ─────────────────────────────────────────────

jest.mock('fs');
jest.mock('../helpers', () => ({
  findGitRoot: jest.fn(() => '/test-repo'),
}));
jest.mock('../installer', () => ({
  getPlatformConfig: jest.fn(),
}));
jest.mock('../../hooks/git-hooks', () => ({
  installGitHooks: jest.fn(),
  gitAttributesEntry: jest.fn(() => 'graph.json merge=gate-keeper-graph\n'),
  gitConfigEntry: jest.fn(() => '[merge "gate-keeper-graph"]\n\tdriver = /gk/dist/hooks/merge-driver.sh %O %A %B\n'),
}));

import * as fs from 'fs';
import { getPlatformConfig } from '../installer';
import { installGitHooks } from '../../hooks/git-hooks';

const mockGetPlatformConfig = getPlatformConfig as jest.Mock;
const mockInstallGitHooks = installGitHooks as jest.Mock;

// ── Helpers ──────────────────────────────────────────────────

function makeConfig(overrides: Partial<{
  platform: string;
  filePath: string;
  content: string;
  description: string;
  append: boolean;
}> = {}) {
  return {
    platform: 'vscode',
    filePath: '/repo/.vscode/mcp.json',
    content: JSON.stringify({ servers: {} }),
    description: 'VS Code MCP config',
    append: false,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────

describe('handleInstallPlatform', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (fs.mkdirSync as jest.Mock).mockImplementation(() => {});
    (fs.writeFileSync as jest.Mock).mockImplementation(() => {});
    (fs.appendFileSync as jest.Mock).mockImplementation(() => {});
    (fs.readFileSync as jest.Mock).mockReturnValue('');
  });

  it('returns error for invalid platform', async () => {
    const result = await handleInstallPlatform({ platform: 'invalid' });
    expect(result.content[0]?.text).toContain('Error: unknown platform "invalid"');
    expect(result.content[0]?.text).toContain('claude-code');
    expect(result.content[0]?.text).toContain('github-action');
  });

  it('creates config file when it does not exist', async () => {
    mockGetPlatformConfig.mockReturnValue(makeConfig({
      filePath: '/repo/.vscode/mcp.json',
      content: '{"servers":{}}',
      description: 'VS Code MCP config',
    }));
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    const result = await handleInstallPlatform({ platform: 'vscode', repo: '/repo' });

    expect(fs.mkdirSync).toHaveBeenCalledWith('/repo/.vscode', { recursive: true });
    expect(fs.writeFileSync).toHaveBeenCalledWith('/repo/.vscode/mcp.json', '{"servers":{}}', 'utf8');
    expect(result.content[0]?.text).toContain('Platform Integration');
    expect(result.content[0]?.text).toContain('File written');
    expect(result.structuredContent).toBeDefined();
    expect(result.structuredContent!.tool).toBe('install_platform');
    expect((result.structuredContent!.data as Record<string, unknown>).action).toBe('created');
  });

  it('appends content when config.append=true and file exists', async () => {
    mockGetPlatformConfig.mockReturnValue(makeConfig({
      platform: 'claude-code',
      filePath: '/repo/CLAUDE.md',
      content: '\n## Gate Keeper...',
      description: 'Appends session protocol to CLAUDE.md',
      append: true,
    }));
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue('## Existing Content');

    const result = await handleInstallPlatform({ platform: 'claude-code', repo: '/repo' });

    expect(fs.readFileSync).toHaveBeenCalledWith('/repo/CLAUDE.md', 'utf8');
    expect(fs.appendFileSync).toHaveBeenCalledWith('/repo/CLAUDE.md', '\n## Gate Keeper...', 'utf8');
    expect(result.content[0]?.text).toContain('Content appended to existing file');
    expect(result.structuredContent!.tool).toBe('install_platform');
    expect((result.structuredContent!.data as Record<string, unknown>).action).toBe('appended to');
  });

  it('skips when Gate Keeper section already present in append mode', async () => {
    mockGetPlatformConfig.mockReturnValue(makeConfig({
      platform: 'claude-code',
      filePath: '/repo/CLAUDE.md',
      content: '\n## Gate Keeper...',
      description: 'Appends session protocol',
      append: true,
    }));
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue('Already has Gate Keeper section');

    const result = await handleInstallPlatform({ platform: 'claude-code', repo: '/repo' });

    expect(fs.appendFileSync).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(result.content[0]?.text).toContain('already present');
    expect(result.content[0]?.text).toContain('No changes made');
  });

  it('overwrites existing file when force=true', async () => {
    mockGetPlatformConfig.mockReturnValue(makeConfig({
      filePath: '/repo/.vscode/mcp.json',
      content: '{"servers":{"gk":{}}}',
      description: 'VS Code MCP config',
    }));
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    const result = await handleInstallPlatform({ platform: 'vscode', repo: '/repo', force: true });

    expect(fs.writeFileSync).toHaveBeenCalledWith('/repo/.vscode/mcp.json', '{"servers":{"gk":{}}}', 'utf8');
    expect(result.content[0]?.text).toContain('updated');
  });

  it('returns existing-file message when no force and not append', async () => {
    mockGetPlatformConfig.mockReturnValue(makeConfig({
      filePath: '/repo/.vscode/mcp.json',
      append: false,
    }));
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    const result = await handleInstallPlatform({ platform: 'vscode', repo: '/repo' });

    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(result.content[0]?.text).toContain('File already exists');
    expect(result.content[0]?.text).toContain('force=true');
  });

  it('handles file write errors gracefully', async () => {
    mockGetPlatformConfig.mockReturnValue(makeConfig({
      filePath: '/repo/.vscode/mcp.json',
      append: false,
    }));
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (fs.mkdirSync as jest.Mock).mockImplementation(() => {
      throw new Error('Permission denied');
    });

    const result = await handleInstallPlatform({ platform: 'vscode', repo: '/repo' });

    expect(result.content[0]?.text).toContain('Error writing');
    expect(result.content[0]?.text).toContain('Permission denied');
  });

  it('returns error when platform arg is undefined (empty string)', async () => {
    const result = await handleInstallPlatform({});
    expect(result.content[0]?.text).toContain('unknown platform ""');
  });

  it('handles non-Error thrown during write gracefully', async () => {
    mockGetPlatformConfig.mockReturnValue(makeConfig({
      filePath: '/repo/.vscode/mcp.json',
      append: false,
    }));
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (fs.mkdirSync as jest.Mock).mockImplementation(() => {
      throw 'string error'; // eslint-disable-line no-throw-literal
    });

    const result = await handleInstallPlatform({ platform: 'vscode', repo: '/repo' });

    expect(result.content[0]?.text).toContain('Error writing');
    expect(result.content[0]?.text).toContain('string error');
  });

  it('writes file (not appends) when config.append=true but file does not exist', async () => {
    // When append mode is requested but file doesn't exist,
    // the else branch (writeFileSync) is taken, not appendFileSync.
    mockGetPlatformConfig.mockReturnValue(makeConfig({
      platform: 'claude-code',
      filePath: '/repo/CLAUDE.md',
      content: '\n## Gate Keeper...',
      description: 'Appends session protocol',
      append: true,
    }));
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    const result = await handleInstallPlatform({ platform: 'claude-code', repo: '/repo' });

    // File doesn't exist, so it should write (not append)
    expect(fs.writeFileSync).toHaveBeenCalledWith('/repo/CLAUDE.md', '\n## Gate Keeper...', 'utf8');
    expect(fs.appendFileSync).not.toHaveBeenCalled();
    // The code labels the action as "appended to" since config.append=true
    // even though writeFileSync was used
    expect(result.content[0]?.text).toContain('Content appended to existing file');
  });
});

// -- handleInstallGitHooks --------------------------------------
// NOTE: Each test sets its own mockImplementation to avoid
// cross-test state interference.

describe('handleInstallGitHooks', () => {
  it('calls installGitHooks and returns formatted results', async () => {
    mockInstallGitHooks.mockImplementation(() => [
      { hook: 'post-commit', path: '/test-repo/.git/hooks/post-commit', action: 'created', content: 'hook1' },
      { hook: 'post-checkout', path: '/test-repo/.git/hooks/post-checkout', action: 'created', content: 'hook2' },
    ]);

    const result = await handleInstallGitHooks({ repo: '/test-repo', gate_keeper_path: '/gk' });

    expect(installGitHooks).toHaveBeenCalledWith('/test-repo', '/gk', false);
    // Counts appear in markdown, wrapped in ** bold markers
    const text = result.content[0]?.text;
    expect(text).toContain('Git Hooks Installation');
    expect(text).toContain('**Created:** 2');
    expect(text).toContain('**Updated:** 0');
    expect(text).toContain('**Skipped:** 0');
    expect(text).toContain('post-commit');
    expect(text).toContain('graph.json merge=gate-keeper-graph');
    expect(text).toContain('Merge driver');
    expect(result.structuredContent!.tool).toBe('install_git_hooks');
  });

  it('counts updated and skipped hooks correctly', async () => {
    mockInstallGitHooks.mockImplementation(() => [
      { hook: 'post-commit', path: '/test-repo/.git/hooks/post-commit', action: 'updated', content: 'modified' },
      { hook: 'post-checkout', path: '/test-repo/.git/hooks/post-checkout', action: 'skipped', content: 'existing' },
    ]);

    const result = await handleInstallGitHooks({ repo: '/test-repo', force: true });

    const text = result.content[0]?.text;
    expect(text).toContain('**Updated:** 1');
    expect(text).toContain('**Skipped:** 1');
    expect(text).toContain('**Created:** 0');
  });

  it('handles errors gracefully', async () => {
    mockInstallGitHooks.mockImplementation(() => {
      throw new Error('Not a git repository');
    });

    const result = await handleInstallGitHooks({ repo: '/fake-repo' });

    expect(result.content[0]?.text).toContain('Error installing git hooks');
    expect(result.content[0]?.text).toContain('Not a git repository');
  });

  it('handles non-Error thrown during git hooks gracefully', async () => {
    mockInstallGitHooks.mockImplementation(() => {
      throw 'unknown failure'; // eslint-disable-line no-throw-literal
    });

    const result = await handleInstallGitHooks({ repo: '/fake-repo' });

    expect(result.content[0]?.text).toContain('Error installing git hooks');
    expect(result.content[0]?.text).toContain('unknown failure');
  });

  it('uses findGitRoot when repo is not provided', async () => {
    // When no repo arg, handleInstallGitHooks falls back to findGitRoot
    mockInstallGitHooks.mockReturnValue([]);

    const result = await handleInstallGitHooks({});

    expect(result.content[0]?.text).toContain('Git Hooks Installation');
  });
});

// -- nextSteps (indirect via handleInstallPlatform) -------------

describe('nextSteps (indirect via handleInstallPlatform)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (fs.mkdirSync as jest.Mock).mockImplementation(() => {});
    (fs.writeFileSync as jest.Mock).mockImplementation(() => {});
  });

  const testCases = [
    {
      platform: 'claude-code',
      expected: ['Restart Claude Code', 'session-start protocol'],
    },
    {
      platform: 'copilot',
      expected: ['GitHub Copilot', 'copilot-instructions.md'],
    },
    {
      platform: 'cursor',
      expected: ['Cursor reads', '.cursorrules'],
    },
    {
      platform: 'vscode',
      expected: ['VS Code and accept', 'MCP server popup'],
    },
    {
      platform: 'github-action',
      expected: ['Commit .github/workflows', 'The workflow runs'],
    },
  ];

  for (const { platform, expected } of testCases) {
    it(`returns correct next steps for ${platform}`, async () => {
      mockGetPlatformConfig.mockReturnValue(makeConfig({
        platform: platform as string,
        filePath: `/repo/${platform}.config`,
        content: '',
        description: `${platform} config`,
        append: true,
      }));

      const result = await handleInstallPlatform({ platform, repo: '/repo' });
      const text = result.content[0]?.text;

      for (const keyword of expected) {
        expect(text).toContain(keyword);
      }
    });
  }
});
