/**
 * Graph export engine — produces graphify-compatible JSON, GraphML, and Neo4j Cypher.
 *
 * All formats capture the full node+edge structure so external tools (graph
 * databases, visualizers, other repos) can consume gate-keeper analysis.
 */

import { computeCentrality } from './graph-algorithms';
import { findSurprisingConnections } from './surprising-connections';
import { suggestQuestions } from './question-suggester';

interface GNode {
  id: string;
  label: string;
  rating: number;
  metrics?: { linesOfCode?: number; cyclomaticComplexity?: number; importCount?: number };
  violations?: Array<{ type: string; severity: string; message: string }>;
}

interface GEdge { source: string; target: string; type?: string; strength?: number }
interface CycleInfo { nodes: string[] }

export type ExportFormat = 'json' | 'graphml' | 'neo4j' | 'svg';

export interface ExportOptions {
  format: ExportFormat;
  repoRoot?: string;
  overallRating?: number | null;
}

// ── JSON (graphify-compatible) ─────────────────────────────

export function exportToJson(
  nodes: ReadonlyArray<GNode>,
  edges: ReadonlyArray<GEdge>,
  cycles: ReadonlyArray<CycleInfo>,
  opts: ExportOptions,
): string {
  const repoRoot = opts.repoRoot ?? '';
  const centrality = computeCentrality(nodes as GNode[], edges as GEdge[]);
  const godNodes = centrality.slice(0, 10).map(c => ({
    id: c.path,
    label: c.label,
    inDegree: c.inDegree,
    outDegree: c.outDegree,
    totalDegree: c.totalDegree,
    rating: c.rating,
  }));

  const surprising = repoRoot
    ? findSurprisingConnections(nodes, edges, repoRoot, 10)
    : [];

  const questions = repoRoot
    ? suggestQuestions(nodes as GNode[], edges as GEdge[], repoRoot, 5)
    : [];

  const graph = {
    version: '2.0',
    generatedAt: Date.now(),
    repo: repoRoot,
    overallRating: opts.overallRating ?? null,
    nodes: nodes.map(n => ({
      id: n.id,
      type: 'file',
      label: n.label,
      rating: n.rating,
      metrics: n.metrics ?? {},
      violations: (n.violations ?? []).map(v => ({ type: v.type, severity: v.severity })),
    })),
    edges: edges.map(e => ({
      source: e.source,
      target: e.target,
      type: (e.type ?? 'IMPORT').toUpperCase(),
      confidence: 'EXTRACTED',
      weight: e.strength ?? 1,
    })),
    godNodes,
    surprisingConnections: surprising,
    suggestedQuestions: questions.map(q => q.question),
    cycles: cycles.map(c => c.nodes),
  };

  return JSON.stringify(graph, null, 2);
}

// ── GraphML ────────────────────────────────────────────────

export function exportToGraphML(
  nodes: ReadonlyArray<GNode>,
  edges: ReadonlyArray<GEdge>,
): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/graphml">',
    '  <key id="rating" for="node" attr.name="rating" attr.type="double"/>',
    '  <key id="linesOfCode" for="node" attr.name="linesOfCode" attr.type="int"/>',
    '  <key id="label" for="node" attr.name="label" attr.type="string"/>',
    '  <key id="edgeType" for="edge" attr.name="type" attr.type="string"/>',
    '  <key id="weight" for="edge" attr.name="weight" attr.type="double"/>',
    '  <graph id="G" edgedefault="directed">',
  ];

  for (const n of nodes) {
    const safeId = escapeXml(n.id);
    lines.push(`    <node id="${safeId}">`);
    lines.push(`      <data key="label">${escapeXml(n.label)}</data>`);
    lines.push(`      <data key="rating">${n.rating}</data>`);
    if (n.metrics?.linesOfCode !== undefined) {
      lines.push(`      <data key="linesOfCode">${n.metrics.linesOfCode}</data>`);
    }
    lines.push('    </node>');
  }

  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]!;
    lines.push(`    <edge id="e${i}" source="${escapeXml(e.source)}" target="${escapeXml(e.target)}">`);
    lines.push(`      <data key="edgeType">${escapeXml(e.type ?? 'IMPORT')}</data>`);
    lines.push(`      <data key="weight">${e.strength ?? 1}</data>`);
    lines.push('    </edge>');
  }

  lines.push('  </graph>');
  lines.push('</graphml>');
  return lines.join('\n');
}

// ── Neo4j Cypher ───────────────────────────────────────────

export function exportToNeo4j(
  nodes: ReadonlyArray<GNode>,
  edges: ReadonlyArray<GEdge>,
): string {
  const lines: string[] = [
    '// Gate Keeper — Neo4j Cypher import script',
    '// Run: cypher-shell < graph.cypher',
    '',
    '// Clear existing (optional):',
    '// MATCH (n:File) DETACH DELETE n;',
    '',
    '// Nodes',
  ];

  for (const n of nodes) {
    const props = [
      `id: ${cyStr(n.id)}`,
      `label: ${cyStr(n.label)}`,
      `rating: ${n.rating}`,
    ];
    if (n.metrics?.linesOfCode !== undefined) props.push(`linesOfCode: ${n.metrics.linesOfCode}`);
    if (n.metrics?.cyclomaticComplexity !== undefined) props.push(`complexity: ${n.metrics.cyclomaticComplexity}`);
    lines.push(`CREATE (:File {${props.join(', ')}});`);
  }

  lines.push('', '// Relationships');
  for (const e of edges) {
    const relType = (e.type ?? 'IMPORT').replace(/\W/g, '_').toUpperCase();
    lines.push(
      `MATCH (a:File {id: ${cyStr(e.source)}}), (b:File {id: ${cyStr(e.target)}}) ` +
      `CREATE (a)-[:${relType} {weight: ${e.strength ?? 1}}]->(b);`,
    );
  }

  return lines.join('\n');
}

// ── SVG (circular layout) ──────────────────────────────────

/**
 * Render the graph as SVG using a circular node layout.
 * Nodes are placed evenly around a circle; edges are straight lines.
 * Node colour encodes rating; node radius encodes in-degree.
 */
export function exportToSvg(
  nodes: ReadonlyArray<GNode>,
  edges: ReadonlyArray<GEdge>,
  opts: { width?: number; height?: number } = {},
): string {
  const W = opts.width ?? 900;
  const H = opts.height ?? 900;
  const cx = W / 2;
  const cy = H / 2;
  const layoutR = Math.min(W, H) * 0.38;
  const MIN_NR = 5;
  const MAX_NR = 14;

  // Compute in-degree for node sizing
  const inDeg = new Map<string, number>(nodes.map(n => [n.id, 0]));
  for (const e of edges) inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
  const maxIn = Math.max(1, ...inDeg.values());

  // Circular positions
  const pos = new Map<string, { x: number; y: number }>();
  nodes.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / Math.max(nodes.length, 1) - Math.PI / 2;
    pos.set(n.id, { x: cx + layoutR * Math.cos(angle), y: cy + layoutR * Math.sin(angle) });
  });

  const ratingColor = (r: number) =>
    r >= 8 ? '#4caf50' : r >= 6 ? '#ffc107' : r >= 4 ? '#ff9800' : '#f44336';

  const nodeRadius = (id: string): number => {
    const d = inDeg.get(id) ?? 0;
    return MIN_NR + ((d / maxIn) * (MAX_NR - MIN_NR));
  };

  const lines: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<defs>`,
    `  <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5"`,
    `    markerWidth="6" markerHeight="6" orient="auto-start-reverse">`,
    `    <path d="M 0 0 L 10 5 L 0 10 z" fill="#ccc"/>`,
    `  </marker>`,
    `</defs>`,
    `<style>`,
    `  text { font-family: sans-serif; font-size: 9px; fill: #333; pointer-events: none; }`,
    `  .edge { stroke: #ccc; stroke-width: 1; fill: none; marker-end: url(#arrow); }`,
    `  .node { cursor: pointer; }`,
    `  .node:hover circle { stroke-width: 3; }`,
    `</style>`,
    `<rect width="${W}" height="${H}" fill="#fafafa"/>`,
    `<g class="edges">`,
  ];

  for (const e of edges) {
    const s = pos.get(e.source);
    const t = pos.get(e.target);
    if (!s || !t || e.source === e.target) continue;
    // Shorten line so it doesn't overlap node circles
    const tr = nodeRadius(e.target);
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const ux = len > 0 ? dx / len : 0;
    const uy = len > 0 ? dy / len : 0;
    const tx = t.x - ux * (tr + 2);
    const ty = t.y - uy * (tr + 2);
    lines.push(
      `  <line class="edge" x1="${s.x.toFixed(1)}" y1="${s.y.toFixed(1)}" ` +
      `x2="${tx.toFixed(1)}" y2="${ty.toFixed(1)}"/>`,
    );
  }

  lines.push(`</g>`, `<g class="nodes">`);

  for (const n of nodes) {
    const p = pos.get(n.id);
    if (!p) continue;
    const r = nodeRadius(n.id);
    const color = ratingColor(n.rating);
    const lx = p.x + r + 3;
    const ly = p.y + 3;
    lines.push(
      `  <g class="node">`,
      `    <title>${escapeXml(n.label)}: ${n.rating}/10, ` +
      `${n.metrics?.linesOfCode ?? '?'} LOC, in-degree ${inDeg.get(n.id) ?? 0}</title>`,
      `    <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" ` +
      `fill="${color}" stroke="white" stroke-width="1.5"/>`,
      `    <text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}">${escapeXml(n.label)}</text>`,
      `  </g>`,
    );
  }

  // Legend
  const legend = [
    { color: '#4caf50', label: '≥8 Excellent' },
    { color: '#ffc107', label: '6–7.9 Good' },
    { color: '#ff9800', label: '4–5.9 Poor' },
    { color: '#f44336', label: '<4 Critical' },
  ];
  lines.push(`</g>`, `<g class="legend" transform="translate(12,${H - 80})">`);
  legend.forEach(({ color, label }, i) => {
    const y = i * 18;
    lines.push(
      `  <circle cx="7" cy="${y}" r="6" fill="${color}"/>`,
      `  <text x="16" y="${y + 4}">${label}</text>`,
    );
  });
  lines.push(
    `</g>`,
    `<text x="${W - 10}" y="${H - 6}" font-size="8" fill="#aaa" text-anchor="end">` +
    `Gate Keeper — ${nodes.length} files, ${edges.length} edges</text>`,
    `</svg>`,
  );

  return lines.join('\n');
}

// ── Merge ─────────────────────────────────────────────────

export interface MergeResult {
  nodes: GNode[];
  edges: GEdge[];
  conflicts: Array<{ id: string; ratingA: number; ratingB: number; resolved: number }>;
}

export function mergeGraphs(
  graphA: { nodes: GNode[]; edges: GEdge[] },
  graphB: { nodes: GNode[]; edges: GEdge[] },
): MergeResult {
  const nodeMap = new Map<string, GNode>();
  const conflicts: MergeResult['conflicts'] = [];

  for (const n of graphA.nodes) nodeMap.set(n.id, n);

  for (const n of graphB.nodes) {
    const existing = nodeMap.get(n.id);
    if (existing && existing.rating !== n.rating) {
      // Conflict: take the minimum rating (conservative / most honest)
      const resolved = Math.min(existing.rating, n.rating);
      conflicts.push({ id: n.id, ratingA: existing.rating, ratingB: n.rating, resolved });
      nodeMap.set(n.id, { ...n, rating: resolved });
    } else {
      nodeMap.set(n.id, n);
    }
  }

  // Union edges, deduplicating by source+target
  const edgeSet = new Set<string>();
  const edges: GEdge[] = [];
  for (const e of [...graphA.edges, ...graphB.edges]) {
    const key = `${e.source}→${e.target}`;
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      edges.push(e);
    }
  }

  return { nodes: [...nodeMap.values()], edges, conflicts };
}

// ── Dispatch ───────────────────────────────────────────────

export function exportGraph(
  nodes: ReadonlyArray<GNode>,
  edges: ReadonlyArray<GEdge>,
  cycles: ReadonlyArray<CycleInfo>,
  opts: ExportOptions,
): string {
  switch (opts.format) {
    case 'json': return exportToJson(nodes, edges, cycles, opts);
    case 'graphml': return exportToGraphML(nodes, edges);
    case 'neo4j': return exportToNeo4j(nodes, edges);
    case 'svg': return exportToSvg(nodes, edges);
  }
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cyStr(s: string): string {
  return `'${s.replace(/'/g, "\\'")}'`;
}
