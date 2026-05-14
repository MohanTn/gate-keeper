import * as fs from 'fs';
import * as path from 'path';
import { loadGlobalGraph, saveGlobalGraph, indexRepo, queryGlobalGraph, getGlobalGraphPath } from './global-graph';

/**
 * Tests are run as isolated serial scenarios.
 * We clean the global-graph file before each test by deleting it
 * from wherever the module resolves it to.
 */
const GK_FILE = getGlobalGraphPath(); // resolves at import time — this is the real one

beforeEach(() => {
  try { fs.unlinkSync(GK_FILE); } catch { /* file may not exist — ok */ }
});

describe('loadGlobalGraph', () => {
  it('returns empty graph when file missing', () => {
    const g = loadGlobalGraph();
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
    expect(g.repos).toEqual([]);
  });
});

describe('saveGlobalGraph and load', () => {
  it('round-trips data correctly', () => {
    const data = {
      version: '1.0', generatedAt: Date.now(),
      repos: [{ path: '/a', label: 'repo-a', lastIndexedAt: Date.now(), nodeCount: 5 }],
      nodes: [{ id: '/a/src/main.ts', label: 'main.ts', rating: 8 }],
      edges: [{ source: '/a/src/main.ts', target: '/a/src/lib.ts' }],
      crossRepoImports: [],
    };
    saveGlobalGraph(data);
    const loaded = loadGlobalGraph();
    expect(loaded.repos).toHaveLength(1);
    expect(loaded.nodes).toHaveLength(1);
  });
});

describe('indexRepo', () => {
  it('adds a repo to the global index', () => {
    const result = indexRepo('/test-repo', 'test-repo', [
      { id: 'src/a.ts', label: 'a.ts', rating: 8 },
    ], []);
    expect(result.added).toBe(1);
  });

  it('prefixes node IDs to avoid collision', () => {
    // Same node name in two repos should coexist
    indexRepo('/repo-a', 'repoA', [
      { id: 'src/shared.ts', label: 'shared.ts', rating: 8 },
    ], []);
    indexRepo('/repo-b', 'repoB', [
      { id: 'src/shared.ts', label: 'shared.ts', rating: 9 },
    ], []);

    const g = loadGlobalGraph();
    const ids = g.nodes.map(n => n.id);
    // Both should exist (prefixed differently)
    expect(ids.filter(id => id.includes('shared.ts'))).toHaveLength(2);
  });
});

describe('queryGlobalGraph', () => {
  it('returns repo count for "how many repos" (seeds data first)', () => {
    indexRepo('/test', 'test-repo', [{ id: 'a.ts', label: 'a.ts', rating: 8 }], []);
    indexRepo('/test2', 'test2', [{ id: 'b.ts', label: 'b.ts', rating: 9 }], []);
    const result = queryGlobalGraph('how many repos');
    expect(result.answer).toContain('repos');
  });

  it('returns worst nodes for "worst" (seeds data first)', () => {
    indexRepo('/t', 't', [{ id: 'x.ts', label: 'x.ts', rating: 4 }], []);
    indexRepo('/t2', 't2', [{ id: 'y.ts', label: 'y.ts', rating: 9 }], []);
    const result = queryGlobalGraph('worst');
    expect(result.answer).toContain('4/10');
  });
});

describe('getGlobalGraphPath', () => {
  it('returns a path string', () => {
    const p = getGlobalGraphPath();
    expect(typeof p).toBe('string');
    expect(p).toContain('.gate-keeper');
  });
});
