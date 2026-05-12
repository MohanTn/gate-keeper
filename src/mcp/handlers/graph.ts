import * as path from 'path';
import { fetchDaemonApi, findGitRoot } from '../helpers';
import { GraphResponse, FileDetailResponse } from './types';
import { text, envelope, McpResponse } from './shared';

export async function handleFileContext(args: Record<string, unknown>): Promise<McpResponse> {
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
    return text('File not found in the dependency graph. Run a scan first or analyze the file with `analyze_file`.');
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
    lines.push(`### Circular Dependencies (${fileCycles.length} cycles)`);
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
    const arrow = delta > 0 ? 'improving' : delta < 0 ? 'declining' : '→ stable';
    lines.push(`${oldest.rating} → ${newest.rating} (${arrow})`);
    lines.push('');
  }

  if (detail?.gitDiff) {
    lines.push('### Uncommitted Changes');
    lines.push(`+${detail.gitDiff.added} lines added, −${detail.gitDiff.removed} lines removed`);
    lines.push('');
  }

  const data = {
    filePath,
    rating,
    file: detail?.analysis ?? null,
    imports,
    dependents,
    cycles: fileCycles,
    ratingBreakdown: detail?.ratingBreakdown ?? [],
    ratingTrend: trends,
    gitDiff: detail?.gitDiff ?? null,
  };

  return envelope('get_file_context', data, lines.join('\n'));
}

export async function handleDependencyGraph(args: Record<string, unknown>): Promise<McpResponse> {
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

  const adjacency: Record<string, string[]> = {};
  const reverseAdjacency: Record<string, string[]> = {};
  for (const edge of graph.edges) {
    (adjacency[edge.source] ??= []).push(edge.target);
    (reverseAdjacency[edge.target] ??= []).push(edge.source);
  }

  const data = {
    repo,
    nodes: graph.nodes,
    edges: graph.edges,
    cycles,
    overallRating: status?.overallRating ?? null,
    distribution: { excellent, good, poor },
    mostConnected: mostConnected.map(([id, count]) => ({ id, connections: count })),
    worstFiles: worstNodes.filter(n => n.rating < 8),
    complexityHotspots: complexFiles.map(n => ({
      id: n.id, complexity: n.metrics.cyclomaticComplexity, linesOfCode: n.metrics.linesOfCode,
    })),
    adjacency,
    reverseAdjacency,
  };

  return envelope('get_dependency_graph', data, lines.join('\n'));
}
