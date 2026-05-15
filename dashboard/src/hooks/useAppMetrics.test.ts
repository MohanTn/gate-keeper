import { renderHook } from '@testing-library/react';
import { useAppMetrics } from './useAppMetrics';
import { GraphData, RepoInfo, GraphNode } from '../types';

const makeNode = (overrides: Partial<GraphNode> & { id: string }): GraphNode => ({
  label: overrides.id,
  type: 'typescript',
  rating: 8,
  size: 1,
  violations: [],
  metrics: { linesOfCode: 100, cyclomaticComplexity: 1, numberOfMethods: 1, numberOfClasses: 0, importCount: 0 },
  ...overrides,
});

describe('useAppMetrics', () => {
  const repos: RepoInfo[] = [
    { repoRoot: '/project/a', label: 'Project A', fileCount: 10 },
    { repoRoot: '/project/b', label: null as unknown as string, fileCount: 5 },
  ];

  const emptyGraph: GraphData = { nodes: [], edges: [] };

  it('totalViolations sums all violations across nodes', () => {
    const graph: GraphData = {
      nodes: [
        makeNode({ id: '/a.ts', violations: [{ type: 'E1', severity: 'error', message: 'err' }, { type: 'W1', severity: 'warning', message: 'warn' }] }),
        makeNode({ id: '/b.ts', violations: [{ type: 'E2', severity: 'error', message: 'err2' }] }),
        makeNode({ id: '/c.ts', violations: [] }),
      ],
      edges: [],
    };

    const { result } = renderHook(() => useAppMetrics(graph, null, repos, null));

    expect(result.current.totalViolations).toBe(3);
  });

  it('totalViolations is 0 when there are no nodes', () => {
    const { result } = renderHook(() => useAppMetrics(emptyGraph, null, repos, null));

    expect(result.current.totalViolations).toBe(0);
  });

  it('overallRating is LOC-weighted average', () => {
    const graph: GraphData = {
      nodes: [
        makeNode({ id: '/a.ts', rating: 8, metrics: { linesOfCode: 100, cyclomaticComplexity: 1, numberOfMethods: 1, numberOfClasses: 0, importCount: 0 } }),
        makeNode({ id: '/b.ts', rating: 10, metrics: { linesOfCode: 0, cyclomaticComplexity: 1, numberOfMethods: 1, numberOfClasses: 0, importCount: 0 } }),
      ],
      edges: [],
    };

    const { result } = renderHook(() => useAppMetrics(graph, null, repos, null));

    // LOC total = 100 + 1 (min) = 101
    // Weighted = (8*100 + 10*1) / 101 = 810/101 ≈ 8.019... ≈ 8.0
    expect(result.current.overallRating).toBeCloseTo(8.0, 1);
  });

  it('overallRating is null for empty graph', () => {
    const { result } = renderHook(() => useAppMetrics(emptyGraph, null, repos, null));

    expect(result.current.overallRating).toBeNull();
  });

  it('currentRepoLabel resolves from repos array', () => {
    const { result } = renderHook(() =>
      useAppMetrics(emptyGraph, '/project/a', repos, null),
    );

    expect(result.current.currentRepoLabel).toBe('Project A');
  });

  it('currentRepoLabel falls back to last path segment when no label match', () => {
    const { result } = renderHook(() =>
      useAppMetrics(emptyGraph, '/some/unknown/path', repos, null),
    );

    expect(result.current.currentRepoLabel).toBe('path');
  });

  it('currentRepoLabel is null when selectedRepo is null', () => {
    const { result } = renderHook(() => useAppMetrics(emptyGraph, null, repos, null));

    expect(result.current.currentRepoLabel).toBeNull();
  });

  it('scanPct calculates percentage', () => {
    const { result } = renderHook(() =>
      useAppMetrics(emptyGraph, null, repos, { analyzed: 25, total: 100 }),
    );

    expect(result.current.scanPct).toBe(25);
  });

  it('scanPct rounds to nearest integer', () => {
    const { result } = renderHook(() =>
      useAppMetrics(emptyGraph, null, repos, { analyzed: 1, total: 3 }),
    );

    expect(result.current.scanPct).toBe(33);
  });

  it('scanPct is null when scanProgress is null', () => {
    const { result } = renderHook(() => useAppMetrics(emptyGraph, null, repos, null));

    expect(result.current.scanPct).toBeNull();
  });

  it('scanPct is null when total is 0', () => {
    const { result } = renderHook(() =>
      useAppMetrics(emptyGraph, null, repos, { analyzed: 0, total: 0 }),
    );

    expect(result.current.scanPct).toBeNull();
  });

  it('handles all null/empty inputs gracefully', () => {
    const { result } = renderHook(() =>
      useAppMetrics(emptyGraph, null, [], null),
    );

    expect(result.current.totalViolations).toBe(0);
    expect(result.current.overallRating).toBeNull();
    expect(result.current.currentRepoLabel).toBeNull();
    expect(result.current.scanPct).toBeNull();
  });
});
