import { exportToJson, exportToGraphML, exportToNeo4j, exportToSvg, mergeGraphs, exportGraph } from './graph-export';

const nodes = [
  { id: 'src/auth.ts', label: 'auth.ts', rating: 8, metrics: { linesOfCode: 100, cyclomaticComplexity: 5, importCount: 3 } },
  { id: 'src/db.ts', label: 'db.ts', rating: 5, metrics: { linesOfCode: 200 } },
];
const edges = [
  { source: 'src/auth.ts', target: 'src/db.ts', type: 'import', strength: 1 },
];
const cycles = [{ nodes: ['src/auth.ts', 'src/db.ts'] }];

describe('exportToJson', () => {
  it('produces valid JSON', () => {
    const out = exportToJson(nodes, edges, cycles, { format: 'json', repoRoot: '/repo', overallRating: 6.5 });
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it('includes version, nodes, edges fields', () => {
    const parsed = JSON.parse(exportToJson(nodes, edges, [], { format: 'json' }));
    expect(parsed.version).toBe('2.0');
    expect(Array.isArray(parsed.nodes)).toBe(true);
    expect(Array.isArray(parsed.edges)).toBe(true);
  });

  it('includes godNodes and cycles', () => {
    const parsed = JSON.parse(exportToJson(nodes, edges, cycles, { format: 'json', repoRoot: '/repo' }));
    expect(Array.isArray(parsed.godNodes)).toBe(true);
    expect(Array.isArray(parsed.cycles)).toBe(true);
    expect(parsed.cycles).toHaveLength(1);
  });

  it('normalizes edge type to uppercase', () => {
    const parsed = JSON.parse(exportToJson(nodes, edges, [], { format: 'json' }));
    expect(parsed.edges[0].type).toBe('IMPORT');
  });

  it('includes overallRating', () => {
    const parsed = JSON.parse(exportToJson(nodes, edges, [], { format: 'json', overallRating: 7.2 }));
    expect(parsed.overallRating).toBe(7.2);
  });
});

describe('exportToGraphML', () => {
  it('produces valid XML structure', () => {
    const out = exportToGraphML(nodes, edges);
    expect(out).toContain('<?xml');
    expect(out).toContain('<graphml');
    expect(out).toContain('<graph');
    expect(out).toContain('</graphml>');
  });

  it('includes all nodes', () => {
    const out = exportToGraphML(nodes, edges);
    expect(out).toContain('src/auth.ts');
    expect(out).toContain('src/db.ts');
  });

  it('includes edges', () => {
    const out = exportToGraphML(nodes, edges);
    expect(out).toContain('<edge');
  });

  it('escapes special XML chars', () => {
    const specialNodes = [{ id: 'src/a&b.ts', label: 'a&b.ts', rating: 7 }];
    const out = exportToGraphML(specialNodes, []);
    expect(out).toContain('&amp;');
    // Raw unescaped form must not appear as a quoted attribute value
    expect(out).not.toContain('"src/a&b.ts"');
  });
});

describe('exportToNeo4j', () => {
  it('produces Cypher CREATE statements', () => {
    const out = exportToNeo4j(nodes, edges);
    expect(out).toContain('CREATE (:File');
    expect(out).toContain('CREATE (a)-[');
  });

  it('includes all nodes', () => {
    const out = exportToNeo4j(nodes, edges);
    expect(out).toContain('src/auth.ts');
    expect(out).toContain('src/db.ts');
  });

  it('includes MATCH for relationships', () => {
    const out = exportToNeo4j(nodes, edges);
    expect(out).toContain('MATCH (a:File');
  });
});

describe('exportToSvg', () => {
  it('produces a valid SVG document', () => {
    const out = exportToSvg(nodes, edges);
    expect(out).toContain('<svg xmlns=');
    expect(out).toContain('</svg>');
  });

  it('includes all node labels', () => {
    const out = exportToSvg(nodes, edges);
    expect(out).toContain('auth.ts');
    expect(out).toContain('db.ts');
  });

  it('includes edges as lines', () => {
    const out = exportToSvg(nodes, edges);
    expect(out).toContain('<line');
  });

  it('includes a legend', () => {
    const out = exportToSvg(nodes, edges);
    expect(out).toContain('Excellent');
    expect(out).toContain('Critical');
  });

  it('colour-codes nodes by rating', () => {
    const highRated = [{ id: 'good.ts', label: 'good.ts', rating: 9 }];
    const lowRated  = [{ id: 'bad.ts',  label: 'bad.ts',  rating: 2 }];
    const good = exportToSvg(highRated, []);
    const bad  = exportToSvg(lowRated, []);
    expect(good).toContain('#4caf50'); // green
    expect(bad).toContain('#f44336');  // red
  });

  it('respects custom width and height', () => {
    const out = exportToSvg(nodes, edges, { width: 400, height: 300 });
    expect(out).toContain('width="400"');
    expect(out).toContain('height="300"');
  });

  it('handles empty graph', () => {
    const out = exportToSvg([], []);
    expect(out).toContain('<svg');
    expect(out).not.toContain('<line');
  });

  it('includes node count in footer', () => {
    const out = exportToSvg(nodes, edges);
    expect(out).toContain('2 files');
    expect(out).toContain('1 edges');
  });
});

describe('mergeGraphs', () => {
  const graphA = {
    nodes: [
      { id: 'src/a.ts', label: 'a.ts', rating: 8 },
      { id: 'src/b.ts', label: 'b.ts', rating: 6 },
    ],
    edges: [{ source: 'src/a.ts', target: 'src/b.ts' }],
  };
  const graphB = {
    nodes: [
      { id: 'src/b.ts', label: 'b.ts', rating: 5 },
      { id: 'src/c.ts', label: 'c.ts', rating: 9 },
    ],
    edges: [
      { source: 'src/b.ts', target: 'src/c.ts' },
      { source: 'src/a.ts', target: 'src/b.ts' }, // duplicate
    ],
  };

  it('merges nodes from both graphs', () => {
    const result = mergeGraphs(graphA, graphB);
    const ids = result.nodes.map(n => n.id);
    expect(ids).toContain('src/a.ts');
    expect(ids).toContain('src/b.ts');
    expect(ids).toContain('src/c.ts');
  });

  it('deduplicates edges', () => {
    const result = mergeGraphs(graphA, graphB);
    const edgeKeys = result.edges.map(e => `${e.source}→${e.target}`);
    const unique = new Set(edgeKeys);
    expect(unique.size).toBe(edgeKeys.length);
  });

  it('takes minimum rating on conflict', () => {
    const result = mergeGraphs(graphA, graphB);
    const b = result.nodes.find(n => n.id === 'src/b.ts');
    expect(b?.rating).toBe(5); // min(6, 5)
  });

  it('records conflicts', () => {
    const result = mergeGraphs(graphA, graphB);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.id).toBe('src/b.ts');
    expect(result.conflicts[0]?.resolved).toBe(5);
  });

  it('no conflicts when ratings match', () => {
    const gA = { nodes: [{ id: 'x.ts', label: 'x', rating: 7 }], edges: [] };
    const gB = { nodes: [{ id: 'x.ts', label: 'x', rating: 7 }], edges: [] };
    const result = mergeGraphs(gA, gB);
    expect(result.conflicts).toHaveLength(0);
  });
});

describe('exportGraph dispatch', () => {
  it('dispatches json format', () => {
    const out = exportGraph(nodes, edges, [], { format: 'json' });
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it('dispatches graphml format', () => {
    const out = exportGraph(nodes, edges, [], { format: 'graphml' });
    expect(out).toContain('<graphml');
  });

  it('dispatches neo4j format', () => {
    const out = exportGraph(nodes, edges, [], { format: 'neo4j' });
    expect(out).toContain('CREATE');
  });

  it('dispatches svg format', () => {
    const out = exportGraph(nodes, edges, [], { format: 'svg' });
    expect(out).toContain('<svg');
  });
});
