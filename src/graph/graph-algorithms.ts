/**
 * Pure graph traversal algorithms used by graph-aware MCP tools.
 *
 * All functions operate on adjacency maps built from GraphResponse data,
 * keeping them free of I/O and daemon dependencies.
 */

export interface NodeData {
  id: string;
  rating: number;
  linesOfCode?: number;
}

/** Build adjacency: source → [targets] */
export function buildAdjacency(edges: ReadonlyArray<{ source: string; target: string }>): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    (adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!).push(e.target);
  }
  return adj;
}

/** Build reverse adjacency: target → [sources] (who imports me) */
export function buildReverseAdjacency(edges: ReadonlyArray<{ source: string; target: string }>): Map<string, string[]> {
  const rev = new Map<string, string[]>();
  for (const e of edges) {
    (rev.get(e.target) ?? rev.set(e.target, []).get(e.target)!).push(e.source);
  }
  return rev;
}

export interface ImpactEntry {
  path: string;
  depth: number;
  severity: 'direct' | 'indirect';
  rating: number;
  fragile: boolean;
}

/**
 * BFS over reverse adjacency (dependents) up to `maxDepth` hops.
 * Returns entries ordered by depth then by rating asc (fragile first).
 */
export function getImpactSet(
  filePath: string,
  reverseAdj: Map<string, string[]>,
  ratingByNode: Map<string, number>,
  maxDepth: number,
  fragileThreshold: number,
): ImpactEntry[] {
  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: filePath, depth: 0 }];
  const result: ImpactEntry[] = [];

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (depth > maxDepth) continue;
    if (id !== filePath) {
      const rating = ratingByNode.get(id) ?? 10;
      result.push({
        path: id,
        depth,
        severity: depth === 1 ? 'direct' : 'indirect',
        rating,
        fragile: rating < fragileThreshold,
      });
    }
    for (const dependent of reverseAdj.get(id) ?? []) {
      if (!visited.has(dependent) && dependent !== filePath) {
        visited.add(dependent);
        if (depth < maxDepth) queue.push({ id: dependent, depth: depth + 1 });
      }
    }
  }

  return result.sort((a, b) => a.depth - b.depth || a.rating - b.rating);
}

export interface PathEntry {
  path: string;
  rating: number;
}

/**
 * BFS shortest dependency path from source to target.
 * Follows forward adjacency (import direction).
 * Returns null if no path exists.
 */
export function tracePath(
  source: string,
  target: string,
  adj: Map<string, string[]>,
  ratingByNode: Map<string, number>,
): PathEntry[] | null {
  if (source === target) return [{ path: source, rating: ratingByNode.get(source) ?? 10 }];

  const visited = new Set<string>([source]);
  const queue: Array<{ id: string; trail: string[] }> = [{ id: source, trail: [source] }];

  while (queue.length > 0) {
    const { id, trail } = queue.shift()!;
    for (const next of adj.get(id) ?? []) {
      if (visited.has(next)) continue;
      const newTrail = [...trail, next];
      if (next === target) {
        return newTrail.map(p => ({ path: p, rating: ratingByNode.get(p) ?? 10 }));
      }
      visited.add(next);
      queue.push({ id: next, trail: newTrail });
    }
  }

  return null;
}

export interface CentralityEntry {
  path: string;
  inDegree: number;
  outDegree: number;
  totalDegree: number;
  rating: number;
  label: string;
}

/**
 * Compute degree centrality for all nodes.
 * Higher totalDegree = more connected = higher blast radius.
 */
export function computeCentrality(
  nodes: ReadonlyArray<{ id: string; label: string; rating: number }>,
  edges: ReadonlyArray<{ source: string; target: string }>,
): CentralityEntry[] {
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();

  for (const n of nodes) {
    inDeg.set(n.id, 0);
    outDeg.set(n.id, 0);
  }
  for (const e of edges) {
    outDeg.set(e.source, (outDeg.get(e.source) ?? 0) + 1);
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
  }

  return nodes.map(n => ({
    path: n.id,
    label: n.label,
    inDegree: inDeg.get(n.id) ?? 0,
    outDegree: outDeg.get(n.id) ?? 0,
    totalDegree: (inDeg.get(n.id) ?? 0) + (outDeg.get(n.id) ?? 0),
    rating: n.rating,
  })).sort((a, b) => b.totalDegree - a.totalDegree);
}

// ── Betweenness Centrality (Brandes algorithm) ─────────────

export interface BetweennessEntry {
  path: string;
  betweenness: number;
  normalizedBetweenness: number;
}

/**
 * Compute betweenness centrality using the Brandes algorithm.
 * Betweenness(v) = Σ_{s≠v≠t} σ(s,t|v) / σ(s,t)
 * where σ(s,t) = number of shortest paths from s to t, σ(s,t|v) = those passing through v.
 *
 * Time complexity: O(V·E).
 * Normalised by (n-1)(n-2) for directed graphs, so values are in [0,1].
 *
 * Files that score high here are "bridge" nodes — removing them would most
 * disrupt information flow across the codebase.
 */
export function computeBetweennessCentrality(
  nodes: ReadonlyArray<{ id: string }>,
  edges: ReadonlyArray<{ source: string; target: string }>,
): BetweennessEntry[] {
  const adj = buildAdjacency(edges);
  const nodeList = nodes.map(n => n.id);
  const betweenness = new Map<string, number>(nodeList.map(id => [id, 0]));

  for (const s of nodeList) {
    const stack: string[] = [];
    const predecessors = new Map<string, string[]>(nodeList.map(id => [id, []]));
    const sigma = new Map<string, number>(nodeList.map(id => [id, 0]));
    sigma.set(s, 1);
    const dist = new Map<string, number>(nodeList.map(id => [id, -1]));
    dist.set(s, 0);

    const queue: string[] = [s];
    let qi = 0;
    while (qi < queue.length) {
      const v = queue[qi++]!;
      stack.push(v);
      for (const w of adj.get(v) ?? []) {
        if (dist.get(w) === -1) {
          queue.push(w);
          dist.set(w, dist.get(v)! + 1);
        }
        if (dist.get(w) === dist.get(v)! + 1) {
          sigma.set(w, sigma.get(w)! + sigma.get(v)!);
          predecessors.get(w)!.push(v);
        }
      }
    }

    const delta = new Map<string, number>(nodeList.map(id => [id, 0]));
    while (stack.length > 0) {
      const w = stack.pop()!;
      for (const v of predecessors.get(w)!) {
        const coeff = (sigma.get(v)! / sigma.get(w)!) * (1 + delta.get(w)!);
        delta.set(v, delta.get(v)! + coeff);
      }
      if (w !== s) {
        betweenness.set(w, betweenness.get(w)! + delta.get(w)!);
      }
    }
  }

  const n = nodeList.length;
  const norm = n > 2 ? (n - 1) * (n - 2) : 1;
  return nodeList.map(id => ({
    path: id,
    betweenness: betweenness.get(id)!,
    normalizedBetweenness: betweenness.get(id)! / norm,
  })).sort((a, b) => b.betweenness - a.betweenness);
}

/** Estimate token count for a raw text block (rough: 4 chars ≈ 1 token) */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Estimate tokens saved by not reading N source files */
export function estimateSavings(filesNotRead: number, avgFileSizeTokens = 5000): number {
  return filesNotRead * avgFileSizeTokens;
}
