import * as fs from 'fs';
import * as path from 'path';
import { CycleInfo } from '../../graph/dependency-graph';
import { RefactoringHint } from '../../types';
import { RefactoringAdvisor } from '../../analyzer/refactoring-advisor';
import { UniversalAnalyzer } from '../../analyzer/universal-analyzer';
import { GraphResponse, GraphNodeData } from './types';

// ── Shared instances ───────────────────────────────────────

const fileAnalyzer = new UniversalAnalyzer();
const refactoringAdvisor = new RefactoringAdvisor();

// ── Display helpers ─────────────────────────────────────────

export function renderDirectDependents(
  graph: GraphResponse,
  directDeps: Set<string>,
  repo: string,
): string[] {
  if (directDeps.size === 0) return [];
  const lines: string[] = ['### Direct Dependents'];
  for (const dep of directDeps) {
    const node = graph.nodes.find(n => n.id === dep);
    const ratingStr = node ? ` (rating: ${node.rating}, ${node.violations.length} violations)` : '';
    lines.push(`- ${path.relative(repo, dep)}${ratingStr}`);
  }
  lines.push('');
  return lines;
}

export function renderTransitiveDependents(
  graph: GraphResponse,
  transitiveDeps: string[],
  repo: string,
): string[] {
  if (transitiveDeps.length === 0) return [];
  const lines: string[] = ['### Transitive Dependents'];
  for (const dep of transitiveDeps.slice(0, 20)) {
    const node = graph.nodes.find(n => n.id === dep);
    const ratingStr = node ? ` (rating: ${node.rating})` : '';
    lines.push(`- ${path.relative(repo, dep)}${ratingStr}`);
  }
  if (transitiveDeps.length > 20) {
    lines.push(`... and ${transitiveDeps.length - 20} more`);
  }
  lines.push('');
  return lines;
}

export function renderAtRiskDependents(
  graph: GraphResponse,
  allDeps: Set<string>,
  repo: string,
): string[] {
  const affectedNodes = graph.nodes.filter(n => allDeps.has(n.id));
  const lowRated = affectedNodes.filter(n => n.rating < 6);
  if (lowRated.length === 0) return [];

  const lines: string[] = [
    '### At-Risk Dependents (rating < 6)',
    'These files already have quality issues and may be fragile to upstream changes:',
  ];
  for (const node of lowRated.sort((a, b) => a.rating - b.rating)) {
    lines.push(`- **${node.rating}/10** — ${path.relative(repo, node.id)} (${node.violations.length} violations)`);
  }
  lines.push('');
  return lines;
}

export async function renderRemediationPlan(
  graph: GraphResponse,
  allDeps: Set<string>,
  cycles: CycleInfo[],
  repo: string,
): Promise<string[]> {
  const affectedNodes = graph.nodes.filter(n => allDeps.has(n.id));
  const atRisk = affectedNodes.filter(n => n.rating < 6).sort((a, b) => a.rating - b.rating);

  if (atRisk.length === 0) {
    if (allDeps.size === 0) return [];
    return ['No at-risk dependents (all affected files have rating ≥ 6). Change appears safe.', ''];
  }

  const lines: string[] = [
    `### Remediation Plan for At-Risk Dependents (${atRisk.length} files with rating < 6)`,
    'These files already have quality issues and need targeted fixes:',
    '',
  ];

  for (const node of atRisk.slice(0, 5)) {
    lines.push(`#### ${path.relative(repo, node.id)} — Rating: ${node.rating}/10`);

    const hints = await computeHints(node, cycles);

    if (hints.length === 0) {
      lines.push(`- ${node.violations.length} violations detected. Re-analyze with \`analyze_file\` for specific hints.`);
    } else {
      lines.push(`**Top fix (${hints[0].patternName}):** ${hints[0].rationale}`);
      hints[0].steps.slice(0, 3).forEach((step, i) => lines.push(`${i + 1}. ${step}`));
      if (hints.length > 1) {
        lines.push(`_(and ${hints.length - 1} more hints — use \`suggest_refactoring\` for full detail)_`);
      }
    }
    lines.push('');
  }

  if (atRisk.length > 5) {
    lines.push(`... and ${atRisk.length - 5} more at-risk files. Use \`suggest_refactoring\` on each.`);
  }
  return lines;
}

async function computeHints(node: GraphNodeData, cycles: CycleInfo[]): Promise<RefactoringHint[]> {
  if (!fs.existsSync(node.id) || !fileAnalyzer.isSupportedFile(node.id)) return [];
  const freshAnalysis = await fileAnalyzer.analyze(node.id);
  return freshAnalysis ? refactoringAdvisor.suggest(freshAnalysis, cycles) : [];
}
