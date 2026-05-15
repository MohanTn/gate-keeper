/**
 * Pure graph-algorithm functions used by the query REPL.
 * No I/O — all functions take graph data and return results.
 */

import * as path from 'path';

// ── Types ──────────────────────────────────────────────────

export interface ReplGraphNode {
  id: string;
  label: string;
  rating: number;
  metrics: { linesOfCode: number; importCount: number; cyclomaticComplexity: number };
  violations: Array<{ type: string; severity: string }>;
}

export interface ReplGraphEdge {
  source: string;
  target: string;
  type: string;
  strength: number;
}

export interface ReplGraph {
  nodes: ReplGraphNode[];
  edges: ReplGraphEdge[];
}

export interface CentralityEntry {
  path: string;
  label: string;
  rating: number;
  inDegree: number;
  outDegree: number;
  totalDegree: number;
}

export interface SurprisingConnection {
  src: string;
  dst: string;
  S: string;
  T: string;
  score: number;
}

// ── Module detection ───────────────────────────────────────

export function getModule(filePath: string, repoRoot: string): string {
  const rel = path.relative(repoRoot, filePath);
  const parts = rel.split(path.sep).filter(Boolean);
  if (parts.length <= 1) return '(root)';
  if (['src', 'lib', 'app'].includes(parts[0]!) && parts.length > 2) return parts[1]!;
  return parts[0]!;
}

// ── Degree centrality ──────────────────────────────────────

export function computeDegreeCentrality(graph: ReplGraph): CentralityEntry[] {
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  for (const n of graph.nodes) { inDeg.set(n.id, 0); outDeg.set(n.id, 0); }
  for (const e of graph.edges) {
    outDeg.set(e.source, (outDeg.get(e.source) ?? 0) + 1);
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
  }
  return graph.nodes.map(n => ({
    path: n.id, label: n.label, rating: n.rating,
    inDegree: inDeg.get(n.id) ?? 0,
    outDegree: outDeg.get(n.id) ?? 0,
    totalDegree: (inDeg.get(n.id) ?? 0) + (outDeg.get(n.id) ?? 0),
  })).sort((a, b) => b.totalDegree - a.totalDegree);
}

// ── Surprising cross-module connections ────────────────────

export function findSurprising(graph: ReplGraph, repo: string, topN = 5): SurprisingConnection[] {
  const nodeIds = new Set(graph.nodes.map(n => n.id));
  const moduleOf = new Map<string, string>();
  for (const n of graph.nodes) moduleOf.set(n.id, getModule(n.id, repo));

  const pairCounts = new Map<string, number>();
  for (const e of graph.edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    const sm = moduleOf.get(e.source) ?? '(?)';
    const tm = moduleOf.get(e.target) ?? '(?)';
    if (sm !== tm) {
      const key = `${sm}→${tm}`;
      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
    }
  }

  const results: SurprisingConnection[] = [];
  for (const e of graph.edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    const sm = moduleOf.get(e.source) ?? '(?)';
    const tm = moduleOf.get(e.target) ?? '(?)';
    if (sm === tm) continue;
    const pairCount = pairCounts.get(`${sm}→${tm}`) ?? 1;
    results.push({ src: e.source, dst: e.target, S: sm, T: tm, score: 1 / Math.log(pairCount + 1) });
  }

  const seen = new Set<string>();
  return results.sort((a, b) => b.score - a.score).filter(r => {
    const k = `${r.src}|${r.dst}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, topN);
}

// ── Suggested questions ────────────────────────────────────

export function suggestQuestions(graph: ReplGraph, repo: string): string[] {
  const centrality = computeDegreeCentrality(graph);
  const top = centrality.slice(0, 3);
  const worst = [...graph.nodes].sort((a, b) => a.rating - b.rating)[0];
  const qs: string[] = [];
  for (const god of top) {
    qs.push(`What would break if "${path.relative(repo, god.path)}" changed?`);
  }
  if (worst && top[0] && worst.id !== top[0].path) {
    qs.push(`How does "${path.relative(repo, top[0].path)}" connect to "${path.relative(repo, worst.id)}" (worst-rated file)?`);
  }
  if (worst && worst.rating < 7) {
    qs.push(`What's wrong with "${path.relative(repo, worst.id)}" (rating ${worst.rating}/10)?`);
  }
  return qs;
}

// ── BFS path finding ───────────────────────────────────────

export function findPath(startId: string, endId: string, edges: ReplGraphEdge[]): string[] | null {
  const queue: Array<{ id: string; trail: string[] }> = [{ id: startId, trail: [startId] }];
  const visited = new Set([startId]);
  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const edge of edges) {
      if (edge.source !== node.id || visited.has(edge.target)) continue;
      const trail = [...node.trail, edge.target];
      if (edge.target === endId) return trail;
      visited.add(edge.target);
      queue.push({ id: edge.target, trail });
    }
  }
  return null;
}
