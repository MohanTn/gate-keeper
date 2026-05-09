import {
  classifyNodeToLayer,
  computeArchLayerPositions,
  detectArchViolations,
  getLayerBands,
  buildNodeLayerMap,
  getViolationSourceNodes,
  LAYER_CONFIG,
} from './arch-layers';
import type { GraphNode, GraphEdge, ArchMapping } from '../types';

const node = (id: string): GraphNode => ({ id, label: id, type: 'typescript', rating: 7 } as GraphNode);
const edge = (source: string, target: string, type = 'normal'): GraphEdge => ({ source, target, type } as GraphEdge);

describe('classifyNodeToLayer', () => {
  it('returns layer from fileMap when provided', () => {
    expect(classifyNodeToLayer('src/api/controller.ts', { 'src/api/controller.ts': 'interface' })).toBe('interface');
  });

  it('returns unknown for unrecognised path when fileMap provided', () => {
    expect(classifyNodeToLayer('src/mystery.ts', { 'other.ts': 'domain' })).toBe('unknown');
  });

  it('classifies by folder pattern when no fileMap', () => {
    expect(classifyNodeToLayer('src/domain/user.ts')).toBe('domain');
    expect(classifyNodeToLayer('src/infrastructure/config.ts')).toBe('infrastructure');
    expect(classifyNodeToLayer('src/cache/store.ts')).toBe('data');
  });

  it('classifies by filename pattern when no fileMap', () => {
    expect(classifyNodeToLayer('src/user.service.ts')).toBe('usecase');
    expect(classifyNodeToLayer('src/repository/user.ts')).toBe('data');
  });

  it('returns external for unrecognised path without fileMap', () => {
    expect(classifyNodeToLayer('node_modules/lodash/index.js')).toBe('external');
  });
});

describe('buildNodeLayerMap', () => {
  it('maps each node to its layer', () => {
    const nodes = [node('src/domain/user.ts'), node('src/cache/db.ts')];
    const map = buildNodeLayerMap(nodes);
    expect(map.get('src/domain/user.ts')).toBe('domain');
    expect(map.get('src/cache/db.ts')).toBe('data');
  });

  it('uses archMapping fileMap when provided', () => {
    const nodes = [node('src/foo.ts')];
    const archMapping = {
      repo: 'test',
      layers: LAYER_CONFIG,
      files: { 'src/foo.ts': 'entity' },
      overrides: {},
    };
    const map = buildNodeLayerMap(nodes, archMapping as unknown as ArchMapping);
    expect(map.get('src/foo.ts')).toBe('entity');
  });
});

describe('computeArchLayerPositions', () => {
  it('assigns distinct X positions per layer (column layout)', () => {
    const nodes = [node('src/domain/a.ts'), node('src/cache/b.ts')];
    const positions = computeArchLayerPositions(nodes);
    const domainPos = positions.get('src/domain/a.ts');
    const dataPos = positions.get('src/cache/b.ts');
    expect(domainPos).toBeDefined();
    expect(dataPos).toBeDefined();
    expect(domainPos!.x).not.toBe(dataPos!.x);
  });

  it('stacks multiple nodes in the same layer vertically (same X)', () => {
    const nodes = [node('src/domain/a.ts'), node('src/domain/b.ts')];
    const positions = computeArchLayerPositions(nodes);
    const posA = positions.get('src/domain/a.ts')!;
    const posB = positions.get('src/domain/b.ts')!;
    expect(posA.x).toBe(posB.x);
    expect(posA.y).not.toBe(posB.y);
  });

  it('places all nodes', () => {
    const nodes = [node('src/domain/a.ts'), node('src/api/b.ts'), node('src/cache/c.ts')];
    const positions = computeArchLayerPositions(nodes);
    expect(positions.size).toBe(3);
  });
});

describe('detectArchViolations', () => {
  it('detects reverse dependency', () => {
    const layerMap = new Map([['src/domain/a.ts', 'domain'], ['src/api/b.ts', 'interface']]);
    const edges = [edge('src/domain/a.ts', 'src/api/b.ts')];
    const violations = detectArchViolations(edges, layerMap, ['application', 'interface', 'usecase', 'domain', 'entity', 'data', 'infrastructure']);
    expect(violations.size).toBeGreaterThan(0);
    const v = Array.from(violations.values())[0];
    expect(v.type).toBe('reverse-dependency');
  });

  it('does not flag valid inward dependency', () => {
    const layerMap = new Map([['src/api/b.ts', 'interface'], ['src/domain/a.ts', 'domain']]);
    const edges = [edge('src/api/b.ts', 'src/domain/a.ts')];
    const violations = detectArchViolations(edges, layerMap, ['application', 'interface', 'usecase', 'domain', 'entity', 'data', 'infrastructure']);
    const reverseDeps = Array.from(violations.values()).filter(v => v.type === 'reverse-dependency');
    expect(reverseDeps.length).toBe(0);
  });

  it('detects cross-layer cycle', () => {
    const layerMap = new Map([['src/api/a.ts', 'interface'], ['src/domain/b.ts', 'domain']]);
    const edges = [edge('src/api/a.ts', 'src/domain/b.ts', 'circular')];
    const violations = detectArchViolations(edges, layerMap);
    const cycles = Array.from(violations.values()).filter(v => v.type === 'cross-layer-cycle');
    expect(cycles.length).toBeGreaterThan(0);
  });
});

describe('computeArchLayerPositions — edge cases', () => {
  it('places external (unclassified) nodes in a separate column at the end', () => {
    // 'react' has no .ts extension so it won't match the catch-all usecase pattern
    const nodes = [node('src/domain/a.ts'), node('react')];
    const positions = computeArchLayerPositions(nodes);
    const externalPos = positions.get('react')!;
    const domainPos = positions.get('src/domain/a.ts')!;
    expect(externalPos).toBeDefined();
    expect(externalPos.x).toBeGreaterThan(domainPos.x);
  });

  it('uses archMapping to order layers when provided', () => {
    const nodes = [node('a.ts'), node('b.ts')];
    const archMapping = {
      repo: 'r',
      layers: [
        { id: 'layerA', label: 'A', order: 0, color: 'red', folderPatterns: [], filePatterns: [] },
        { id: 'layerB', label: 'B', order: 1, color: 'blue', folderPatterns: [], filePatterns: [] },
      ],
      files: { 'a.ts': 'layerA', 'b.ts': 'layerB' },
      overrides: {},
    };
    const positions = computeArchLayerPositions(nodes, archMapping as unknown as ArchMapping);
    expect(positions.size).toBe(2);
    expect(positions.get('a.ts')!.x).toBeLessThan(positions.get('b.ts')!.x);
  });

  it('runs barycentric ordering when second layer has 2+ nodes and edges exist', () => {
    // First layer: 1 domain node (sets previousLayerPositions)
    // Second layer: 2 data nodes — triggers orderNodesInLayer body (>1 node + populated previous positions)
    const nodes = [
      node('src/domain/a.ts'),
      node('src/cache/x.ts'),
      node('src/cache/y.ts'),
    ];
    const edges = [edge('src/domain/a.ts', 'src/cache/x.ts')];
    const positions = computeArchLayerPositions(nodes, undefined, edges);
    expect(positions.size).toBe(3);
    // Both cache nodes should share the same X (same layer column)
    expect(positions.get('src/cache/x.ts')!.x).toBe(positions.get('src/cache/y.ts')!.x);
  });
});

describe('detectArchViolations — safe libs', () => {
  it('reduces confidence for type-only imports (mightBeTypeImport path)', () => {
    const layerMap = new Map([['src/domain/a.ts', 'domain'], ['src/api/user.types.ts', 'interface']]);
    const edges = [edge('src/domain/a.ts', 'src/api/user.types.ts')];
    const layerOrder = ['application', 'interface', 'usecase', 'domain', 'entity', 'data', 'infrastructure'];
    const violations = detectArchViolations(edges, layerMap, layerOrder);
    const v = Array.from(violations.values()).find(x => x.type === 'reverse-dependency');
    // Type imports get confidence 0.3 → severity 'info'
    expect(v?.severity).toBe('info');
  });

  it('suppresses reverse-dependency flag for safe external lib imports', () => {
    const layerMap = new Map([['src/api/b.ts', 'interface'], ['lodash', 'external']]);
    const edges = [edge('src/domain/a.ts', 'lodash')];
    const violations = detectArchViolations(edges, layerMap);
    const rdViolations = Array.from(violations.values()).filter(v => v.type === 'reverse-dependency');
    expect(rdViolations.length).toBe(0);
  });

  it('suppresses reverse-dep for safe lib when external placed early in custom layer order', () => {
    // external at index 0 makes any import FROM external a reverse-dependency candidate
    const layerOrder = ['external', 'application', 'interface', 'domain'];
    const layerMap = new Map([['src/domain/a.ts', 'domain'], ['lodash', 'external']]);
    const edges = [edge('src/domain/a.ts', 'lodash')];
    const violations = detectArchViolations(edges, layerMap, layerOrder);
    const rdViolations = Array.from(violations.values()).filter(v => v.type === 'reverse-dependency');
    expect(rdViolations.length).toBe(0);
  });

  it('does not flag safe external library imports from core layers', () => {
    const layerMap = new Map([['src/domain/a.ts', 'domain'], ['date-fns', 'external']]);
    const edges = [edge('src/domain/a.ts', 'date-fns')];
    const violations = detectArchViolations(edges, layerMap);
    const extViolations = Array.from(violations.values()).filter(v => v.type === 'external-from-core');
    expect(extViolations.length).toBe(0);
  });

  it('flags non-safe external library imports from core layers', () => {
    // 'entity' is in the inner half so it qualifies as a core layer
    const layerMap = new Map([['src/entities/a.ts', 'entity'], ['my-vendor-lib', 'external']]);
    const edges = [edge('src/entities/a.ts', 'my-vendor-lib')];
    const layerOrder = ['application', 'interface', 'usecase', 'domain', 'entity', 'data', 'infrastructure'];
    const violations = detectArchViolations(edges, layerMap, layerOrder);
    const extViolations = Array.from(violations.values()).filter(v => v.type === 'external-from-core');
    expect(extViolations.length).toBeGreaterThan(0);
  });
});

describe('getLayerBands', () => {
  it('returns one band per non-empty layer', () => {
    const nodes = [node('src/domain/a.ts'), node('src/cache/b.ts')];
    const positions = computeArchLayerPositions(nodes);
    const layerMap = buildNodeLayerMap(nodes);
    const bands = getLayerBands(nodes, positions, layerMap);
    expect(bands.length).toBeGreaterThanOrEqual(2);
  });

  it('uses archMapping layer labels and colors when provided', () => {
    const archMapping = {
      repo: 'r',
      layers: [
        { id: 'layerA', label: 'Layer A', order: 0, color: 'rgba(255,0,0,0.1)', folderPatterns: [], filePatterns: [] },
        { id: 'layerB', label: 'Layer B', order: 1, color: 'rgba(0,0,255,0.1)', folderPatterns: [], filePatterns: [] },
      ],
      files: { 'a.ts': 'layerA', 'b.ts': 'layerB' },
      overrides: {},
    };
    const nodes = [node('a.ts'), node('b.ts')];
    const positions = computeArchLayerPositions(nodes, archMapping as unknown as ArchMapping);
    const layerMap = buildNodeLayerMap(nodes, archMapping as unknown as ArchMapping);
    const bands = getLayerBands(nodes, positions, layerMap, archMapping as unknown as ArchMapping);
    expect(bands.length).toBe(2);
    expect(bands[0].label).toBe('Layer A');
    expect(bands[0].color).toContain('255,0,0');
  });

  it('each band has distinct x (column layout)', () => {
    const nodes = [node('src/domain/a.ts'), node('src/cache/b.ts')];
    const positions = computeArchLayerPositions(nodes);
    const layerMap = buildNodeLayerMap(nodes);
    const bands = getLayerBands(nodes, positions, layerMap);
    const xs = bands.map(b => b.x);
    const uniqueXs = new Set(xs);
    expect(uniqueXs.size).toBe(bands.length);
  });

  it('all bands share the same minY and maxY (uniform column height)', () => {
    const nodes = [node('src/domain/a.ts'), node('src/cache/b.ts'), node('src/api/c.ts')];
    const positions = computeArchLayerPositions(nodes);
    const layerMap = buildNodeLayerMap(nodes);
    const bands = getLayerBands(nodes, positions, layerMap);
    const minYs = new Set(bands.map(b => b.minY));
    const maxYs = new Set(bands.map(b => b.maxY));
    expect(minYs.size).toBe(1);
    expect(maxYs.size).toBe(1);
  });
});

describe('detectArchViolations — explicit connections', () => {
  const layerOrder = ['a', 'b', 'c'];

  it('treats only explicit connections as allowed (no implicit transitivity)', () => {
    const layerMap = new Map([['file-a.ts', 'a'], ['file-b.ts', 'b'], ['file-c.ts', 'c']]);
    const connections = [{ from: 'a', to: 'c' }];
    // a→c is allowed; a→b is NOT (no implicit transitivity)
    const allowed = detectArchViolations([edge('file-a.ts', 'file-c.ts')], layerMap, layerOrder, connections);
    const blocked = detectArchViolations([edge('file-a.ts', 'file-b.ts')], layerMap, layerOrder, connections);
    expect(allowed.size).toBe(0);
    expect(blocked.size).toBeGreaterThan(0);
  });

  it('falls back to order-derived transitive when connections is undefined', () => {
    const layerMap = new Map([['file-a.ts', 'a'], ['file-b.ts', 'b']]);
    // a → b is allowed by order (a is outer, b is inner)
    const violations = detectArchViolations([edge('file-a.ts', 'file-b.ts')], layerMap, layerOrder);
    expect(violations.size).toBe(0);
  });

  it('falls back to order-derived when connections is empty array', () => {
    const layerMap = new Map([['file-a.ts', 'a'], ['file-b.ts', 'b']]);
    const violations = detectArchViolations([edge('file-a.ts', 'file-b.ts')], layerMap, layerOrder, []);
    expect(violations.size).toBe(0);
  });

  it('always allows same-layer dependencies regardless of connections', () => {
    const layerMap = new Map([['x.ts', 'a'], ['y.ts', 'a']]);
    const violations = detectArchViolations([edge('x.ts', 'y.ts')], layerMap, layerOrder, []);
    expect(violations.size).toBe(0);
  });
});

describe('computeArchLayerPositions — grid wrap', () => {
  it('keeps small layers (≤4) as a 1-wide stack', () => {
    const nodes = [
      node('src/domain/a.ts'), node('src/domain/b.ts'),
      node('src/domain/c.ts'), node('src/domain/d.ts'),
    ];
    const positions = computeArchLayerPositions(nodes);
    const xs = new Set(nodes.map(n => positions.get(n.id)!.x));
    expect(xs.size).toBe(1); // all share the same X
  });

  it('wraps large layers (>4) into multiple columns within the same container', () => {
    const nodes = Array.from({ length: 9 }, (_, i) => node(`src/domain/n${i}.ts`));
    const positions = computeArchLayerPositions(nodes);
    const xs = new Set(nodes.map(n => positions.get(n.id)!.x));
    expect(xs.size).toBeGreaterThan(1);
    expect(xs.size).toBeLessThanOrEqual(4); // capped at MAX_INNER_COLS
  });

  it('caps inner columns at 4 even for very large layers', () => {
    const nodes = Array.from({ length: 40 }, (_, i) => node(`src/domain/n${i}.ts`));
    const positions = computeArchLayerPositions(nodes);
    const xs = new Set(nodes.map(n => positions.get(n.id)!.x));
    expect(xs.size).toBeLessThanOrEqual(4);
  });
});

describe('getViolationSourceNodes', () => {
  it('returns empty set when no violations', () => {
    const sources = getViolationSourceNodes(new Map());
    expect(sources.size).toBe(0);
  });

  it('returns source node IDs from violations', () => {
    const layerMap = new Map([['src/domain/a.ts', 'domain'], ['src/api/b.ts', 'interface']]);
    const edges = [edge('src/domain/a.ts', 'src/api/b.ts')];
    const violations = detectArchViolations(edges, layerMap, ['application', 'interface', 'usecase', 'domain', 'entity', 'data', 'infrastructure']);
    const sources = getViolationSourceNodes(violations);
    expect(sources.has('src/domain/a.ts')).toBe(true);
  });

  it('returns multiple source nodes for multiple violations', () => {
    const layerMap = new Map([
      ['src/domain/a.ts', 'domain'], ['src/api/b.ts', 'interface'],
      ['src/domain/c.ts', 'domain'], ['src/app/d.ts', 'application'],
    ]);
    const edges = [
      edge('src/domain/a.ts', 'src/api/b.ts'),
      edge('src/domain/c.ts', 'src/app/d.ts'),
    ];
    const violations = detectArchViolations(edges, layerMap, ['application', 'interface', 'usecase', 'domain', 'entity', 'data', 'infrastructure']);
    const sources = getViolationSourceNodes(violations);
    expect(sources.size).toBe(2);
    expect(sources.has('src/domain/a.ts')).toBe(true);
    expect(sources.has('src/domain/c.ts')).toBe(true);
  });
});
