import * as fs from 'fs';
import * as path from 'path';
import { UniversalAnalyzer } from '../../analyzer/universal-analyzer';
import { RefactoringAdvisor } from '../../analyzer/refactoring-advisor';
import { PatternDetector } from '../../analyzer/pattern-detector';
import { FileAnalysis, PatternReport } from '../../types';
import { CycleInfo } from '../../graph/dependency-graph';
import { fetchDaemonApi, findGitRoot, findSourceFiles } from '../helpers';
import { text, envelope, McpResponse } from './shared';

// ── Shared instances ───────────────────────────────────────

const fileAnalyzer = new UniversalAnalyzer();
const refactoringAdvisor = new RefactoringAdvisor();
const patternDetector = new PatternDetector();

// ── Handlers ───────────────────────────────────────────────

export async function handleSuggestRefactoring(args: Record<string, unknown>): Promise<McpResponse> {
  const filePath = String(args.file_path ?? '');
  if (!filePath) return text('Error: file_path is required.');
  if (!fs.existsSync(filePath)) return text(`Error: File not found: ${filePath}`);
  if (!fileAnalyzer.isSupportedFile(filePath)) {
    return text('Error: Unsupported file type. Supported: .ts, .tsx, .jsx, .js, .cs');
  }

  const analysis = await fileAnalyzer.analyze(filePath);
  if (!analysis) return text('Error: Analysis returned no results.');

  const repo = findGitRoot(path.dirname(filePath));
  const encodedRepo = encodeURIComponent(repo);
  const cyclesRaw = await fetchDaemonApi(`/api/cycles?repo=${encodedRepo}`);
  const cycles = (cyclesRaw ?? []) as CycleInfo[];

  const hints = refactoringAdvisor.suggest(analysis, cycles);

  if (hints.length === 0) {
    return envelope(
      'suggest_refactoring',
      { file: analysis, hints: [], rating: analysis.rating, totalPotentialGain: 0 },
      `## Refactoring Suggestions: ${path.basename(filePath)}\n\nNo refactoring hints — file looks clean!`,
    );
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

  const totalPotentialGain = Math.round(hints.reduce((s, h) => s + h.estimatedRatingGain, 0) * 10) / 10;
  return envelope(
    'suggest_refactoring',
    { file: analysis, hints, rating: analysis.rating, totalPotentialGain },
    lines.join('\n'),
  );
}

export async function handleViolationPatterns(args: Record<string, unknown>): Promise<McpResponse> {
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
    return envelope(
      'get_violation_patterns',
      { repo, patterns: [], totalGain: 0, fixOrder: [] },
      '## Violation Patterns\n\nNo violations found across the codebase. Everything looks clean!',
    );
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

  // Aggregate files across all patterns to give the queue a single fix order.
  const fileSet = new Set<string>();
  for (const r of reports) for (const f of r.affectedFiles) fileSet.add(f);
  const fixOrder = [...fileSet];

  return envelope(
    'get_violation_patterns',
    { repo, patterns: reports, totalGain, fixOrder },
    lines.join('\n'),
  );
}
