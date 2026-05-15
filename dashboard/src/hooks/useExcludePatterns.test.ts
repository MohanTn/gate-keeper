import { renderHook, act, waitFor } from '@testing-library/react';
import { useExcludePatterns } from './useExcludePatterns';
import { GraphData, GraphNode, GraphEdge, ExcludePattern } from '../types';

// Import the module to access the exported globToRegex function
// Since globToRegex is not exported, we test it through the public API

function mockFetchResponse(data: unknown, ok = true) {
  return Promise.resolve({
    ok,
    json: () => Promise.resolve(data),
  } as Response);
}

const makeNode = (id: string): GraphNode => ({
  id,
  label: id.split('/').pop() || id,
  type: 'typescript',
  rating: 8,
  size: 1,
  violations: [],
  metrics: { linesOfCode: 50, cyclomaticComplexity: 1, numberOfMethods: 1, numberOfClasses: 0, importCount: 0 },
});

const sampleNodes: GraphNode[] = [
  makeNode('/src/index.ts'),
  makeNode('/src/app.ts'),
  makeNode('/src/components/Button.tsx'),
  makeNode('/src/utils/helper.ts'),
  makeNode('/node_modules/foo/index.js'),
  makeNode('/dist/bundle.js'),
];

const sampleEdges: GraphEdge[] = [
  { source: '/src/index.ts', target: '/src/app.ts', type: 'imports', strength: 1 },
  { source: '/src/app.ts', target: '/src/components/Button.tsx', type: 'imports', strength: 1 },
  { source: '/src/utils/helper.ts', target: '/src/app.ts', type: 'imports', strength: 1 },
];

const sampleGraphData: GraphData = { nodes: sampleNodes, edges: sampleEdges };

beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('useExcludePatterns', () => {
  it('loads patterns on mount', async () => {
    const patterns: ExcludePattern[] = [
      { id: 1, pattern: 'node_modules/*', label: 'Node modules' },
    ];

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockFetchResponse(patterns))
      .mockResolvedValueOnce(mockFetchResponse({ scanExcludePatterns: null }));

    const { result } = renderHook(() =>
      useExcludePatterns('/project', sampleGraphData),
    );

    await waitFor(() => {
      expect(result.current.patterns).toEqual(patterns);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/exclude-patterns?repo=' + encodeURIComponent('/project'),
    );
  });

  it('loads scan exclude patterns on mount', async () => {
    const scanExclude = { global: ['node_modules/*'], csharp: ['bin/'], typescript: ['dist/'] };

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockFetchResponse([]))
      .mockResolvedValueOnce(mockFetchResponse({ scanExcludePatterns: scanExclude }));

    const { result } = renderHook(() =>
      useExcludePatterns('/project', sampleGraphData),
    );

    await waitFor(() => {
      expect(result.current.scanExcludePatterns).toEqual(scanExclude);
    });
  });

  it('handles null scan exclude patterns response', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockFetchResponse([]))
      .mockResolvedValueOnce(mockFetchResponse({}));

    const { result } = renderHook(() =>
      useExcludePatterns('/project', sampleGraphData),
    );

    await waitFor(() => {
      expect(result.current.scanExcludePatterns).toBeNull();
    });
  });

  it('resets patterns to empty when selectedRepo is null', () => {
    // scan-config effect still fires regardless of selectedRepo
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockFetchResponse({ scanExcludePatterns: null }),
    );

    const { result } = renderHook(() =>
      useExcludePatterns(null, sampleGraphData),
    );

    expect(result.current.patterns).toEqual([]);
  });

  it('addPattern adds and reloads', async () => {
    const existingPatterns: ExcludePattern[] = [
      { id: 1, pattern: 'node_modules/*', label: 'Node modules' },
    ];

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockFetchResponse(existingPatterns))
      .mockResolvedValueOnce(mockFetchResponse({ scanExcludePatterns: null }))
      // addPattern POST
      .mockResolvedValueOnce(mockFetchResponse({ ok: true }))
      // reload fetch
      .mockResolvedValueOnce(mockFetchResponse([
        ...existingPatterns,
        { id: 2, pattern: 'dist/*', label: 'Dist' },
      ]));

    const { result } = renderHook(() =>
      useExcludePatterns('/project', sampleGraphData),
    );

    // Wait for initial load
    await waitFor(() => {
      expect(result.current.patterns).toHaveLength(1);
    });

    await act(async () => {
      await result.current.addPattern('dist/*', 'Dist');
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/exclude-patterns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: '/project', pattern: 'dist/*', label: 'Dist' }),
    });

    // After reload, patterns should include the new one
    await waitFor(() => {
      expect(result.current.patterns).toHaveLength(2);
    });
  });

  it('addPattern ignores empty pattern', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockFetchResponse([]))
      .mockResolvedValueOnce(mockFetchResponse({ scanExcludePatterns: null }));

    const { result } = renderHook(() =>
      useExcludePatterns('/project', sampleGraphData),
    );

    await waitFor(() => {
      expect(result.current.patterns).toEqual([]);
    });

    await act(async () => {
      await result.current.addPattern('', 'Empty');
    });

    // fetch should not have been called for addPattern
    const addCalls = (global.fetch as jest.Mock).mock.calls.filter(
      (c: [string, RequestInit?]) => c[0] === '/api/exclude-patterns' && c[1]?.method === 'POST',
    );
    expect(addCalls).toHaveLength(0);
  });

  it('removePattern removes and reloads', async () => {
    const patterns: ExcludePattern[] = [
      { id: 1, pattern: 'node_modules/*', label: 'NM' },
      { id: 2, pattern: 'dist/*', label: 'Dist' },
    ];

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockFetchResponse(patterns))
      .mockResolvedValueOnce(mockFetchResponse({ scanExcludePatterns: null }))
      // DELETE
      .mockResolvedValueOnce(mockFetchResponse({ ok: true }))
      // reload
      .mockResolvedValueOnce(mockFetchResponse([patterns[1]]));

    const { result } = renderHook(() =>
      useExcludePatterns('/project', sampleGraphData),
    );

    await waitFor(() => {
      expect(result.current.patterns).toHaveLength(2);
    });

    await act(async () => {
      await result.current.removePattern(1);
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/exclude-patterns/1', {
      method: 'DELETE',
    });

    await waitFor(() => {
      expect(result.current.patterns).toHaveLength(1);
      expect(result.current.patterns[0].id).toBe(2);
    });
  });

  it('filteredGraphData returns full graph when no patterns', () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockFetchResponse([]))
      .mockResolvedValueOnce(mockFetchResponse({ scanExcludePatterns: null }));

    const { result } = renderHook(() =>
      useExcludePatterns('/project', sampleGraphData),
    );

    expect(result.current.filteredGraphData).toEqual(sampleGraphData);
  });

  it('filteredGraphData excludes nodes matching patterns', async () => {
    const patterns: ExcludePattern[] = [
      { id: 1, pattern: 'node_modules/*', label: 'NM' },
    ];

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockFetchResponse(patterns))
      .mockResolvedValueOnce(mockFetchResponse({ scanExcludePatterns: null }));

    const { result } = renderHook(() =>
      useExcludePatterns('/project', sampleGraphData),
    );

    await waitFor(() => {
      expect(result.current.filteredGraphData.nodes).toHaveLength(
        sampleNodes.length - 1, // excludes /node_modules/foo/index.js
      );
    });

    const filteredNodeIds = result.current.filteredGraphData.nodes.map(n => n.id);
    expect(filteredNodeIds).not.toContain('/node_modules/foo/index.js');
    expect(filteredNodeIds).toContain('/src/index.ts');
  });

  it('filteredGraphData preserves edges between non-excluded nodes', async () => {
    const patterns: ExcludePattern[] = [
      { id: 1, pattern: 'node_modules/*', label: 'NM' },
      { id: 2, pattern: 'dist/*', label: 'Dist' },
    ];

    // node_modules/foo and dist/bundle.js should be excluded
    // All sample edges are between src/ files, so they should be preserved

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockFetchResponse(patterns))
      .mockResolvedValueOnce(mockFetchResponse({ scanExcludePatterns: null }));

    const { result } = renderHook(() =>
      useExcludePatterns('/project', sampleGraphData),
    );

    await waitFor(() => {
      expect(result.current.patterns).toHaveLength(2);
    });

    // All edges are between src/ files, none should be removed
    expect(result.current.filteredGraphData.edges).toEqual(sampleEdges);
  });

  it('filteredGraphData excludes edges connected to excluded nodes', async () => {
    const graphWithNodeModulesEdge: GraphData = {
      nodes: sampleNodes,
      edges: [
        ...sampleEdges,
        { source: '/src/app.ts', target: '/node_modules/foo/index.js', type: 'imports', strength: 1 },
      ],
    };

    const patterns: ExcludePattern[] = [
      { id: 1, pattern: 'node_modules/*', label: 'NM' },
    ];

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockFetchResponse(patterns))
      .mockResolvedValueOnce(mockFetchResponse({ scanExcludePatterns: null }));

    const { result } = renderHook(() =>
      useExcludePatterns('/project', graphWithNodeModulesEdge),
    );

    await waitFor(() => {
      expect(result.current.patterns).toHaveLength(1);
    });

    // Edge to node_modules should be removed
    expect(result.current.filteredGraphData.edges).toHaveLength(3);
    expect(result.current.filteredGraphData.edges.every(
      e => {
        const s = typeof e.source === 'string' ? e.source : e.source?.id;
        const t = typeof e.target === 'string' ? e.target : e.target?.id;
        return !s?.includes('node_modules') && !t?.includes('node_modules');
      },
    )).toBe(true);
  });

  it('handles fetch failure for loading patterns', async () => {
    (global.fetch as jest.Mock)
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(mockFetchResponse({ scanExcludePatterns: null }));

    const { result } = renderHook(() =>
      useExcludePatterns('/project', sampleGraphData),
    );

    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });

    expect(result.current.patterns).toEqual([]);
  });

  it('handles non-array pattern response', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockFetchResponse({ not: 'an array' }))
      .mockResolvedValueOnce(mockFetchResponse({ scanExcludePatterns: null }));

    const { result } = renderHook(() =>
      useExcludePatterns('/project', sampleGraphData),
    );

    await waitFor(() => {
      expect(result.current.patterns).toEqual([]);
    });
  });

  it('globToRegex works for * patterns (tested via filtering)', async () => {
    const patterns: ExcludePattern[] = [
      { id: 1, pattern: '*.js', label: 'JS files' },
    ];

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockFetchResponse(patterns))
      .mockResolvedValueOnce(mockFetchResponse({ scanExcludePatterns: null }));

    const { result } = renderHook(() =>
      useExcludePatterns('/project', sampleGraphData),
    );

    await waitFor(() => {
      expect(result.current.patterns).toHaveLength(1);
    });

    // *.js should match dist/bundle.js and node_modules/foo/index.js (by basename)
    // and also /node_modules/foo/index.js (by full path)
    const filteredIds = result.current.filteredGraphData.nodes.map(n => n.id);
    expect(filteredIds).not.toContain('/dist/bundle.js');
  });

  it('filteredGraphData is unchanged when no patterns match', async () => {
    const patterns: ExcludePattern[] = [
      { id: 1, pattern: 'nonexistent_pattern_xyz/*', label: 'No match' },
    ];

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockFetchResponse(patterns))
      .mockResolvedValueOnce(mockFetchResponse({ scanExcludePatterns: null }));

    const { result } = renderHook(() =>
      useExcludePatterns('/project', sampleGraphData),
    );

    await waitFor(() => {
      expect(result.current.patterns).toHaveLength(1);
    });

    // All nodes should remain
    expect(result.current.filteredGraphData.nodes).toHaveLength(sampleNodes.length);
  });
});
