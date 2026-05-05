/**
 * MCP Tool Handlers
 *
 * Handles all MCP tool calls for code quality analysis.
 */

import * as fs from 'fs';
import * as path from 'path';
import { UniversalAnalyzer } from '../analyzer/universal-analyzer';
import { StringAnalyzer } from '../analyzer/string-analyzer';
import { RefactoringAdvisor } from '../analyzer/refactoring-advisor';
import { PatternDetector } from '../analyzer/pattern-detector';
import { CycleInfo } from '../graph/dependency-graph';
import { FileAnalysis, RefactoringHint, PatternReport } from '../types';
import { fetchDaemonApi, findGitRoot, findSourceFiles, formatAnalysisResult, formatStringResult, getMinRating } from './helpers';

// ── Shared instances ───────────────────────────────────────

const fileAnalyzer = new UniversalAnalyzer();
const stringAnalyzer = new StringAnalyzer();
const refactoringAdvisor = new RefactoringAdvisor();
const patternDetector = new PatternDetector();

// ── Types ──────────────────────────────────────────────────

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

interface FileDetailResponse {
  analysis?: FileAnalysis;
  ratingBreakdown?: Array<{ category: string; deduction: number; detail: string }>;
  gitDiff?: { added: number; removed: number } | null;
}

// ── Tool Handler Functions ─────────────────────────────────

export async function handleAnalyzeFile(args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
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

export async function handleAnalyzeCode(args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
  const code = String(args.code ?? '');
  const language = String(args.language ?? '');
  if (!code) return text('Error: code is required.');
  if (!['typescript', 'tsx', 'jsx', 'csharp'].includes(language)) {
    return text('Error: language must be one of: typescript, tsx, jsx, csharp');
  }

  const result = stringAnalyzer.analyze(code, language as 'typescript' | 'tsx' | 'jsx' | 'csharp');
  const minRating = getMinRating();
  return text(formatStringResult(result, minRating));
}

export async function handleCodebaseHealth(args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
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

  const sorted = [...analyses].sort((a, b) => a.rating - b.rating);

  const violationCounts = new Map<string, number>();
  for (const a of analyses) {
    for (const v of a.violations) {
      violationCounts.set(v.type, (violationCounts.get(v.type) ?? 0) + 1);
    }
  }
  const topViolations = [...violationCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

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

export async function handleQualityRules(): Promise<{ content: Array<{ type: string; text: string }> }> {
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

export async function handleFileContext(args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
  const filePath = String(args.file_path ?? '');
  if (!filePath) return text('Error: file_path is required.');

  const repo = String(args.repo ?? findGitRoot(path.dirname(filePath)));
  const encodedFile = encodeURIComponent(filePath);
  const encodedRepo = encodeURIComponent(repo);

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
  const detail = detailRaw as FileDetailResponse | null;
  const allCycles = (cyclesRaw ?? []) as Array<{ nodes: string[] }>;
  const trends = (trendsRaw ?? []) as Array<{ rating: number; recorded_at: string }>;

  const lines: string[] = [];

  const node = graph.nodes.find(n => n.id === filePath);
  if (!node && !detail) {
    return text(`File not found in the dependency graph. Run a scan first or analyze the file with \`analyze_file\`.`);
  }

  const rating = node?.rating ?? detail?.analysis?.rating ?? 0;
  lines.push(`## File Context: ${path.basename(filePath)}`);
  lines.push(`**Path:** ${filePath}`);
  lines.push(`**Rating:** ${rating}/10`);
  lines.push('');

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

  if (detail?.ratingBreakdown && detail.ratingBreakdown.length > 0) {
    lines.push('### Rating Breakdown');
    lines.push('Starting at 10.0:');
    for (const item of detail.ratingBreakdown) {
      lines.push(`- ${item.category}: −${item.deduction.toFixed(1)} (${item.detail})`);
    }
    lines.push(`**Final: ${rating}/10**`);
    lines.push('');
  }

  if (trends.length > 1) {
    lines.push('### Rating Trend (last ' + trends.length + ' analyses)');
    const oldest = trends[trends.length - 1];
    const newest = trends[0];
    const delta = newest.rating - oldest.rating;
    const arrow = delta > 0 ? '📈 improving' : delta < 0 ? '📉 declining' : '→ stable';
    lines.push(`${oldest.rating} → ${newest.rating} (${arrow})`);
    lines.push('');
  }

  if (detail?.gitDiff) {
    lines.push('### Uncommitted Changes');
    lines.push(`+${detail.gitDiff.added} lines added, −${detail.gitDiff.removed} lines removed`);
    lines.push('');
  }

  return text(lines.join('\n'));
}

export async function handleDependencyGraph(args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
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

  const excellent = graph.nodes.filter(n => n.rating >= 8).length;
  const good = graph.nodes.filter(n => n.rating >= 6 && n.rating < 8).length;
  const poor = graph.nodes.filter(n => n.rating < 6).length;
  lines.push('### Rating Distribution');
  lines.push(`- Excellent (≥8): ${excellent} files`);
  lines.push(`- Needs work (6–7.9): ${good} files`);
  lines.push(`- Poor (<6): ${poor} files`);
  lines.push('');

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

  const worstNodes = [...graph.nodes].sort((a, b) => a.rating - b.rating).slice(0, 10);
  if (worstNodes.length > 0 && worstNodes[0].rating < 8) {
    lines.push('### Worst-Rated Files');
    for (const node of worstNodes) {
      if (node.rating >= 8) break;
      lines.push(`- **${node.rating}/10** — ${path.relative(repo, node.id)} (${node.violations.length} violations, ${node.metrics.linesOfCode} LOC)`);
    }
    lines.push('');
  }

  if (cycles.length > 0) {
    lines.push(`### Circular Dependencies (${cycles.length} cycles — each costs −1.0 rating)`);
    for (const cycle of cycles.slice(0, 10)) {
      const chain = cycle.nodes.map(n => path.basename(n)).join(' → ');
      lines.push(`- ${chain} → ${path.basename(cycle.nodes[0])}`);
    }
    if (cycles.length > 10) lines.push(`... and ${cycles.length - 10} more cycles`);
    lines.push('');
  }

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

export async function handleImpactAnalysis(args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
  const filePath = String(args.file_path ?? '');
  if (!filePath) return text('Error: file_path is required.');

  const repo = String(args.repo ?? findGitRoot(path.dirname(filePath)));
  const encodedRepo = encodeURIComponent(repo);

  const graphRaw = await fetchDaemonApi(`/api/graph?repo=${encodedRepo}`);
  if (!graphRaw) {
    return text('Error: Gate Keeper daemon is not running. Start it with `npm run daemon` or `npm run dev`.');
  }

  const graph = graphRaw as GraphResponse;

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

export async function handleSuggestRefactoring(args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
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

export async function handlePredictImpactWithRemediation(args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
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

export async function handleViolationPatterns(args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
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

// ── Response Helper ───────────────────────────────────────

export function text(content: string): { content: Array<{ type: string; text: string }> } {
  return { content: [{ type: 'text', text: content }] };
}

// ── Tool Router ───────────────────────────────────────────

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
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
