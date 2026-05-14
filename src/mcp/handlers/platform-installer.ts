/**
 * MCP handlers for platform integration and git hook installation.
 *
 * install_platform — writes AI assistant config files (CLAUDE.md, copilot-instructions.md, etc.)
 * install_git_hooks — installs post-commit / post-checkout hooks into .git/hooks/
 */

import * as fs from 'fs';
import * as path from 'path';
import { findGitRoot } from '../helpers';
import { text, envelope, McpResponse } from './shared';
import { getPlatformConfig, Platform } from '../installer';
import { installGitHooks, gitAttributesEntry, gitConfigEntry } from '../../hooks/git-hooks';

const GATE_KEEPER_DIR = path.join(__dirname, '..', '..', '..');

const SUPPORTED_PLATFORMS: Platform[] = ['claude-code', 'copilot', 'cursor', 'vscode', 'github-action'];

export async function handleInstallPlatform(args: Record<string, unknown>): Promise<McpResponse> {
  const platform = String(args.platform ?? '') as Platform;
  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    return text(
      `Error: unknown platform "${platform}". ` +
      `Supported: ${SUPPORTED_PLATFORMS.join(', ')}.`,
    );
  }

  const repo = String(args.repo ?? findGitRoot(process.cwd()));
  const force = Boolean(args.force ?? false);
  const gkPath = String(args.gate_keeper_path ?? GATE_KEEPER_DIR);

  const config = getPlatformConfig(platform, repo, gkPath);
  const targetPath = config.filePath;
  const exists = fs.existsSync(targetPath);

  if (exists && !force && !config.append) {
    return text(
      `File already exists: ${targetPath}\n` +
      `Pass force=true to overwrite, or use append mode if available.`,
    );
  }

  try {
    const dir = path.dirname(targetPath);
    fs.mkdirSync(dir, { recursive: true });

    if (config.append && exists) {
      const current = fs.readFileSync(targetPath, 'utf8');
      if (current.includes('Gate Keeper')) {
        return text(`Gate Keeper section already present in ${targetPath}. No changes made.`);
      }
      fs.appendFileSync(targetPath, config.content, 'utf8');
    } else {
      fs.writeFileSync(targetPath, config.content, 'utf8');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return text(`Error writing ${targetPath}: ${msg}`);
  }

  const action = config.append ? 'appended to' : (exists ? 'updated' : 'created');
  const lines = [
    `## Platform Integration: ${platform}`,
    `**${action}:** ${targetPath}`,
    `**Description:** ${config.description}`,
    '',
    config.append
      ? `Content appended to existing file.`
      : `File written (${config.content.length} bytes).`,
    '',
    '**Next steps:**',
    ...nextSteps(platform, repo),
  ];

  return envelope('install_platform', { platform, filePath: targetPath, action }, lines.join('\n'));
}

export async function handleInstallGitHooks(args: Record<string, unknown>): Promise<McpResponse> {
  const repo = String(args.repo ?? findGitRoot(process.cwd()));
  const force = Boolean(args.force ?? false);
  const gkPath = String(args.gate_keeper_path ?? GATE_KEEPER_DIR);

  let results;
  try {
    results = installGitHooks(repo, gkPath, force);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return text(`Error installing git hooks: ${msg}`);
  }

  const created = results.filter(r => r.action === 'created').length;
  const updated = results.filter(r => r.action === 'updated').length;
  const skipped = results.filter(r => r.action === 'skipped').length;

  const lines = [
    '## Git Hooks Installation',
    `**Repository:** ${repo}`,
    `**Created:** ${created} | **Updated:** ${updated} | **Skipped:** ${skipped}`,
    '',
    '| Hook | Path | Action |',
    '|------|------|--------|',
    ...results.map(r => `| ${r.hook} | ${path.relative(repo, r.path)} | ${r.action} |`),
    '',
    '**Merge driver (optional):**',
    'To prevent merge conflicts in graph.json, add to .gitattributes:',
    '```',
    gitAttributesEntry().trim(),
    '```',
    'And to .git/config:',
    '```',
    gitConfigEntry(gkPath).trim(),
    '```',
    '',
    '_Hooks run non-blocking after commits/checkouts — they do not slow down git operations._',
  ];

  return envelope('install_git_hooks', { repo, results }, lines.join('\n'));
}

function nextSteps(platform: Platform, repo: string): string[] {
  switch (platform) {
    case 'claude-code':
      return [
        '- Restart Claude Code to load the updated CLAUDE.md.',
        '- The session-start protocol will now automatically call `get_graph_report`.',
      ];
    case 'copilot':
      return [
        '- GitHub Copilot will read .github/copilot-instructions.md automatically.',
        '- Ensure the gate-keeper MCP server is running: `npm run mcp`.',
      ];
    case 'cursor':
      return [
        '- Cursor reads .cursorrules automatically on project open.',
        '- Ensure the gate-keeper MCP server is registered in Cursor settings.',
      ];
    case 'vscode':
      return [
        '- Open VS Code and accept the MCP server popup.',
        '- Or run: `npm run mcp` and check the MCP panel.',
      ];
    case 'github-action':
      return [
        `- Commit .github/workflows/gate-keeper.yml to activate the workflow.`,
        '- The workflow runs on push and PR, posting quality summaries as comments.',
      ];
  }
}
