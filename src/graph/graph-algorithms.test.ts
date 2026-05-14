import {
  buildAdjacency,
  buildReverseAdjacency,
  getImpactSet,
  tracePath,
  computeCentrality,
  computeBetweennessCentrality,
  estimateTokens,
  estimateSavings,
} from './graph-algorithms';

const EDGES = [
  { source: 'a', target: 'b' },
  { source: 'a', target: 'c' },
  { source: 'b', target: 'd' },
  { source: 'c', target: 'd' },
  { source: 'e', target: 'f' },
];

const NODES = [
  { id: 'a', label: 'a', rating: 9 },
  { id: 'b', label: 'b', rating: 5 },
  { id: 'c', label: 'c', rating: 7 },
  { id: 'd', label: 'd', rating: 4 },
  { id: 'e', label: 'e', rating: 8 },
  { id: 'f', label: 'f', rating: 6 },
];

describe('buildAdjacency', () => {
  it('maps source to list of targets', () => {
    const adj = buildAdjacency(EDGES);
    expect(adj.get('a')).toEqual(['b', 'c']);
    expect(adj.get('b')).toEqual(['d']);
    expect(adj.get('e')).toEqual(['f']);
    expect(adj.get('d')).toBeUndefined();
  });
});

describe('buildReverseAdjacency', () => {
  it('maps target to list of sources', () => {
    const rev = buildReverseAdjacency(EDGES);
    expect(rev.get('d')).toEqual(expect.arrayContaining(['b', 'c']));
    expect(rev.get('b')).toEqual(['a']);
    expect(rev.get('a')).toBeUndefined();
  });
});

describe('getImpactSet', () => {
  const rev = buildReverseAdjacency(EDGES);
  const ratings = new Map(NODES.map(n => [n.id, n.rating]));

  it('returns direct dependents at depth=1', () => {
    const result = getImpactSet('d', rev, ratings, 1, 6);
    const paths = result.map(e => e.path);
    expect(paths).toContain('b');
    expect(paths).toContain('c');
    expect(paths).not.toContain('a');
  });

  it('returns transitive dependents at depth=2', () => {
    const result = getImpactSet('d', rev, ratings, 2, 6);
    const paths = result.map(e => e.path);
    expect(paths).toContain('a');
  });

  it('marks entries with rating < threshold as fragile', () => {
    const result = getImpactSet('d', rev, ratings, 2, 6);
    const b = result.find(e => e.path === 'b');
    expect(b?.fragile).toBe(true); // rating 5
    const c = result.find(e => e.path === 'c');
    expect(c?.fragile).toBe(false); // rating 7
  });

  it('returns empty for a leaf node with no dependents', () => {
    const result = getImpactSet('a', rev, ratings, 2, 6);
    expect(result).toHaveLength(0);
  });

  it('marks depth-1 entries as direct', () => {
    const result = getImpactSet('d', rev, ratings, 2, 6);
    const b = result.find(e => e.path === 'b');
    expect(b?.severity).toBe('direct');
  });

  it('marks depth-2 entries as indirect', () => {
    const result = getImpactSet('d', rev, ratings, 2, 6);
    const a = result.find(e => e.path === 'a');
    expect(a?.severity).toBe('indirect');
  });
});

describe('tracePath', () => {
  const adj = buildAdjacency(EDGES);
  const ratings = new Map(NODES.map(n => [n.id, n.rating]));

  it('finds path from a to d', () => {
    const result = tracePath('a', 'd', adj, ratings);
    expect(result).not.toBeNull();
    expect(result![0]!.path).toBe('a');
    expect(result![result!.length - 1]!.path).toBe('d');
  });

  it('path length is correct', () => {
    const result = tracePath('a', 'd', adj, ratings);
    expect(result).toHaveLength(3); // a → b → d or a → c → d
  });

  it('returns single node when source equals target', () => {
    const result = tracePath('a', 'a', adj, ratings);
    expect(result).toHaveLength(1);
    expect(result![0]!.path).toBe('a');
  });

  it('returns null when no path exists', () => {
    const result = tracePath('d', 'a', adj, ratings); // no backward path
    expect(result).toBeNull();
  });

  it('returns null for disconnected nodes', () => {
    const result = tracePath('a', 'f', adj, ratings); // e→f is isolated
    expect(result).toBeNull();
  });
});

describe('computeCentrality', () => {
  it('returns all nodes', () => {
    const result = computeCentrality(NODES, EDGES);
    expect(result).toHaveLength(NODES.length);
  });

  it('node d has highest in-degree (2)', () => {
    const result = computeCentrality(NODES, EDGES);
    const d = result.find(e => e.path === 'd');
    expect(d?.inDegree).toBe(2);
  });

  it('node a has highest out-degree (2)', () => {
    const result = computeCentrality(NODES, EDGES);
    const a = result.find(e => e.path === 'a');
    expect(a?.outDegree).toBe(2);
  });

  it('sorts by totalDegree descending', () => {
    const result = computeCentrality(NODES, EDGES);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1]!.totalDegree).toBeGreaterThanOrEqual(result[i]!.totalDegree);
    }
  });
});

describe('computeBetweennessCentrality', () => {
  // Linear chain: a → b → c  — node b is on every a→c path
  const CHAIN_NODES = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const CHAIN_EDGES = [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }];

  it('returns an entry per node', () => {
    const result = computeBetweennessCentrality(CHAIN_NODES, CHAIN_EDGES);
    expect(result).toHaveLength(3);
  });

  it('middle node of a chain has highest betweenness', () => {
    const result = computeBetweennessCentrality(CHAIN_NODES, CHAIN_EDGES);
    const b = result.find(e => e.path === 'b');
    const a = result.find(e => e.path === 'a');
    const c = result.find(e => e.path === 'c');
    expect(b!.betweenness).toBeGreaterThan(a!.betweenness);
    expect(b!.betweenness).toBeGreaterThan(c!.betweenness);
  });

  it('result is sorted by betweenness descending', () => {
    const result = computeBetweennessCentrality(CHAIN_NODES, CHAIN_EDGES);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1]!.betweenness).toBeGreaterThanOrEqual(result[i]!.betweenness);
    }
  });

  it('returns zero betweenness for all nodes in disconnected graph', () => {
    const isolated = [{ id: 'x' }, { id: 'y' }];
    const result = computeBetweennessCentrality(isolated, []);
    expect(result.every(e => e.betweenness === 0)).toBe(true);
  });

  it('normalised betweenness is in [0, 1]', () => {
    const result = computeBetweennessCentrality(NODES, EDGES);
    for (const e of result) {
      expect(e.normalizedBetweenness).toBeGreaterThanOrEqual(0);
      expect(e.normalizedBetweenness).toBeLessThanOrEqual(1);
    }
  });

  it('handles single node', () => {
    const result = computeBetweennessCentrality([{ id: 'solo' }], []);
    expect(result).toHaveLength(1);
    expect(result[0]!.betweenness).toBe(0);
  });

  it('high-betweenness node in multi-path graph', () => {
    // Star topology: centre connects to a, b, c
    const starNodes = [{ id: 'centre' }, { id: 'a' }, { id: 'b' }, { id: 'c' }];
    const starEdges = [
      { source: 'a', target: 'centre' },
      { source: 'b', target: 'centre' },
      { source: 'c', target: 'centre' },
      { source: 'centre', target: 'a' },
      { source: 'centre', target: 'b' },
      { source: 'centre', target: 'c' },
    ];
    const result = computeBetweennessCentrality(starNodes, starEdges);
    const centre = result.find(e => e.path === 'centre');
    const leaf = result.find(e => e.path === 'a');
    expect(centre!.betweenness).toBeGreaterThan(leaf!.betweenness);
  });
});

describe('token estimates', () => {
  it('estimates ~1 token per 4 chars', () => {
    expect(estimateTokens('1234')).toBe(1);
    expect(estimateTokens('12345678')).toBe(2);
  });

  it('calculates savings as filesNotRead * avgTokens', () => {
    expect(estimateSavings(3, 5000)).toBe(15000);
    expect(estimateSavings(0)).toBe(0);
  });
});
