/**
 * MCP Server Helpers
 *
 * Utility functions for file operations, formatting, and daemon communication.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { spawnSync } from 'child_process';
import { UniversalAnalyzer } from '../analyzer/universal-analyzer';
import { StringAnalysisResult } from '../analyzer/string-analyzer';
import { FileAnalysis } from '../types';
import { fixText } from '../util/fix-text';

// ── Configuration ──────────────────────────────────────────

const GK_DIR = path.join(process.env.HOME ?? '/tmp', '.gate-keeper');
const CONFIG_FILE = path.join(GK_DIR, 'config.json');
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'bin', 'obj', 'build', '.next',
  'coverage', '.cache', '.turbo', 'out', 'target',
]);

// ── Shared instance ────────────────────────────────────────

const fileAnalyzer = new UniversalAnalyzer();

// ── Configuration Helpers ──────────────────────────────────

/**
 * Reads the minimum rating threshold from the config file.
 * Returns 7.0 if config doesn't exist or is invalid.
 */
export function getMinRating(): number {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return config.minRating ?? 7.0;
  } catch {
    return 7.0;
  }
}

// ── Network Helpers ────────────────────────────────────────

const DAEMON_PORT = 5378;

/**
 * Fetch JSON from the Gate Keeper daemon HTTP API.
 * Returns null if daemon is unreachable.
 */
export function fetchDaemonApi(urlPath: string): Promise<unknown> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${DAEMON_PORT}${urlPath}`, { timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (chunk: string) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// ── File System Helpers ────────────────────────────────────

/**
 * Finds the git repository root directory from a starting path.
 * Returns the original path if not in a git repo.
 */
export function findGitRoot(dir: string): string {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: dir, encoding: 'utf8', timeout: 3000,
  });
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : dir;
}

/**
 * Recursively finds supported source files in a directory.
 * Stops when maxFiles is reached.
 */
export function findSourceFiles(dir: string, maxFiles: number): string[] {
  const files: string[] = [];
  const walk = (d: string) => {
    if (files.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      const fullPath = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(fullPath);
      } else if (fileAnalyzer.isSupportedFile(fullPath)) {
        files.push(fullPath);
      }
    }
  };
  walk(dir);
  return files;
}

// ── Formatting Helpers ─────────────────────────────────────

/**
 * Formats a file analysis result as markdown for display.
 */
export function formatAnalysisResult(analysis: FileAnalysis, minRating: number): string {
  const passed = analysis.rating >= minRating;
  const icon = passed ? '✅' : '❌';
  const status = passed ? 'PASSED' : 'NEEDS IMPROVEMENT';

  const lines = [
    `## ${path.basename(analysis.path)}`,
    `**Rating: ${analysis.rating}/10** (minimum: ${minRating}) ${icon} ${status}`,
  ];

  if (analysis.violations.length > 0) {
    lines.push('', `### Violations (${analysis.violations.length})`);
    for (const v of analysis.violations) {
      const loc = v.line ? ` (line ${v.line})` : '';
      lines.push(`- **${v.severity.toUpperCase()}** [${v.type}]${loc}: ${v.message}`);
      const t = fixText(v.fix);
      if (t) lines.push(`  → Fix: ${t}`);
    }
  }

  lines.push('', '### Metrics',
    `- Lines of Code: ${analysis.metrics.linesOfCode}`,
    `- Cyclomatic Complexity: ${analysis.metrics.cyclomaticComplexity}`,
    `- Methods/Functions: ${analysis.metrics.numberOfMethods}`,
    `- Imports: ${analysis.metrics.importCount}`,
  );

  if (analysis.metrics.coveragePercent !== undefined) {
    lines.push(`- Test Coverage: ${analysis.metrics.coveragePercent.toFixed(1)}%`);
  }

  if (!passed) {
    lines.push('', '### Action Required',
      `Improve the code to reach the minimum rating of ${minRating}.`,
      'Fix errors first (−1.5 pts each), then warnings (−0.5 pts each), then info hints (−0.1 pts each).',
    );
  }

  return lines.join('\n');
}

/**
 * Formats an in-memory code analysis result as markdown.
 */
export function formatStringResult(result: StringAnalysisResult, minRating: number): string {
  const passed = result.rating >= minRating;
  const icon = passed ? '✅' : '❌';

  const lines = [
    `**Rating: ${result.rating}/10** (minimum: ${minRating}) ${icon} ${passed ? 'PASSED' : 'NEEDS IMPROVEMENT'}`,
  ];

  if (result.violations.length > 0) {
    lines.push('', `### Violations (${result.violations.length})`);
    for (const v of result.violations) {
      const loc = v.line ? ` (line ${v.line})` : '';
      lines.push(`- **${v.severity.toUpperCase()}** [${v.type}]${loc}: ${v.message}`);
      const t = fixText(v.fix);
      if (t) lines.push(`  → Fix: ${t}`);
    }
  }

  lines.push('', '### Metrics',
    `- Lines of Code: ${result.metrics.linesOfCode}`,
    `- Complexity: ${result.metrics.cyclomaticComplexity}`,
    `- Methods: ${result.metrics.numberOfMethods}`,
    `- Imports: ${result.metrics.importCount}`,
  );

  if (!passed) {
    lines.push('', '### Action Required',
      `Improve the code to reach ${minRating}/10. Errors cost −1.5, warnings −0.5, info −0.1.`,
    );
  }

  return lines.join('\n');
}
