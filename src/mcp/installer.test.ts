import * as path from 'path';
import {
  claudeCodeConfig,
  copilotConfig,
  cursorConfig,
  vscodeConfig,
  githubActionConfig,
  getPlatformConfig,
} from './installer';

const REPO = '/repo/my-project';

describe('claudeCodeConfig', () => {
  const cfg = claudeCodeConfig(REPO);

  it('targets CLAUDE.md', () => {
    expect(cfg.filePath).toBe(path.join(REPO, 'CLAUDE.md'));
  });

  it('appends to existing file', () => {
    expect(cfg.append).toBe(true);
  });

  it('mentions key MCP tools', () => {
    expect(cfg.content).toContain('get_graph_report');
    expect(cfg.content).toContain('check_pre_edit_safety');
    expect(cfg.content).toContain('get_impact_set');
  });
});

describe('copilotConfig', () => {
  const cfg = copilotConfig(REPO);

  it('targets .github/copilot-instructions.md', () => {
    expect(cfg.filePath).toContain('copilot-instructions.md');
  });

  it('does not append', () => {
    expect(cfg.append).toBe(false);
  });

  it('includes MCP server JSON', () => {
    expect(cfg.content).toContain('"gate-keeper"');
    expect(cfg.content).toContain('dist/mcp/server.js');
  });

  it('accepts custom server path', () => {
    const cfg2 = copilotConfig(REPO, 'npx gate-keeper');
    expect(cfg2.content).toContain('npx gate-keeper');
  });
});

describe('cursorConfig', () => {
  const cfg = cursorConfig(REPO);

  it('targets .cursorrules', () => {
    expect(cfg.filePath).toBe(path.join(REPO, '.cursorrules'));
  });

  it('contains quality gate instruction', () => {
    expect(cfg.content).toContain('analyze_file');
    expect(cfg.content).toContain('7.0');
  });
});

describe('vscodeConfig', () => {
  const cfg = vscodeConfig(REPO);

  it('targets .vscode/mcp.json', () => {
    expect(cfg.filePath).toBe(path.join(REPO, '.vscode', 'mcp.json'));
  });

  it('produces valid JSON content', () => {
    expect(() => JSON.parse(cfg.content)).not.toThrow();
  });

  it('includes gate-keeper server entry', () => {
    const parsed = JSON.parse(cfg.content);
    expect(parsed.servers).toHaveProperty('gate-keeper');
    expect(parsed.servers['gate-keeper'].args).toContain('dist/mcp/server.js');
  });
});

describe('githubActionConfig', () => {
  const cfg = githubActionConfig();

  it('targets .github/workflows/gate-keeper.yml', () => {
    expect(cfg.filePath).toContain('gate-keeper.yml');
  });

  it('contains valid YAML markers', () => {
    expect(cfg.content).toContain('name: Gate Keeper');
    expect(cfg.content).toContain('on:');
    expect(cfg.content).toContain('jobs:');
  });

  it('posts PR comment', () => {
    expect(cfg.content).toContain('pull_request');
    expect(cfg.content).toContain('createComment');
  });
});

describe('getPlatformConfig dispatch', () => {
  const platforms = ['claude-code', 'copilot', 'cursor', 'vscode', 'github-action'] as const;

  for (const p of platforms) {
    it(`returns config for ${p}`, () => {
      const cfg = getPlatformConfig(p, REPO);
      expect(cfg.platform).toBe(p);
      expect(typeof cfg.filePath).toBe('string');
      expect(typeof cfg.content).toBe('string');
      expect(cfg.content.length).toBeGreaterThan(50);
    });
  }
});
