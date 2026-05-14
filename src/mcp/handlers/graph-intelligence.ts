/**
 * Graph-intelligence MCP handlers — graphify-style knowledge queries.
 *
 * Tools implemented here:
 *   get_graph_report  — narrative Markdown report (god nodes, surprising connections, suggested questions)
 *   query_graph       — deterministic natural-language query dispatcher
 *   explain_node      — deep node explanation (role, connections, centrality, questions)
 *   export_graph      — JSON / GraphML / Neo4j export
 *   merge_graphs      — union-merge two repos' graph data
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { fetchDaemonApi, findGitRoot } from '../helpers';
import { GraphResponse } from './types';
import { text, envelope, McpResponse } from './shared';
import { tokenTracker } from '../token-tracker';
import { generateGraphReport } from '../../graph/graph-report';
import { exportGraph, mergeGraphs, ExportFormat } from '../../graph/graph-export';
import { computeCentrality, buildAdjacency, buildReverseAdjacency, getImpactSet, computeBetweennessCentrality } from '../../graph/graph-algorithms';
import { findSurprisingConnections } from '../../graph/surprising-connections';
import { suggestQuestions } from '../../graph/question-suggester';
import { generateGraphViz } from '../../viz/graph-viz';

function daemonError(): McpResponse {
  return text('Error: Gate Keeper daemon is not running. Start it with `npm run daemon` or `npm run dev`.');
}

function ratingMap(graph: GraphResponse): Map<string, number> {
  const m = new Map<string, number>();
  for (const n of graph.nodes) m.set(n.id, n.rating);
  return m;
}

// ── get_graph_report ───────────────────────────────────────

export async function handleGetGraphReport(args: Record<string, unknown>): Promise<McpResponse> {
  const repo = String(args.repo ?? findGitRoot(process.cwd()));
  const encodedRepo = encodeURIComponent(repo);

  const [graphRaw, cyclesRaw, statusRaw] = await Promise.all([
    fetchDaemonApi(`/api/graph?repo=${encodedRepo}`),
    fetchDaemonApi(`/api/cycles?repo=${encodedRepo}`),
    fetchDaemonApi(`/api/status?repo=${encodedRepo}`),
  ]);

  if (!graphRaw) return daemonError();

  const graph = graphRaw as GraphResponse;
  const cycles = (cyclesRaw ?? []) as Array<{ nodes: string[] }>;
  const status = statusRaw as { overallRating?: number } | null;

  const report = generateGraphReport(
    graph.nodes,
    graph.edges,
    cycles,
    repo,
    status?.overallRating ?? null,
  );

  const godNodes = computeCentrality(graph.nodes, graph.edges).slice(0, 5);
  const surprising = findSurprisingConnections(graph.nodes, graph.edges, repo, 5);
  const questions = suggestQuestions(graph.nodes, graph.edges, repo, 5);

  const data = {
    repo,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    overallRating: status?.overallRating ?? null,
    godNodes,
    surprisingConnections: surprising,
    suggestedQuestions: questions,
    cycleCount: cycles.length,
  };

  tokenTracker.record('get_graph_report', graph.nodes.length, report);
  return envelope('get_graph_report', data, report);
}

// ── query_graph ────────────────────────────────────────────

const QUERY_PATTERNS: Array<{
  pattern: RegExp;
  handler: (m: RegExpMatchArray, graph: GraphResponse, repo: string) => string;
}> = [
  {
    pattern: /(what|which|show).*(connect|path|between|from).*\bto\b/i,
    handler: (_, g, repo) => `Use trace_path with source and target file paths to find the connection. Available files: ${g.nodes.slice(0, 5).map(n => path.relative(repo, n.id)).join(', ')}…`,
  },
  {
    pattern: /(what|which).*(break|fail|affected|impact).*(if|when|changing?)/i,
    handler: (_, g, repo) => {
      const top = computeCentrality(g.nodes, g.edges)[0];
      return top
        ? `Most at-risk file to change: ${path.relative(repo, top.path)} (${top.totalDegree} dependents). Use get_impact_set for specific impact analysis.`
        : 'No files analyzed yet.';
    },
  },
  {
    pattern: /(what|who).*(import|use|depend).*(on)/i,
    handler: (_, g, repo) => {
      const top = computeCentrality(g.nodes, g.edges).sort((a, b) => b.inDegree - a.inDegree)[0];
      return top
        ? `Most-imported file: ${path.relative(repo, top.path)} (imported by ${top.inDegree} files). Use get_impact_set(depth=1) to see direct dependents.`
        : 'No edges in graph yet.';
    },
  },
  {
    pattern: /(god|hotspot|central|most.connect|highest.blast)/i,
    handler: (_, g, repo) => {
      const ranked = computeCentrality(g.nodes, g.edges).slice(0, 5);
      return ranked.map((n, i) =>
        `${i + 1}. ${path.relative(repo, n.path)} — ${n.totalDegree} connections, rating ${n.rating}/10`
      ).join('\n');
    },
  },
  {
    pattern: /(surprising|unexpected|cross.module|strange)/i,
    handler: (_, g, repo) => {
      const s = findSurprisingConnections(g.nodes, g.edges, repo, 3);
      if (s.length === 0) return 'No surprising cross-module connections found.';
      return s.map(c =>
        `${path.relative(repo, c.source)} → ${path.relative(repo, c.target)} (score: ${c.score.toFixed(2)})`
      ).join('\n');
    },
  },
  {
    pattern: /(explain|describe|tell.*about|what.*is)\s+(.+)/i,
    handler: (m, g, repo) => {
      const term = m[2]?.trim() ?? '';
      const match = g.nodes.find(n =>
        n.id.includes(term) || n.label.toLowerCase().includes(term.toLowerCase())
      );
      if (!match) return `File matching "${term}" not found in graph. Use explain_node with an absolute path.`;
      return `${path.relative(repo, match.id)} — rating ${match.rating}/10, ${match.metrics.linesOfCode} LOC, ${match.metrics.importCount} imports. Use explain_node for full context.`;
    },
  },
  {
    pattern: /(health|quality|rating).*(worst|bad|poor|low)/i,
    handler: (_, g, repo) => {
      const worst = [...g.nodes].sort((a, b) => a.rating - b.rating).slice(0, 5);
      return worst.map(n =>
        `${path.relative(repo, n.id)} — ${n.rating}/10 (${n.violations.length} violations)`
      ).join('\n');
    },
  },
  {
    pattern: /(suggest|recommend|question|what.*ask)/i,
    handler: (_, g, repo) => {
      const qs = suggestQuestions(g.nodes, g.edges, repo, 5);
      return qs.map((q, i) => `${i + 1}. ${q.question}`).join('\n');
    },
  },
];

/**
 * Pure function: resolve a natural language query against graph data.
 * No I/O, no daemon — purely deterministic pattern matching.
 *
 * Exported for testing. Returns the answer text (or null for unrecognised queries).
 */
export function resolveQueryPattern(
  query: string,
  graph: GraphResponse,
  repo: string,
): string | null {
  for (const { pattern, handler } of QUERY_PATTERNS) {
    const m = query.match(pattern);
    if (m) {
      return handler(m, graph, repo);
    }
  }
  return null;
}

export async function handleQueryGraph(args: Record<string, unknown>): Promise<McpResponse> {
  const query = String(args.query ?? '').trim();
  if (!query) return text('Error: query is required.');

  const repo = String(args.repo ?? findGitRoot(process.cwd()));
  const graphRaw = await fetchDaemonApi(`/api/graph?repo=${encodeURIComponent(repo)}`);
  if (!graphRaw) return daemonError();

  const graph = graphRaw as GraphResponse;
  let answer = resolveQueryPattern(query, graph, repo);

  if (!answer) {
    const qs = suggestQuestions(graph.nodes, graph.edges, repo, 4);
    answer = `Query not recognized. Suggested questions:\n${qs.map((q, i) => `${i + 1}. ${q.question}`).join('\n')}\n\nOr use specific tools: get_impact_set, trace_path, get_centrality_rank, summarize_file.`;
  }

  const result = `## Query: ${query}\n\n${answer}`;
  tokenTracker.record('query_graph', graph.nodes.length, result);
  return envelope('query_graph', { query, answer, repo }, result);
}

// ── explain_node ───────────────────────────────────────────

export async function handleExplainNode(args: Record<string, unknown>): Promise<McpResponse> {
  const filePath = String(args.file_path ?? '');
  if (!filePath) return text('Error: file_path is required.');

  const repo = String(args.repo ?? findGitRoot(path.dirname(filePath)));
  const encodedRepo = encodeURIComponent(repo);
  const encodedFile = encodeURIComponent(filePath);

  const [graphRaw, detailRaw] = await Promise.all([
    fetchDaemonApi(`/api/graph?repo=${encodedRepo}`),
    fetchDaemonApi(`/api/file-detail?file=${encodedFile}&repo=${encodedRepo}`),
  ]);

  if (!graphRaw) return daemonError();

  const graph = graphRaw as GraphResponse;
  const detail = detailRaw as { analysis?: { rating: number; metrics: Record<string, unknown>; violations: unknown[] } } | null;
  const node = graph.nodes.find(n => n.id === filePath);

  if (!node && !detail) {
    return text(`File not in graph. Run analyze_file("${filePath}") first.`);
  }

  const rating = node?.rating ?? detail?.analysis?.rating ?? 0;
  const centrality = computeCentrality(graph.nodes, graph.edges);
  const rank = centrality.findIndex(c => c.path === filePath);
  const centralityEntry = centrality[rank];

  const revAdj = buildReverseAdjacency(graph.edges);
  const adj = buildAdjacency(graph.edges);
  const ratings = ratingMap(graph);

  const impactSet = getImpactSet(filePath, revAdj, ratings, 2, 6);
  const imports = graph.edges.filter(e => e.source === filePath);
  const dependents = graph.edges.filter(e => e.target === filePath);

  const surprising = findSurprisingConnections(graph.nodes, graph.edges, repo, 10)
    .filter(s => s.source === filePath || s.target === filePath);

  const questions = suggestQuestions(
    [{ id: filePath, label: path.basename(filePath), rating }],
    [...imports.map(e => ({ source: filePath, target: e.target })),
     ...dependents.map(e => ({ source: e.source, target: filePath }))],
    repo,
    3,
  );

  const fragileCount = impactSet.filter(e => e.fragile).length;
  const riskIcon = fragileCount >= 3 ? '🔴' : fragileCount >= 1 ? '🟡' : '🟢';

  const lines: string[] = [
    `## Node Explanation: ${path.basename(filePath)}`,
    `**Path:** ${path.relative(repo, filePath)}`,
    `**Rating:** ${rating}/10 | **LOC:** ${node?.metrics.linesOfCode ?? '?'} | **Complexity:** ${node?.metrics.cyclomaticComplexity ?? '?'}`,
    `**Centrality Rank:** ${rank >= 0 ? `#${rank + 1} of ${graph.nodes.length}` : 'not ranked'} (${centralityEntry?.totalDegree ?? 0} total connections)`,
    `**Imports:** ${imports.length} files | **Imported by:** ${dependents.length} files`,
    `**Impact Set (depth 2):** ${impactSet.length} affected files ${riskIcon} (${fragileCount} fragile)`,
    '',
    '**Role in architecture:**',
  ];

  if (centralityEntry && centralityEntry.inDegree > 5) {
    lines.push(`This is a god node — ${centralityEntry.inDegree} files depend on it. Changes here have wide blast radius.`);
  } else if (centralityEntry && centralityEntry.outDegree > 10) {
    lines.push(`This file has many dependencies (${centralityEntry.outDegree} imports). High coupling risk.`);
  } else {
    lines.push(`Standard file with moderate connectivity.`);
  }

  if (surprising.length > 0) {
    lines.push('', '**Surprising connections involving this file:**');
    for (const s of surprising.slice(0, 3)) {
      const other = s.source === filePath ? s.target : s.source;
      lines.push(`- ${path.relative(repo, other)} (${s.explanation})`);
    }
  }

  if (questions.length > 0) {
    lines.push('', '**Suggested follow-up questions:**');
    questions.forEach((q, i) => lines.push(`${i + 1}. ${q.question} → \`${q.tool}\``));
  }

  const data = {
    filePath, rating, rank: rank >= 0 ? rank + 1 : null,
    centrality: centralityEntry ?? null,
    impactSet, imports, dependents, fragileCount,
    surprisingConnections: surprising,
    suggestedQuestions: questions,
  };

  tokenTracker.record('explain_node', graph.nodes.length - 1, lines.join('\n'));
  return envelope('explain_node', data, lines.join('\n'));
}

// ── export_graph ───────────────────────────────────────────

export async function handleExportGraph(args: Record<string, unknown>): Promise<McpResponse> {
  const format = String(args.format ?? 'json') as ExportFormat;
  if (!['json', 'graphml', 'neo4j'].includes(format)) {
    return text('Error: format must be "json", "graphml", or "neo4j".');
  }

  const repo = String(args.repo ?? findGitRoot(process.cwd()));
  const encodedRepo = encodeURIComponent(repo);

  const [graphRaw, cyclesRaw, statusRaw] = await Promise.all([
    fetchDaemonApi(`/api/graph?repo=${encodedRepo}`),
    fetchDaemonApi(`/api/cycles?repo=${encodedRepo}`),
    fetchDaemonApi(`/api/status?repo=${encodedRepo}`),
  ]);

  if (!graphRaw) return daemonError();

  const graph = graphRaw as GraphResponse;
  const cycles = (cyclesRaw ?? []) as Array<{ nodes: string[] }>;
  const status = statusRaw as { overallRating?: number } | null;

  const exported = exportGraph(graph.nodes, graph.edges, cycles, {
    format,
    repoRoot: repo,
    overallRating: status?.overallRating,
  });

  const summary = `## Graph Export: ${format.toUpperCase()}\n**Repo:** ${repo}\n**Nodes:** ${graph.nodes.length} | **Edges:** ${graph.edges.length}\n\n\`\`\`${format === 'graphml' ? 'xml' : format === 'neo4j' ? 'cypher' : 'json'}\n${exported.slice(0, 2000)}${exported.length > 2000 ? '\n... (truncated)' : ''}\n\`\`\``;

  tokenTracker.record('export_graph', 0, summary);
  return envelope('export_graph', { format, repo, content: exported, nodeCount: graph.nodes.length }, summary);
}

// ── get_graph_viz ──────────────────────────────────────────

export async function handleGetGraphViz(args: Record<string, unknown>): Promise<McpResponse> {
  const repo = String(args.repo ?? findGitRoot(process.cwd()));
  const outputPath = args.output_path
    ? String(args.output_path)
    : path.join(os.homedir(), '.gate-keeper', 'graph-viz.html');

  const graphRaw = await fetchDaemonApi(`/api/graph?repo=${encodeURIComponent(repo)}`);
  if (!graphRaw) return daemonError();

  const graph = graphRaw as GraphResponse;
  const title = `Gate Keeper — ${path.basename(repo)} (${graph.nodes.length} files)`;
  const html = generateGraphViz(graph.nodes, graph.edges, { title });

  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, html, 'utf8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return text(`Error writing visualization to ${outputPath}: ${msg}`);
  }

  const lines = [
    '## Interactive Graph Visualization',
    `**Written to:** \`${outputPath}\``,
    `**Nodes:** ${graph.nodes.length} | **Edges:** ${graph.edges.length}`,
    '',
    `Open in browser: \`open ${outputPath}\` (macOS) or \`xdg-open ${outputPath}\` (Linux)`,
    '',
    '_Features: force-directed layout, pan/zoom, search, click for details panel._',
  ];

  tokenTracker.record('get_graph_viz', 0, lines.join('\n'));
  return envelope('get_graph_viz', { outputPath, nodeCount: graph.nodes.length, edgeCount: graph.edges.length }, lines.join('\n'));
}

// ── merge_graphs ───────────────────────────────────────────

export async function handleMergeGraphs(args: Record<string, unknown>): Promise<McpResponse> {
  const repoA = String(args.repo_a ?? '');
  const repoB = String(args.repo_b ?? '');
  if (!repoA || !repoB) return text('Error: repo_a and repo_b are required.');

  const [graphAraw, graphBraw] = await Promise.all([
    fetchDaemonApi(`/api/graph?repo=${encodeURIComponent(repoA)}`),
    fetchDaemonApi(`/api/graph?repo=${encodeURIComponent(repoB)}`),
  ]);

  if (!graphAraw) return text(`Error: No graph data for repo_a (${repoA}). Is the daemon running?`);
  if (!graphBraw) return text(`Error: No graph data for repo_b (${repoB}). Is the daemon running?`);

  const gA = graphAraw as GraphResponse;
  const gB = graphBraw as GraphResponse;
  const result = mergeGraphs(
    { nodes: gA.nodes as Parameters<typeof mergeGraphs>[0]['nodes'], edges: gA.edges },
    { nodes: gB.nodes as Parameters<typeof mergeGraphs>[1]['nodes'], edges: gB.edges },
  );

  const lines: string[] = [
    '## Merged Graph',
    `**Source A:** ${repoA} (${gA.nodes.length} nodes, ${gA.edges.length} edges)`,
    `**Source B:** ${repoB} (${gB.nodes.length} nodes, ${gB.edges.length} edges)`,
    `**Merged:** ${result.nodes.length} nodes, ${result.edges.length} edges`,
    `**Conflicts resolved:** ${result.conflicts.length}`,
  ];

  if (result.conflicts.length > 0) {
    lines.push('', '**Rating conflicts (took minimum):**');
    for (const c of result.conflicts.slice(0, 10)) {
      lines.push(`- ${path.basename(c.id)}: ${c.ratingA} vs ${c.ratingB} → resolved as ${c.resolved}`);
    }
    if (result.conflicts.length > 10) lines.push(`... and ${result.conflicts.length - 10} more`);
  }

  return envelope('merge_graphs', result, lines.join('\n'));
}
