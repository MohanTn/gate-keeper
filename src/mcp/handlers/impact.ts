import * as path from 'path';
import { CycleInfo } from '../../graph/dependency-graph';
import { fetchDaemonApi, findGitRoot } from '../helpers';
import { GraphResponse } from './types';
import { text, envelope, McpResponse } from './shared';
import {
  renderDirectDependents,
  renderTransitiveDependents,
  renderAtRiskDependents,
  renderRemediationPlan,
  buildRemediationPlan,
} from './impact-format';

// ── Graph traversal helpers ─────────────────────────────────

function buildReverseAdjacency(graph: GraphResponse): Map<string, string[]> {
  const reverseAdj = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const sources = reverseAdj.get(edge.target) ?? [];
    sources.push(edge.source);
    reverseAdj.set(edge.target, sources);
  }
  return reverseAdj;
}

function collectTransitiveDependents(
  reverseAdj: Map<string, string[]>,
  filePath: string,
): { direct: Set<string>; all: Set<string> } {
  const direct = new Set(reverseAdj.get(filePath) ?? []);
  const all = new Set<string>();
  const stack = [...direct];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (all.has(current)) continue;
    all.add(current);
    for (const next of reverseAdj.get(current) ?? []) {
      if (!all.has(next)) stack.push(next);
    }
  }
  return { direct, all };
}

// ── Handlers ───────────────────────────────────────────────

export async function handleImpactAnalysis(
  args: Record<string, unknown>,
): Promise<McpResponse> {
  const filePath = String(args.file_path ?? '');
  if (!filePath) return text('Error: file_path is required.');

  const repo = String(args.repo ?? findGitRoot(path.dirname(filePath)));
  const encodedRepo = encodeURIComponent(repo);

  const graphRaw = await fetchDaemonApi(`/api/graph?repo=${encodedRepo}`);
  if (!graphRaw) {
    return text('Error: Gate Keeper daemon is not running. Start it with `npm run daemon` or `npm run dev`.');
  }

  const graph = graphRaw as GraphResponse;
  const reverseAdj = buildReverseAdjacency(graph);
  const { direct: directDeps, all: allDeps } = collectTransitiveDependents(reverseAdj, filePath);
  const transitiveDeps = [...allDeps].filter(d => !directDeps.has(d));

  const lines: string[] = [
    `## Impact Analysis: ${path.basename(filePath)}`,
    `**Path:** ${filePath}`,
    `**Direct dependents:** ${directDeps.size} | **Total affected (transitive):** ${allDeps.size}`,
    '',
    ...renderDirectDependents(graph, directDeps, repo),
    ...renderTransitiveDependents(graph, transitiveDeps, repo),
    ...renderAtRiskDependents(graph, allDeps, repo),
  ];

  if (allDeps.size === 0) {
    lines.push('No other files depend on this file. Changes here have no downstream impact.');
  }

  const affectedNodes = graph.nodes.filter(n => allDeps.has(n.id));
  const atRisk = affectedNodes.filter(n => n.rating < 6).sort((a, b) => a.rating - b.rating);

  const data = {
    filePath,
    direct: [...directDeps],
    transitive: transitiveDeps,
    atRisk,
  };

  return envelope('get_impact_analysis', data, lines.join('\n'));
}

export async function handlePredictImpactWithRemediation(
  args: Record<string, unknown>,
): Promise<McpResponse> {
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
  const reverseAdj = buildReverseAdjacency(graph);
  const { direct: directDeps, all: allDeps } = collectTransitiveDependents(reverseAdj, filePath);
  const transitiveDeps = [...allDeps].filter(d => !directDeps.has(d));

  const remediation = await renderRemediationPlan(graph, allDeps, cycles, repo);
  const plan = await buildRemediationPlan(filePath, graph, directDeps, allDeps);

  const lines: string[] = [
    `## Impact + Remediation: ${path.basename(filePath)}`,
    `**Path:** ${filePath}`,
    `**Direct dependents:** ${directDeps.size} | **Total affected (transitive):** ${allDeps.size}`,
    '',
    ...renderDirectDependents(graph, directDeps, repo),
    ...renderTransitiveDependents(graph, transitiveDeps, repo),
    ...remediation,
  ];

  if (allDeps.size === 0) {
    lines.push('No other files depend on this file. Changes here have no downstream impact.');
  }

  return envelope('predict_impact_with_remediation', plan, lines.join('\n'));
}
