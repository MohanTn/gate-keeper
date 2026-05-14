/**
 * PR review handler — risk-scores a set of changed files against the graph.
 *
 * Each changed file gets a traffic-light verdict:
 *   GREEN  — leaf node, no dependents, rating ≥ 7
 *   YELLOW — some dependents OR rating 5–7
 *   RED    — god node with fragile dependents OR rating < 5
 *
 * Returns an overall risk summary plus per-file breakdown.
 */

import * as path from 'path';
import { spawnSync } from 'child_process';
import { fetchDaemonApi, findGitRoot } from '../helpers';
import { GraphResponse } from './types';
import { text, envelope, McpResponse } from './shared';
import { buildReverseAdjacency, getImpactSet } from '../../graph/graph-algorithms';

export type FileVerdict = 'GREEN' | 'YELLOW' | 'RED';

export interface FileRisk {
  file: string;
  verdict: FileVerdict;
  rating: number | null;
  directDependents: number;
  fragileImpacted: number;
  reasons: string[];
}

export interface PRReviewResult {
  overallVerdict: FileVerdict;
  changedFiles: number;
  redFiles: number;
  yellowFiles: number;
  greenFiles: number;
  fileRisks: FileRisk[];
  recommendation: string;
}

function ratingMap(graph: GraphResponse): Map<string, number> {
  const m = new Map<string, number>();
  for (const n of graph.nodes) m.set(n.id, n.rating);
  return m;
}

export function assessFile(
  filePath: string,
  graph: GraphResponse,
  revAdj: Map<string, string[]>,
  ratings: Map<string, number>,
): FileRisk {
  const rating = ratings.get(filePath) ?? null;
  const impactSet = getImpactSet(filePath, revAdj, ratings, 2, 6);
  const directDependents = impactSet.filter(e => e.severity === 'direct').length;
  const fragileImpacted = impactSet.filter(e => e.fragile).length;

  const reasons: string[] = [];
  let verdict: FileVerdict = 'GREEN';

  if (rating !== null && rating < 5) {
    verdict = 'RED';
    reasons.push(`Low quality file (rating ${rating}/10)`);
  } else if (rating !== null && rating < 7) {
    verdict = 'YELLOW';
    reasons.push(`Below-threshold quality (rating ${rating}/10)`);
  }

  if (fragileImpacted >= 3) {
    verdict = 'RED';
    reasons.push(`${fragileImpacted} fragile dependents (rating<6) will be impacted`);
  } else if (fragileImpacted >= 1) {
    if (verdict !== 'RED') verdict = 'YELLOW';
    reasons.push(`${fragileImpacted} fragile dependent(s) may be impacted`);
  }

  if (directDependents >= 10) {
    verdict = 'RED';
    reasons.push(`God node — ${directDependents} direct dependents`);
  } else if (directDependents >= 3) {
    if (verdict !== 'RED') verdict = 'YELLOW';
    reasons.push(`${directDependents} direct dependents`);
  }

  if (reasons.length === 0) {
    reasons.push(rating !== null ? `Healthy file (rating ${rating}/10)` : 'Not yet analyzed');
  }

  return { file: filePath, verdict, rating, directDependents, fragileImpacted, reasons };
}

function getChangedFilesFromGit(repo: string): string[] {
  const result = spawnSync(
    'git',
    ['diff', '--name-only', 'HEAD~1', 'HEAD'],
    { cwd: repo, encoding: 'utf8', timeout: 5000 },
  );
  if (result.status !== 0) return [];
  return result.stdout
    .split('\n')
    .map(f => f.trim())
    .filter(f => f && /\.(ts|tsx|js|jsx|cs)$/.test(f))
    .map(f => path.join(repo, f));
}

export async function handlePRReview(args: Record<string, unknown>): Promise<McpResponse> {
  const repo = String(args.repo ?? findGitRoot(process.cwd()));
  const encodedRepo = encodeURIComponent(repo);

  // Resolve file list — explicit input takes precedence, fallback to git diff
  let changedFiles: string[];
  if (Array.isArray(args.changed_files) && args.changed_files.length > 0) {
    changedFiles = (args.changed_files as unknown[]).map(f => {
      const s = String(f);
      return path.isAbsolute(s) ? s : path.join(repo, s);
    });
  } else {
    changedFiles = getChangedFilesFromGit(repo);
  }

  if (changedFiles.length === 0) {
    return text('No changed source files found. Pass changed_files[] or ensure HEAD~1 exists.');
  }

  const graphRaw = await fetchDaemonApi(`/api/graph?repo=${encodedRepo}`);
  if (!graphRaw) {
    return text('Error: Gate Keeper daemon is not running. Start it with `npm run daemon` or `npm run dev`.');
  }

  const graph = graphRaw as GraphResponse;
  const revAdj = buildReverseAdjacency(graph.edges);
  const ratings = ratingMap(graph);

  const fileRisks = changedFiles.map(f => assessFile(f, graph, revAdj, ratings));
  const redFiles = fileRisks.filter(r => r.verdict === 'RED').length;
  const yellowFiles = fileRisks.filter(r => r.verdict === 'YELLOW').length;
  const greenFiles = fileRisks.filter(r => r.verdict === 'GREEN').length;

  const overallVerdict: FileVerdict = redFiles > 0 ? 'RED' : yellowFiles > 0 ? 'YELLOW' : 'GREEN';

  const recommendation =
    redFiles > 0
      ? `❌ **Request changes** — ${redFiles} high-risk file(s) need attention before merge.`
      : yellowFiles > 0
      ? `⚠️ **Review carefully** — ${yellowFiles} medium-risk file(s). Verify downstream impact.`
      : `✅ **Approve** — all changed files are low-risk (no fragile dependents, quality ≥ 7).`;

  const icon: Record<FileVerdict, string> = { GREEN: '🟢', YELLOW: '🟡', RED: '🔴' };

  const lines: string[] = [
    '## PR Risk Assessment',
    `**Changed files:** ${changedFiles.length} | 🔴 Red: ${redFiles} | 🟡 Yellow: ${yellowFiles} | 🟢 Green: ${greenFiles}`,
    '',
    recommendation,
    '',
    '| File | Verdict | Rating | Dependents | Fragile Impact | Reason |',
    '|------|---------|--------|------------|----------------|--------|',
  ];

  for (const r of fileRisks) {
    const rel = path.relative(repo, r.file);
    const ratingStr = r.rating !== null ? `${r.rating}/10` : '?';
    lines.push(
      `| ${rel} | ${icon[r.verdict]} ${r.verdict} | ${ratingStr} | ${r.directDependents} | ${r.fragileImpacted} | ${r.reasons[0]} |`,
    );
  }

  const worstFiles = fileRisks.filter(r => r.verdict === 'RED');
  if (worstFiles.length > 0) {
    lines.push('', '**Action required for RED files:**');
    for (const r of worstFiles) {
      lines.push(`- **${path.basename(r.file)}**: ${r.reasons.join('; ')}`);
      lines.push(`  → Run \`suggest_refactoring("${r.file}")\` for fix instructions`);
    }
  }

  const result: PRReviewResult = {
    overallVerdict, changedFiles: changedFiles.length,
    redFiles, yellowFiles, greenFiles, fileRisks, recommendation,
  };

  return envelope('pr_review', result, lines.join('\n'));
}
