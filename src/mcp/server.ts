/**
 * Gate Keeper — MCP Server
 *
 * Exposes code-quality analysis as MCP tools that AI agents (GitHub Copilot,
 * Claude, etc.) call after file edits. The agent sees the rating, violations,
 * and codebase health, then self-corrects until quality reaches the threshold.
 *
 * Protocol: JSON-RPC 2.0 over stdio (MCP standard transport).
 *
 * Run: npx tsx src/mcp/server.ts
 *      node dist/mcp/server.js
 */

import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { spawnSync } from 'child_process';
import { UniversalAnalyzer } from '../analyzer/universal-analyzer';
import { StringAnalyzer, StringAnalysisResult } from '../analyzer/string-analyzer';
import { RatingCalculator, RatingBreakdownItem } from '../rating/rating-calculator';
import { RefactoringAdvisor } from '../analyzer/refactoring-advisor';
import { PatternDetector } from '../analyzer/pattern-detector';
import { CycleInfo } from '../graph/dependency-graph';
import { FileAnalysis, Language, RefactoringHint, PatternReport } from '../types';

// ── Configuration ──────────────────────────────────────────

const GK_DIR = path.join(process.env.HOME ?? '/tmp', '.gate-keeper');
const CONFIG_FILE = path.join(GK_DIR, 'config.json');
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'bin', 'obj', 'build', '.next',
  'coverage', '.cache', '.turbo', 'out', 'target',
]);

// ── Shared instances ───────────────────────────────────────

const fileAnalyzer = new UniversalAnalyzer();
const stringAnalyzer = new StringAnalyzer();
const ratingCalc = new RatingCalculator();
const refactoringAdvisor = new RefactoringAdvisor();
const patternDetector = new PatternDetector();

// ── Helpers ────────────────────────────────────────────────

function getMinRating(): number {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return config.minRating ?? 7.0;
  } catch {
    return 7.0;
  }
}

const DAEMON_PORT = 5378;

/** Fetch JSON from the Gate Keeper daemon HTTP API. Returns null if daemon is unreachable. */
function fetchDaemonApi(urlPath: string): Promise<unknown> {
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

function findGitRoot(dir: string): string {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: dir, encoding: 'utf8', timeout: 3000,
  });
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : dir;
}

function findSourceFiles(dir: string, maxFiles: number): string[] {
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

function formatAnalysisResult(analysis: FileAnalysis, minRating: number): string {
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
      if (v.fix) lines.push(`  → Fix: ${v.fix}`);
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

function formatStringResult(result: StringAnalysisResult, minRating: number): string {
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
      if (v.fix) lines.push(`  → Fix: ${v.fix}`);
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

// ── Tool definitions ───────────────────────────────────────

const TOOLS = [
  {
    name: 'analyze_file',
    description:
      'Analyze a source file on disk for code quality. Returns a rating (0–10), violations, and metrics. ' +
      'Call this after editing a file to verify quality. If the rating is below the threshold, fix the violations and re-analyze.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path to the source file to analyze (.ts, .tsx, .jsx, .js, .cs)',
        },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'analyze_code',
    description:
      'Analyze a code snippet in-memory (no file on disk needed). ' +
      'Useful for checking code quality before writing it to a file.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        code: { type: 'string', description: 'The source code to analyze' },
        language: {
          type: 'string',
          enum: ['typescript', 'tsx', 'jsx', 'csharp'],
          description: 'Programming language of the code',
        },
      },
      required: ['code', 'language'],
    },
  },
  {
    name: 'get_codebase_health',
    description:
      'Scan a directory and return overall codebase quality: average rating, file count, ' +
      'worst-rated files, and common violation types. Defaults to the current git repository root.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        directory: {
          type: 'string',
          description: 'Absolute path to the directory to scan (defaults to git root or cwd)',
        },
        max_files: {
          type: 'number',
          description: 'Maximum files to analyze (default 200)',
        },
      },
    },
  },
  {
    name: 'get_quality_rules',
    description:
      'Return the quality rules, thresholds, and scoring deductions Gate Keeper enforces. ' +
      'Read this first so you understand what to avoid when writing code.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'get_file_context',
    description:
      'Get rich context for a file: its dependencies (imports), reverse dependencies (files that import it), ' +
      'circular dependency cycles it participates in, rating trend over time, and a detailed rating breakdown. ' +
      'Use this after analyze_file to understand a file\'s role in the codebase and the impact of changes.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path to the source file',
        },
        repo: {
          type: 'string',
          description: 'Repository root path (defaults to git root of file_path)',
        },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'get_dependency_graph',
    description:
      'Return the dependency graph for the repository: all analyzed files as nodes (with ratings, metrics, violations) ' +
      'and edges (import/inheritance relationships). Use this to understand the architecture, find tightly coupled modules, ' +
      'and identify structural issues before making changes.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        repo: {
          type: 'string',
          description: 'Repository root path (defaults to git root of cwd)',
        },
      },
    },
  },
  {
    name: 'get_impact_analysis',
    description:
      'Analyze the impact radius of a file change: find all files that directly or transitively depend on the given file. ' +
      'Use this before editing a widely-imported module to understand which files may be affected.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path to the file being changed',
        },
        repo: {
          type: 'string',
          description: 'Repository root path (defaults to git root of file_path)',
        },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'suggest_refactoring',
    description:
      'Analyze a file and return a ranked list of concrete refactoring hints: ' +
      'pattern name, rationale, step-by-step instructions, and estimated rating gain. ' +
      'Use this when a file has violations to understand the highest-impact improvements.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path to the source file to analyze (.ts, .tsx, .jsx, .js, .cs)',
        },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'predict_impact_with_remediation',
    description:
      'Find all files that transitively depend on the given file (blast radius), ' +
      'then for each at-risk dependent (rating < 6) provide targeted fix instructions. ' +
      'Use this before changing a widely-imported module.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path to the file being changed',
        },
        repo: {
          type: 'string',
          description: 'Repository root path (defaults to git root of file_path)',
        },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'get_violation_patterns',
    description:
      'Return a ranked table of violation patterns across the entire codebase: ' +
      'which violation types appear most, how many files they affect, ' +
      'the total estimated rating gain if fixed, and a module-wide fix suggestion. ' +
      'Use this to plan a codebase cleanup sprint.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        repo: {
          type: 'string',
          description: 'Repository root path (defaults to git root of cwd)',
        },
      },
    },
  },
];

// ── Tool handlers ──────────────────────────────────────────

async function handleToolCall(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
  switch (name) {
    case 'analyze_file':
      return handleAnalyzeFile(args);
    case 'analyze_code':
      return handleAnalyzeCode(args);
    case 'get_codebase_health':
      return handleCodebaseHealth(args);
    case 'get_quality_rules':
      return handleQualityRules();
    case 'get_file_context':
      return handleFileContext(args);
    case 'get_dependency_graph':
      return handleDependencyGraph(args);
    case 'get_impact_analysis':
      return handleImpactAnalysis(args);
    case 'suggest_refactoring':
      return handleSuggestRefactoring(args);
    case 'predict_impact_with_remediation':
      return handlePredictImpactWithRemediation(args);
    case 'get_violation_patterns':
      return handleViolationPatterns(args);
    default:
      return text(`Unknown tool: ${name}`);
  }
}

function text(content: string) {
  return { content: [{ type: 'text', text: content }] };
}

async function handleAnalyzeFile(args: Record<string, unknown>) {
  const filePath = String(args.file_path ?? '');
  if (!filePath) return text('Error: file_path is required.');
  if (!fs.existsSync(filePath)) return text(`Error: File not found: ${filePath}`);
  if (!fileAnalyzer.isSupportedFile(filePath)) {
    return text(`Error: Unsupported file type. Supported: .ts, .tsx, .jsx, .js, .cs`);
  }

  const analysis = await fileAnalyzer.analyze(filePath);
  if (!analysis) return text('Error: Analysis returned no results.');

  const minRating = getMinRating();
  return text(formatAnalysisResult(analysis, minRating));
}

async function handleAnalyzeCode(args: Record<string, unknown>) {
  const code = String(args.code ?? '');
  const language = String(args.language ?? '') as Language;
  if (!code) return text('Error: code is required.');
  if (!['typescript', 'tsx', 'jsx', 'csharp'].includes(language)) {
    return text('Error: language must be one of: typescript, tsx, jsx, csharp');
  }

  const result = stringAnalyzer.analyze(code, language);
  const minRating = getMinRating();
  return text(formatStringResult(result, minRating));
}

async function handleCodebaseHealth(args: Record<string, unknown>) {
  const maxFiles = Number(args.max_files) || 200;
  const dir = String(args.directory || findGitRoot(process.cwd()));

  if (!fs.existsSync(dir)) return text(`Error: Directory not found: ${dir}`);

  const files = findSourceFiles(dir, maxFiles);
  if (files.length === 0) return text('No supported source files found in the directory.');

  const analyses: FileAnalysis[] = [];
  for (const f of files) {
    const a = await fileAnalyzer.analyze(f);
    if (a) analyses.push(a);
  }

  const minRating = getMinRating();
  const totalRating = analyses.reduce((s, a) => s + a.rating, 0);
  const avgRating = Math.round((totalRating / analyses.length) * 10) / 10;
  const passed = avgRating >= minRating;

  // Sort by rating ascending (worst first)
  const sorted = [...analyses].sort((a, b) => a.rating - b.rating);

  // Violation counts by type
  const violationCounts = new Map<string, number>();
  for (const a of analyses) {
    for (const v of a.violations) {
      violationCounts.set(v.type, (violationCounts.get(v.type) ?? 0) + 1);
    }
  }
  const topViolations = [...violationCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // Rating distribution
  const excellent = analyses.filter(a => a.rating >= 8).length;
  const good = analyses.filter(a => a.rating >= 6 && a.rating < 8).length;
  const poor = analyses.filter(a => a.rating < 6).length;

  const lines = [
    `## Codebase Health Report`,
    `**Overall Rating: ${avgRating}/10** (${analyses.length} files) ${passed ? '✅' : '⚠️'}`,
    '',
    '### Rating Distribution',
    `- 🟢 Excellent (≥8.0): ${excellent} files`,
    `- 🟡 Needs work (6.0–7.9): ${good} files`,
    `- 🔴 Poor (<6.0): ${poor} files`,
  ];

  if (sorted.length > 0 && sorted[0].rating < minRating) {
    lines.push('', '### Worst Files');
    for (const a of sorted.slice(0, 10)) {
      if (a.rating >= minRating) break;
      const relPath = path.relative(dir, a.path);
      lines.push(`- **${a.rating}/10** — ${relPath} (${a.violations.length} violations)`);
    }
  }

  if (topViolations.length > 0) {
    lines.push('', '### Most Common Violations');
    for (const [type, count] of topViolations) {
      lines.push(`- ${type}: ${count} occurrences`);
    }
  }

  return text(lines.join('\n'));
}

async function handleQualityRules() {
  const minRating = getMinRating();
  const rules = [
    '## Gate Keeper Quality Rules',
    '',
    `**Minimum acceptable rating: ${minRating}/10**`,
    '',
    '### Scoring',
    'Every file starts at 10.0. Deductions:',
    '- **Error** violations: −1.5 each (e.g., missing key prop, empty catch)',
    '- **Warning** violations: −0.5 each (e.g., `any` usage, god class, long method)',
    '- **Info** violations: −0.1 each (e.g., console.log)',
    '- Cyclomatic complexity >20: −2.0',
    '- Cyclomatic complexity >10: −1.0',
    '- Import count >30: −2.0',
    '- Import count >15: −0.5',
    '- Lines of code >500: −1.5',
    '- Lines of code >300: −0.5',
    '- Test coverage <50%: −1.0 (+ warning violation −0.5)',
    '- Test coverage 50–80%: −0.5 (+ info violation −0.1)',
    '- No test coverage data for file: warning violation −0.5',
    '',
    '### TypeScript / JavaScript Rules',
    '- **any_usage** (warning): Do not use `any`. Use specific types or `unknown`.',
    '- **console_log** (info): Remove console.log/warn/error from production code.',
    '- **hook_overload** (warning): React components should not have >7 hooks.',
    '- **duplicate_hooks** (warning): Do not call the same hook multiple times.',
    '- **missing_key** (error): Always add `key` prop in `.map()` JSX.',
    '- **inline_handler** (warning): Extract inline JSX event handlers to named functions.',
    '',
    '### Test Coverage Rules',
    '- **no_test_coverage** (warning): File has no unit test coverage in the coverage report.',
    '- **low_test_coverage** (warning): Test coverage below 50% — add more tests.',
    '- **moderate_test_coverage** (info): Test coverage between 50–80% — consider improving.',
    '- **uncovered_lines** (info): Lists specific lines not covered by tests.',
    '',
    '### C# / .NET Rules',
    '- **god_class** (warning): Classes with >20 methods should be split.',
    '- **long_method** (warning): Methods longer than 50 lines should be refactored.',
    '- **tight_coupling** (warning): Constructors/methods with >5 parameters need a parameter object.',
    '- **empty_catch** (error): Never swallow exceptions with empty catch blocks.',
    '',
    '### Best Practices for Passing',
    '1. Use specific types — never `any`.',
    '2. Add `key` props to all list-rendered JSX elements.',
    '3. Keep functions/methods under 50 lines.',
    '4. Keep files under 300 lines (ideally under 200).',
    '5. Limit parameters to 5 or fewer.',
    '6. Always handle errors in catch blocks.',
    '7. Remove console.log before committing.',
    '8. Run tests with coverage (`--coverage`) to generate lcov.info for coverage analysis.',
    '9. Aim for 80%+ test coverage on all source files.',
  ];

  return text(rules.join('\n'));
}

// ── Graph-context tool handlers ────────────────────────────

interface GraphNodeData {
  id: string;
  label: string;
  type: string;
  rating: number;
  size: number;
  violations: Array<{ type: string; severity: string; message: string; line?: number; fix?: string }>;
  metrics: { linesOfCode: number; cyclomaticComplexity: number; numberOfMethods: number; numberOfClasses: number; importCount: number; coveragePercent?: number };
}

interface GraphEdgeData {
  source: string;
  target: string;
  type: string;
  strength: number;
}

interface GraphResponse {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
}

async function handleFileContext(args: Record<string, unknown>) {
  const filePath = String(args.file_path ?? '');
  if (!filePath) return text('Error: file_path is required.');

  const repo = String(args.repo ?? findGitRoot(path.dirname(filePath)));
  const encodedFile = encodeURIComponent(filePath);
  const encodedRepo = encodeURIComponent(repo);

  // Fetch graph, file detail, cycles, and trends in parallel from the daemon
  const [graphRaw, detailRaw, cyclesRaw, trendsRaw] = await Promise.all([
    fetchDaemonApi(`/api/graph?repo=${encodedRepo}`),
    fetchDaemonApi(`/api/file-detail?file=${encodedFile}&repo=${encodedRepo}`),
    fetchDaemonApi(`/api/cycles?repo=${encodedRepo}`),
    fetchDaemonApi(`/api/trends?file=${encodedFile}&repo=${encodedRepo}`),
  ]);

  if (!graphRaw) {
    return text('Error: Gate Keeper daemon is not running. Start it with `npm run daemon` or `npm run dev`.');
  }

  const graph = graphRaw as GraphResponse;
  const detail = detailRaw as { analysis?: FileAnalysis; ratingBreakdown?: RatingBreakdownItem[]; gitDiff?: { added: number; removed: number } | null } | null;
  const allCycles = (cyclesRaw ?? []) as Array<{ nodes: string[] }>;
  const trends = (trendsRaw ?? []) as Array<{ rating: number; recorded_at: string }>;

  const lines: string[] = [];

  // Header
  const node = graph.nodes.find(n => n.id === filePath);
  if (!node && !detail) {
    return text(`File not found in the dependency graph. Run a scan first or analyze the file with \`analyze_file\`.`);
  }

  const rating = node?.rating ?? detail?.analysis?.rating ?? 0;
  lines.push(`## File Context: ${path.basename(filePath)}`);
  lines.push(`**Path:** ${filePath}`);
  lines.push(`**Rating:** ${rating}/10`);
  lines.push('');

  // Dependencies (files this file imports)
  const imports = graph.edges.filter(e => e.source === filePath);
  if (imports.length > 0) {
    lines.push(`### Dependencies (${imports.length} files imported)`);
    for (const edge of imports) {
      const targetNode = graph.nodes.find(n => n.id === edge.target);
      const targetRating = targetNode ? ` (rating: ${targetNode.rating})` : '';
      lines.push(`- ${path.relative(repo, edge.target)}${targetRating} [${edge.type}]`);
    }
    lines.push('');
  }

  // Reverse dependencies (files that depend on this file)
  const dependents = graph.edges.filter(e => e.target === filePath);
  if (dependents.length > 0) {
    lines.push(`### Used By (${dependents.length} files depend on this)`);
    for (const edge of dependents) {
      const sourceNode = graph.nodes.find(n => n.id === edge.source);
      const sourceRating = sourceNode ? ` (rating: ${sourceNode.rating})` : '';
      lines.push(`- ${path.relative(repo, edge.source)}${sourceRating}`);
    }
    lines.push('');
  }

  // Circular dependencies
  const fileCycles = allCycles.filter(c => c.nodes.includes(filePath));
  if (fileCycles.length > 0) {
    lines.push(`### ⚠️ Circular Dependencies (${fileCycles.length} cycles)`);
    for (const cycle of fileCycles) {
      const chain = cycle.nodes.map(n => path.basename(n)).join(' → ');
      lines.push(`- ${chain} → ${path.basename(cycle.nodes[0])}`);
    }
    lines.push('Each cycle costs −1.0 rating. Break cycles by extracting shared types or using dependency inversion.');
    lines.push('');
  }

  // Rating breakdown
  if (detail?.ratingBreakdown && detail.ratingBreakdown.length > 0) {
    lines.push('### Rating Breakdown');
    lines.push('Starting at 10.0:');
    for (const item of detail.ratingBreakdown) {
      lines.push(`- ${item.category}: −${item.deduction.toFixed(1)} (${item.detail})`);
    }
    lines.push(`**Final: ${rating}/10**`);
    lines.push('');
  }

  // Rating trend
  if (trends.length > 1) {
    lines.push('### Rating Trend (last ' + trends.length + ' analyses)');
    const oldest = trends[trends.length - 1];
    const newest = trends[0];
    const delta = newest.rating - oldest.rating;
    const arrow = delta > 0 ? '📈 improving' : delta < 0 ? '📉 declining' : '→ stable';
    lines.push(`${oldest.rating} → ${newest.rating} (${arrow})`);
    lines.push('');
  }

  // Git diff
  if (detail?.gitDiff) {
    lines.push('### Uncommitted Changes');
    lines.push(`+${detail.gitDiff.added} lines added, −${detail.gitDiff.removed} lines removed`);
    lines.push('');
  }

  return text(lines.join('\n'));
}

async function handleDependencyGraph(args: Record<string, unknown>) {
  const repo = String(args.repo ?? findGitRoot(process.cwd()));
  const encodedRepo = encodeURIComponent(repo);

  const [graphRaw, cyclesRaw, statusRaw] = await Promise.all([
    fetchDaemonApi(`/api/graph?repo=${encodedRepo}`),
    fetchDaemonApi(`/api/cycles?repo=${encodedRepo}`),
    fetchDaemonApi(`/api/status?repo=${encodedRepo}`),
  ]);

  if (!graphRaw) {
    return text('Error: Gate Keeper daemon is not running. Start it with `npm run daemon` or `npm run dev`.');
  }

  const graph = graphRaw as GraphResponse;
  const cycles = (cyclesRaw ?? []) as Array<{ nodes: string[] }>;
  const status = statusRaw as { overallRating?: number } | null;

  const lines: string[] = [];
  lines.push('## Dependency Graph');
  lines.push(`**Repository:** ${repo}`);
  lines.push(`**Files:** ${graph.nodes.length} | **Edges:** ${graph.edges.length} | **Overall Rating:** ${status?.overallRating ?? 'N/A'}/10`);
  lines.push('');

  // Rating distribution
  const excellent = graph.nodes.filter(n => n.rating >= 8).length;
  const good = graph.nodes.filter(n => n.rating >= 6 && n.rating < 8).length;
  const poor = graph.nodes.filter(n => n.rating < 6).length;
  lines.push('### Rating Distribution');
  lines.push(`- Excellent (≥8): ${excellent} files`);
  lines.push(`- Needs work (6–7.9): ${good} files`);
  lines.push(`- Poor (<6): ${poor} files`);
  lines.push('');

  // Most connected nodes (coupling hotspots)
  const connectionCount = new Map<string, number>();
  for (const edge of graph.edges) {
    connectionCount.set(edge.source, (connectionCount.get(edge.source) ?? 0) + 1);
    connectionCount.set(edge.target, (connectionCount.get(edge.target) ?? 0) + 1);
  }
  const mostConnected = [...connectionCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  if (mostConnected.length > 0) {
    lines.push('### Most Connected Files (coupling hotspots)');
    for (const [filePath, count] of mostConnected) {
      const node = graph.nodes.find(n => n.id === filePath);
      const ratingStr = node ? ` (rating: ${node.rating})` : '';
      lines.push(`- **${count} connections** — ${path.relative(repo, filePath)}${ratingStr}`);
    }
    lines.push('');
  }

  // Worst-rated files
  const worstNodes = [...graph.nodes].sort((a, b) => a.rating - b.rating).slice(0, 10);
  if (worstNodes.length > 0 && worstNodes[0].rating < 8) {
    lines.push('### Worst-Rated Files');
    for (const node of worstNodes) {
      if (node.rating >= 8) break;
      lines.push(`- **${node.rating}/10** — ${path.relative(repo, node.id)} (${node.violations.length} violations, ${node.metrics.linesOfCode} LOC)`);
    }
    lines.push('');
  }

  // Circular dependencies
  if (cycles.length > 0) {
    lines.push(`### Circular Dependencies (${cycles.length} cycles — each costs −1.0 rating)`);
    for (const cycle of cycles.slice(0, 10)) {
      const chain = cycle.nodes.map(n => path.basename(n)).join(' → ');
      lines.push(`- ${chain} → ${path.basename(cycle.nodes[0])}`);
    }
    if (cycles.length > 10) lines.push(`... and ${cycles.length - 10} more cycles`);
    lines.push('');
  }

  // Complexity hotspots
  const complexFiles = [...graph.nodes]
    .filter(n => n.metrics.cyclomaticComplexity > 10)
    .sort((a, b) => b.metrics.cyclomaticComplexity - a.metrics.cyclomaticComplexity)
    .slice(0, 5);
  if (complexFiles.length > 0) {
    lines.push('### Complexity Hotspots');
    for (const node of complexFiles) {
      lines.push(`- **Complexity ${node.metrics.cyclomaticComplexity}** — ${path.relative(repo, node.id)} (${node.metrics.linesOfCode} LOC)`);
    }
    lines.push('');
  }

  return text(lines.join('\n'));
}

async function handleImpactAnalysis(args: Record<string, unknown>) {
  const filePath = String(args.file_path ?? '');
  if (!filePath) return text('Error: file_path is required.');

  const repo = String(args.repo ?? findGitRoot(path.dirname(filePath)));
  const encodedRepo = encodeURIComponent(repo);

  const graphRaw = await fetchDaemonApi(`/api/graph?repo=${encodedRepo}`);
  if (!graphRaw) {
    return text('Error: Gate Keeper daemon is not running. Start it with `npm run daemon` or `npm run dev`.');
  }

  const graph = graphRaw as GraphResponse;

  // Build reverse adjacency map (target → sources that import it)
  const reverseAdj = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const sources = reverseAdj.get(edge.target) ?? [];
    sources.push(edge.source);
    reverseAdj.set(edge.target, sources);
  }

  // BFS to find all transitive dependents
  const directDeps = new Set(reverseAdj.get(filePath) ?? []);
  const allDeps = new Set<string>();
  const queue = [...directDeps];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (allDeps.has(current)) continue;
    allDeps.add(current);
    for (const next of reverseAdj.get(current) ?? []) {
      if (!allDeps.has(next)) queue.push(next);
    }
  }

  const lines: string[] = [];
  lines.push(`## Impact Analysis: ${path.basename(filePath)}`);
  lines.push(`**Path:** ${filePath}`);
  lines.push(`**Direct dependents:** ${directDeps.size} | **Total affected (transitive):** ${allDeps.size}`);
  lines.push('');

  if (directDeps.size > 0) {
    lines.push('### Direct Dependents');
    for (const dep of directDeps) {
      const node = graph.nodes.find(n => n.id === dep);
      const ratingStr = node ? ` (rating: ${node.rating}, ${node.violations.length} violations)` : '';
      lines.push(`- ${path.relative(repo, dep)}${ratingStr}`);
    }
    lines.push('');
  }

  const transitiveDeps = [...allDeps].filter(d => !directDeps.has(d));
  if (transitiveDeps.length > 0) {
    lines.push('### Transitive Dependents');
    for (const dep of transitiveDeps.slice(0, 20)) {
      const node = graph.nodes.find(n => n.id === dep);
      const ratingStr = node ? ` (rating: ${node.rating})` : '';
      lines.push(`- ${path.relative(repo, dep)}${ratingStr}`);
    }
    if (transitiveDeps.length > 20) lines.push(`... and ${transitiveDeps.length - 20} more`);
    lines.push('');
  }

  // Risk assessment
  const affectedNodes = graph.nodes.filter(n => allDeps.has(n.id));
  const lowRated = affectedNodes.filter(n => n.rating < 6);
  if (lowRated.length > 0) {
    lines.push('### ⚠️ At-Risk Dependents (rating < 6)');
    lines.push('These files already have quality issues and may be fragile to upstream changes:');
    for (const node of lowRated.sort((a, b) => a.rating - b.rating)) {
      lines.push(`- **${node.rating}/10** — ${path.relative(repo, node.id)} (${node.violations.length} violations)`);
    }
    lines.push('');
  }

  if (allDeps.size === 0) {
    lines.push('No other files depend on this file. Changes here have no downstream impact.');
  }

  return text(lines.join('\n'));
}

async function handleSuggestRefactoring(args: Record<string, unknown>) {
  const filePath = String(args.file_path ?? '');
  if (!filePath) return text('Error: file_path is required.');
  if (!fs.existsSync(filePath)) return text(`Error: File not found: ${filePath}`);
  if (!fileAnalyzer.isSupportedFile(filePath)) {
    return text(`Error: Unsupported file type. Supported: .ts, .tsx, .jsx, .js, .cs`);
  }

  const analysis = await fileAnalyzer.analyze(filePath);
  if (!analysis) return text('Error: Analysis returned no results.');

  const repo = findGitRoot(path.dirname(filePath));
  const encodedRepo = encodeURIComponent(repo);
  const cyclesRaw = await fetchDaemonApi(`/api/cycles?repo=${encodedRepo}`);
  const cycles = (cyclesRaw ?? []) as CycleInfo[];

  const hints = refactoringAdvisor.suggest(analysis, cycles);

  if (hints.length === 0) {
    return text(`## Refactoring Suggestions: ${path.basename(filePath)}\n\nNo refactoring hints — file looks clean!`);
  }

  const lines = [
    `## Refactoring Suggestions: ${path.basename(filePath)}`,
    `**Current Rating: ${analysis.rating}/10** | **${hints.length} hint(s) found**`,
    `**Total Potential Gain: +${Math.round(hints.reduce((s, h) => s + h.estimatedRatingGain, 0) * 10) / 10} pts**`,
    '',
  ];

  hints.forEach((hint, i) => {
    const priorityIcon = hint.priority === 'high' ? '🔴' : hint.priority === 'medium' ? '🟡' : '🟢';
    lines.push(`### ${i + 1}. ${hint.patternName} ${priorityIcon}`);
    lines.push(`**Pattern:** \`${hint.violationType}\` | **Estimated Gain:** +${hint.estimatedRatingGain} pts`);
    lines.push(`**Why:** ${hint.rationale}`);
    lines.push('**Steps:**');
    hint.steps.forEach((step, j) => lines.push(`${j + 1}. ${step}`));
    lines.push('');
  });

  return text(lines.join('\n'));
}

async function handlePredictImpactWithRemediation(args: Record<string, unknown>) {
  const filePath = String(args.file_path ?? '');
  if (!filePath) return text('Error: file_path is required.');

  const repo = String(args.repo ?? findGitRoot(path.dirname(filePath)));
  const encodedRepo = encodeURIComponent(repo);

  const [graphRaw, cyclesRaw] = await Promise.all([
    fetchDaemonApi(`/api/graph?repo=${encodedRepo}`),
    fetchDaemonApi(`/api/cycles?repo=${encodedRepo}`),
  ]);

  if (!graphRaw) {
    return text('Error: Gate Keeper daemon is not running. Start it with `npm run daemon` or `npm run dev`.');
  }

  const graph = graphRaw as GraphResponse;
  const cycles = (cyclesRaw ?? []) as CycleInfo[];

  // ── BFS (identical to handleImpactAnalysis) ──────────────
  const reverseAdj = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const sources = reverseAdj.get(edge.target) ?? [];
    sources.push(edge.source);
    reverseAdj.set(edge.target, sources);
  }

  const directDeps = new Set(reverseAdj.get(filePath) ?? []);
  const allDeps = new Set<string>();
  const queue = [...directDeps];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (allDeps.has(current)) continue;
    allDeps.add(current);
    for (const next of reverseAdj.get(current) ?? []) {
      if (!allDeps.has(next)) queue.push(next);
    }
  }

  const lines: string[] = [];
  lines.push(`## Impact + Remediation: ${path.basename(filePath)}`);
  lines.push(`**Path:** ${filePath}`);
  lines.push(`**Direct dependents:** ${directDeps.size} | **Total affected (transitive):** ${allDeps.size}`);
  lines.push('');

  if (directDeps.size > 0) {
    lines.push('### Direct Dependents');
    for (const dep of directDeps) {
      const node = graph.nodes.find(n => n.id === dep);
      const ratingStr = node ? ` (rating: ${node.rating}, ${node.violations.length} violations)` : '';
      lines.push(`- ${path.relative(repo, dep)}${ratingStr}`);
    }
    lines.push('');
  }

  const transitiveDeps = [...allDeps].filter(d => !directDeps.has(d));
  if (transitiveDeps.length > 0) {
    lines.push('### Transitive Dependents');
    for (const dep of transitiveDeps.slice(0, 20)) {
      const node = graph.nodes.find(n => n.id === dep);
      const ratingStr = node ? ` (rating: ${node.rating})` : '';
      lines.push(`- ${path.relative(repo, dep)}${ratingStr}`);
    }
    if (transitiveDeps.length > 20) lines.push(`... and ${transitiveDeps.length - 20} more`);
    lines.push('');
  }

  const affectedNodes = graph.nodes.filter(n => allDeps.has(n.id));
  const atRisk = affectedNodes.filter(n => n.rating < 6).sort((a, b) => a.rating - b.rating);

  if (atRisk.length > 0) {
    lines.push(`### Remediation Plan for At-Risk Dependents (${atRisk.length} files with rating < 6)`);
    lines.push('These files already have quality issues and need targeted fixes:');
    lines.push('');

    const remediationTargets = atRisk.slice(0, 5);
    for (const node of remediationTargets) {
      lines.push(`#### ${path.relative(repo, node.id)} — Rating: ${node.rating}/10`);

      let hints: RefactoringHint[] = [];
      if (fs.existsSync(node.id) && fileAnalyzer.isSupportedFile(node.id)) {
        const freshAnalysis = await fileAnalyzer.analyze(node.id);
        if (freshAnalysis) {
          hints = refactoringAdvisor.suggest(freshAnalysis, cycles);
        }
      }

      if (hints.length === 0) {
        lines.push(`- ${node.violations.length} violations detected. Re-analyze with \`analyze_file\` for specific hints.`);
      } else {
        lines.push(`**Top fix (${hints[0].patternName}):** ${hints[0].rationale}`);
        hints[0].steps.slice(0, 3).forEach((step, i) => lines.push(`${i + 1}. ${step}`));
        if (hints.length > 1) lines.push(`_(and ${hints.length - 1} more hints — use \`suggest_refactoring\` for full detail)_`);
      }
      lines.push('');
    }

    if (atRisk.length > 5) {
      lines.push(`... and ${atRisk.length - 5} more at-risk files. Use \`suggest_refactoring\` on each.`);
    }
  } else if (allDeps.size > 0) {
    lines.push('No at-risk dependents (all affected files have rating ≥ 6). Change appears safe.');
  }

  if (allDeps.size === 0) {
    lines.push('No other files depend on this file. Changes here have no downstream impact.');
  }

  return text(lines.join('\n'));
}

async function handleViolationPatterns(args: Record<string, unknown>) {
  const repo = String(args.repo ?? findGitRoot(process.cwd()));
  const encodedRepo = encodeURIComponent(repo);

  let reports: PatternReport[] | null = null;
  const daemonRaw = await fetchDaemonApi(`/api/patterns?repo=${encodedRepo}`);
  if (daemonRaw && Array.isArray(daemonRaw)) {
    reports = daemonRaw as PatternReport[];
  }

  if (!reports) {
    const files = findSourceFiles(repo, 200);
    const analyses: FileAnalysis[] = [];
    for (const f of files) {
      const a = await fileAnalyzer.analyze(f);
      if (a) analyses.push(a);
    }
    reports = patternDetector.detect(analyses);
  }

  if (reports.length === 0) {
    return text(`## Violation Patterns\n\nNo violations found across the codebase. Everything looks clean!`);
  }

  const totalGain = Math.round(reports.reduce((s, r) => s + r.estimatedRatingGain, 0) * 10) / 10;
  const lines = [
    `## Violation Patterns — ${path.basename(repo)}`,
    `**${reports.length} distinct violation types** across the codebase | **Total estimated gain if all fixed: +${totalGain} pts**`,
    '',
    '| Rank | Pattern | Severity | Files | Occurrences | Est. Gain |',
    '|------|---------|----------|-------|-------------|-----------|',
  ];

  reports.forEach((r, i) => {
    const sev = r.severity === 'error' ? '🔴 error' : r.severity === 'warning' ? '🟡 warning' : '🟢 info';
    lines.push(`| ${i + 1} | \`${r.violationType}\` | ${sev} | ${r.fileCount} | ${r.totalOccurrences} | +${r.estimatedRatingGain} |`);
  });

  lines.push('');
  lines.push('### Module-Wide Fix Suggestions (top 5 by impact)');
  for (const r of reports.slice(0, 5)) {
    lines.push(`**\`${r.violationType}\`** — ${r.moduleSuggestion}`);
    lines.push(`  Affects: ${r.affectedFiles.slice(0, 3).map(f => path.relative(repo, f)).join(', ')}${r.fileCount > 3 ? ` ... and ${r.fileCount - 3} more` : ''}`);
    lines.push('');
  }

  return text(lines.join('\n'));
}

// ── JSON-RPC / MCP protocol ───────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function send(response: JsonRpcResponse): void {
  const json = JSON.stringify(response);
  process.stdout.write(json + '\n');
}

function sendResult(id: number | string | null, result: unknown): void {
  send({ jsonrpc: '2.0', id, result });
}

function sendError(id: number | string | null, code: number, message: string): void {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handleMessage(msg: JsonRpcRequest): Promise<void> {
  const { id, method, params } = msg;

  switch (method) {
    case 'initialize':
      sendResult(id ?? null, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'gate-keeper', version: '1.0.0' },
      });
      break;

    case 'notifications/initialized':
      // No response needed for notifications
      break;

    case 'tools/list':
      sendResult(id ?? null, { tools: TOOLS });
      break;

    case 'tools/call': {
      const callParams = params as { name?: unknown; arguments?: Record<string, unknown> } | undefined;
      const toolName = String(callParams?.name ?? '');
      const toolArgs = (callParams?.arguments ?? {}) as Record<string, unknown>;
      try {
        const result = await handleToolCall(toolName, toolArgs);
        sendResult(id ?? null, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sendResult(id ?? null, {
          content: [{ type: 'text', text: `Error: ${message}` }],
          isError: true,
        });
      }
      break;
    }

    case 'ping':
      sendResult(id ?? null, {});
      break;

    default:
      // Ignore unknown notifications (no id), error on unknown requests (with id)
      if (id !== undefined) {
        sendError(id, -32601, `Method not found: ${method}`);
      }
      break;
  }
}

// ── Stdio transport (newline-delimited JSON) ──────────────

function startServer(): void {
  let buffer = '';

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;

    // Process all complete lines in the buffer
    let nlIndex: number;
    while ((nlIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.substring(0, nlIndex).trim();
      buffer = buffer.substring(nlIndex + 1);

      // Skip empty lines and Content-Length headers (some clients send them)
      if (!line || line.startsWith('Content-Length:')) continue;

      try {
        const msg = JSON.parse(line) as JsonRpcRequest;
        handleMessage(msg).catch(err => {
          process.stderr.write(`[gate-keeper] Handler error: ${err}\n`);
        });
      } catch {
        // Not valid JSON — skip
      }
    }
  });

  process.stdin.on('end', () => process.exit(0));

  process.stderr.write('[gate-keeper] MCP server started (stdio)\n');
}

startServer();
