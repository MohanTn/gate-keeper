import { findSurprisingConnections, getModule } from './surprising-connections';

const REPO = '/repo';

const nodes = [
  { id: '/repo/src/auth/service.ts' },
  { id: '/repo/src/auth/guard.ts' },
  { id: '/repo/src/database/pool.ts' },
  { id: '/repo/src/database/query.ts' },
  { id: '/repo/src/utils/logger.ts' },
  { id: '/repo/root-file.ts' },
];

describe('getModule', () => {
  it('skips common src prefix and returns sub-directory', () => {
    expect(getModule('/repo/src/auth/service.ts', REPO)).toBe('auth');
  });

  it('returns (root) for top-level files', () => {
    expect(getModule('/repo/root-file.ts', REPO)).toBe('(root)');
  });
});

describe('findSurprisingConnections', () => {
  it('excludes same-module edges', () => {
    const edges = [
      { source: '/repo/src/auth/service.ts', target: '/repo/src/auth/guard.ts' },
    ];
    const results = findSurprisingConnections(nodes, edges, REPO);
    expect(results).toHaveLength(0);
  });

  it('includes cross-module edges', () => {
    const edges = [
      { source: '/repo/src/auth/service.ts', target: '/repo/src/database/pool.ts' },
    ];
    const results = findSurprisingConnections(nodes, edges, REPO);
    expect(results).toHaveLength(1);
    // getModule skips the common 'src' prefix → returns the sub-directory names
    expect(results[0]!.sourceModule).toBe('auth');
    expect(results[0]!.targetModule).toBe('database');
  });

  it('scores rare cross-module edges higher', () => {
    const edges = [
      { source: '/repo/src/auth/service.ts', target: '/repo/src/database/pool.ts' },
      { source: '/repo/src/auth/guard.ts', target: '/repo/src/database/pool.ts' },
      { source: '/repo/src/auth/service.ts', target: '/repo/src/utils/logger.ts' },
    ];
    // auth→database appears twice; auth→utils appears once → utils edge should score higher
    const results = findSurprisingConnections(nodes, edges, REPO);
    const utilsEdge = results.find(r => r.target === '/repo/src/utils/logger.ts');
    const dbEdge = results.find(r => r.target === '/repo/src/database/pool.ts' && r.source === '/repo/src/auth/service.ts');
    expect(utilsEdge).toBeDefined();
    expect(dbEdge).toBeDefined();
    expect(utilsEdge!.score).toBeGreaterThan(dbEdge!.score);
  });

  it('respects topN limit', () => {
    const edges = [
      { source: '/repo/src/auth/service.ts', target: '/repo/src/database/pool.ts' },
      { source: '/repo/src/auth/service.ts', target: '/repo/src/database/query.ts' },
      { source: '/repo/src/auth/guard.ts', target: '/repo/src/utils/logger.ts' },
    ];
    const results = findSurprisingConnections(nodes, edges, REPO, 2);
    expect(results).toHaveLength(2);
  });

  it('returns empty for empty edges', () => {
    expect(findSurprisingConnections(nodes, [], REPO)).toHaveLength(0);
  });

  it('returns empty for single-module graph', () => {
    const singleModuleNodes = [
      { id: '/repo/auth/a.ts' },
      { id: '/repo/auth/b.ts' },
    ];
    const edges = [{ source: '/repo/auth/a.ts', target: '/repo/auth/b.ts' }];
    expect(findSurprisingConnections(singleModuleNodes, edges, REPO)).toHaveLength(0);
  });

  it('deduplicates same source→target entries', () => {
    const edges = [
      { source: '/repo/src/auth/service.ts', target: '/repo/src/database/pool.ts' },
      { source: '/repo/src/auth/service.ts', target: '/repo/src/database/pool.ts' },
    ];
    const results = findSurprisingConnections(nodes, edges, REPO);
    expect(results).toHaveLength(1);
  });

  it('skips edges with unknown nodes', () => {
    const edges = [
      { source: '/repo/unknown/x.ts', target: '/repo/src/auth/service.ts' },
    ];
    const results = findSurprisingConnections(nodes, edges, REPO);
    expect(results).toHaveLength(0);
  });
});
