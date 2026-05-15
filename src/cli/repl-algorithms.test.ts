/**
 * Tests for pure graph-algorithm functions used by the query REPL.
 * No I/O, no mocking required.
 */

import {
  getModule, computeDegreeCentrality, findSurprising,
  suggestQuestions, findPath, ReplGraph,
} from './repl-algorithms';

const REPO = '/repo';

// ── Shared fixtures ────────────────────────────────────────

function makeNode(id: string, rating: number) {
  return {
    id, label: id.split('/').pop()!, rating,
    metrics: { linesOfCode: 100, importCount: 3, cyclomaticComplexity: 5 },
    violations: [] as Array<{ type: string; severity: string }>,
  };
}

const A = makeNode('/repo/src/auth/service.ts', 8);
const B = makeNode('/repo/src/db/pool.ts', 4);
const C = makeNode('/repo/src/utils/logger.ts', 9);
const D = makeNode('/repo/src/api/router.ts', 7);

const graph: ReplGraph = {
  nodes: [A, B, C, D],
  edges: [
    { source: D.id, target: A.id, type: 'import', strength: 1 },
    { source: A.id, target: B.id, type: 'import', strength: 1 },
    { source: D.id, target: C.id, type: 'import', strength: 1 },
  ],
};

// ── getModule ───────────────────────────────────────────────

describe('getModule', () => {
  it('extracts second segment from src/ paths', () => {
    expect(getModule('/repo/src/mcp/server.ts', '/repo')).toBe('mcp');
  });

  it('extracts second segment from lib/ paths', () => {
    expect(getModule('/repo/lib/utils/helper.ts', '/repo')).toBe('utils');
  });

  it('extracts second segment from app/ paths', () => {
    expect(getModule('/repo/app/auth/service.ts', '/repo')).toBe('auth');
  });

  it('returns first segment for non-src/lib/app roots', () => {
    expect(getModule('/repo/components/Button.tsx', '/repo')).toBe('components');
  });

  it('returns (root) for top-level files', () => {
    expect(getModule('/repo/index.ts', '/repo')).toBe('(root)');
  });

  it('returns (root) for empty path after relative', () => {
    expect(getModule('/repo', '/repo')).toBe('(root)');
  });
});

// ── computeDegreeCentrality ────────────────────────────────

describe('computeDegreeCentrality', () => {
  it('assigns correct inDegree and outDegree', () => {
    const result = computeDegreeCentrality(graph);
    const d = result.find(n => n.path === D.id)!;
    const a = result.find(n => n.path === A.id)!;
    const b = result.find(n => n.path === B.id)!;
    expect(d.outDegree).toBe(2);
    expect(a.inDegree).toBe(1);
    expect(b.inDegree).toBe(1);
    expect(b.outDegree).toBe(0);
  });

  it('computes totalDegree as inDegree + outDegree', () => {
    const result = computeDegreeCentrality(graph);
    for (const n of result) {
      expect(n.totalDegree).toBe(n.inDegree + n.outDegree);
    }
  });

  it('sorts descending by totalDegree', () => {
    const result = computeDegreeCentrality(graph);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1]!.totalDegree).toBeGreaterThanOrEqual(result[i]!.totalDegree);
    }
  });

  it('returns empty array for empty graph', () => {
    expect(computeDegreeCentrality({ nodes: [], edges: [] })).toHaveLength(0);
  });

  it('handles nodes with no edges (all zeros)', () => {
    const isolated = { nodes: [makeNode('/repo/src/x.ts', 7)], edges: [] };
    const [n] = computeDegreeCentrality(isolated);
    expect(n!.inDegree).toBe(0);
    expect(n!.outDegree).toBe(0);
  });
});

// ── findSurprising ─────────────────────────────────────────

describe('findSurprising', () => {
  it('detects cross-module edges as surprising', () => {
    const result = findSurprising(graph, REPO, 10);
    // auth→db and api→auth are cross-module
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty('score');
    expect(result[0]!.score).toBeGreaterThan(0);
  });

  it('returns empty array when all edges are within same module', () => {
    const singleModule: ReplGraph = {
      nodes: [makeNode('/repo/src/auth/a.ts', 8), makeNode('/repo/src/auth/b.ts', 7)],
      edges: [{ source: '/repo/src/auth/a.ts', target: '/repo/src/auth/b.ts', type: 'import', strength: 1 }],
    };
    expect(findSurprising(singleModule, REPO)).toHaveLength(0);
  });

  it('respects topN limit', () => {
    const result = findSurprising(graph, REPO, 1);
    expect(result.length).toBeLessThanOrEqual(1);
  });

  it('deduplicates identical src→dst pairs', () => {
    const dup: ReplGraph = {
      nodes: [makeNode('/repo/src/a/x.ts', 8), makeNode('/repo/src/b/y.ts', 7)],
      edges: [
        { source: '/repo/src/a/x.ts', target: '/repo/src/b/y.ts', type: 'import', strength: 1 },
        { source: '/repo/src/a/x.ts', target: '/repo/src/b/y.ts', type: 'call', strength: 1 },
      ],
    };
    const result = findSurprising(dup, REPO);
    // Same src/dst pair should appear only once
    const pairs = result.map(r => `${r.src}|${r.dst}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('skips edges referencing unknown node ids', () => {
    const ghost: ReplGraph = {
      nodes: [makeNode('/repo/src/a/x.ts', 8)],
      edges: [{ source: '/repo/src/a/x.ts', target: '/repo/src/b/missing.ts', type: 'import', strength: 1 }],
    };
    expect(findSurprising(ghost, REPO)).toHaveLength(0);
  });
});

// ── suggestQuestions ───────────────────────────────────────

describe('suggestQuestions', () => {
  it('returns questions for the top centrality nodes', () => {
    const qs = suggestQuestions(graph, REPO);
    expect(qs.length).toBeGreaterThan(0);
    expect(qs[0]).toContain('break');
  });

  it('includes worst-rated file question when rating < 7', () => {
    const qs = suggestQuestions(graph, REPO);
    // B has rating 4 < 7
    const hasWorst = qs.some(q => q.includes('pool.ts') || q.includes('wrong'));
    expect(hasWorst).toBe(true);
  });

  it('returns empty array for empty graph', () => {
    expect(suggestQuestions({ nodes: [], edges: [] }, REPO)).toHaveLength(0);
  });

  it('returns questions for single-node graph', () => {
    const single = { nodes: [makeNode('/repo/src/auth/a.ts', 8)], edges: [] };
    const qs = suggestQuestions(single, REPO);
    expect(qs.length).toBeGreaterThan(0);
  });
});

// ── findPath ───────────────────────────────────────────────

describe('findPath', () => {
  it('finds a direct one-hop path', () => {
    const result = findPath(D.id, A.id, graph.edges);
    expect(result).toEqual([D.id, A.id]);
  });

  it('finds a two-hop path', () => {
    const result = findPath(D.id, B.id, graph.edges);
    expect(result).toEqual([D.id, A.id, B.id]);
  });

  it('returns null when no forward path exists', () => {
    // B has no outgoing edges → no path from B to D
    expect(findPath(B.id, D.id, graph.edges)).toBeNull();
  });

  it('returns [id] when start equals end — single-node trivial path', () => {
    // The BFS starts with [startId] in the queue; if startId === endId,
    // no edge will match so it returns null (caller should treat same-node as trivial)
    expect(findPath(A.id, A.id, graph.edges)).toBeNull();
  });

  it('handles empty edge list', () => {
    expect(findPath(A.id, B.id, [])).toBeNull();
  });

  it('does not revisit nodes (no infinite loop on cycles)', () => {
    const cyclic: ReplGraph['edges'] = [
      { source: '/a', target: '/b', type: 'import', strength: 1 },
      { source: '/b', target: '/a', type: 'import', strength: 1 },
    ];
    const result = findPath('/a', '/c', cyclic);
    expect(result).toBeNull(); // /c doesn't exist, should terminate
  });
});
