import { renderHook, act } from '@testing-library/react';
import { useGraphData } from './useGraphData';
import { GraphData, GraphNode, GraphEdge } from '../types';

// The hook composes useWebSocketConnection + useExcludePatterns.
// Rather than mocking internal module imports (which would couple to implementation),
// we mock the sub-hooks at the module level. This tests the public API surface.

jest.mock('./useWebSocketConnection', () => ({
  useWebSocketConnection: jest.fn(),
}));

jest.mock('./useExcludePatterns', () => ({
  useExcludePatterns: jest.fn(),
}));

import { useWebSocketConnection } from './useWebSocketConnection';
import { useExcludePatterns } from './useExcludePatterns';

const mockUseWebSocketConnection = useWebSocketConnection as jest.Mock;
const mockUseExcludePatterns = useExcludePatterns as jest.Mock;

const makeNode = (id: string): GraphNode => ({
  id,
  label: id.split('/').pop() || id,
  type: 'typescript',
  rating: 8,
  size: 1,
  violations: [],
  metrics: { linesOfCode: 50, cyclomaticComplexity: 1, numberOfMethods: 1, numberOfClasses: 0, importCount: 0 },
});

const sampleGraphData: GraphData = {
  nodes: [makeNode('/src/a.ts'), makeNode('/src/b.ts')],
  edges: [{ source: '/src/a.ts', target: '/src/b.ts', type: 'imports', strength: 1 }],
};

const filteredGraphData: GraphData = {
  nodes: [makeNode('/src/a.ts')],
  edges: [],
};

const sampleWsReturn = {
  graphData: sampleGraphData,
  wsStatus: 'connected' as const,
  scanProgress: { analyzed: 5, total: 10 },
  scanningRef: { current: false },
  scanning: false,
  setScanning: jest.fn(),
  lastScan: { fileCount: 2, ts: Date.now() },
  setLastScan: jest.fn(),
  handleScanAll: jest.fn(),
  repoLoading: false,
};

const sampleExcludeReturn = {
  filteredGraphData,
  patterns: [{ id: 1, pattern: 'node_modules/*', label: 'NM' }],
  addPattern: jest.fn(),
  removePattern: jest.fn(),
  scanExcludePatterns: { global: ['node_modules/*'], csharp: [], typescript: [] },
};

beforeEach(() => {
  mockUseWebSocketConnection.mockReturnValue(sampleWsReturn);
  mockUseExcludePatterns.mockReturnValue(sampleExcludeReturn);
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('useGraphData', () => {
  it('returns combined public API surface', () => {
    const { result } = renderHook(() => useGraphData('/project/repo'));

    // From useWebSocketConnection
    expect(result.current.graphData).toBe(sampleGraphData);
    expect(result.current.wsStatus).toBe('connected');
    expect(result.current.scanProgress).toEqual({ analyzed: 5, total: 10 });
    expect(result.current.scanning).toBe(false);
    expect(result.current.lastScan).not.toBeNull();

    // From useExcludePatterns
    expect(result.current.filteredGraphData).toBe(filteredGraphData);
    expect(result.current.patterns).toHaveLength(1);
    expect(result.current.scanExcludePatterns).not.toBeNull();
  });

  it('passes selectedRepo and onRepoCreated to useWebSocketConnection', () => {
    const onRepoCreated = jest.fn();
    renderHook(() => useGraphData('/project/repo', onRepoCreated));

    expect(mockUseWebSocketConnection).toHaveBeenCalledWith(
      '/project/repo',
      onRepoCreated,
    );
  });

  it('passes selectedRepo and graphData to useExcludePatterns', () => {
    renderHook(() => useGraphData('/project/repo'));

    expect(mockUseExcludePatterns).toHaveBeenCalledWith(
      '/project/repo',
      sampleGraphData,
    );
  });

  it('exposes function references from sub-hooks', () => {
    const { result } = renderHook(() => useGraphData('/project/repo'));

    expect(typeof result.current.addPattern).toBe('function');
    expect(typeof result.current.removePattern).toBe('function');
    expect(typeof result.current.setScanning).toBe('function');
    expect(typeof result.current.setLastScan).toBe('function');
    expect(typeof result.current.handleScanAll).toBe('function');
  });

  it('updates when selectedRepo changes', () => {
    const { rerender } = renderHook(
      (repo: string | null) => useGraphData(repo),
      { initialProps: '/project/repo' as string | null },
    );

    expect(mockUseWebSocketConnection).toHaveBeenCalledWith('/project/repo', undefined);
    expect(mockUseExcludePatterns).toHaveBeenCalledWith('/project/repo', sampleGraphData);

    mockUseWebSocketConnection.mockClear();
    mockUseExcludePatterns.mockClear();

    rerender('/project/other');

    expect(mockUseWebSocketConnection).toHaveBeenCalledWith('/project/other', undefined);
    expect(mockUseExcludePatterns).toHaveBeenCalledWith('/project/other', sampleGraphData);
  });

  it('works with null selectedRepo', () => {
    mockUseWebSocketConnection.mockReturnValue({
      ...sampleWsReturn,
      graphData: { nodes: [], edges: [] },
    });
    mockUseExcludePatterns.mockReturnValue({
      ...sampleExcludeReturn,
      filteredGraphData: { nodes: [], edges: [] },
      patterns: [],
    });

    const { result } = renderHook(() => useGraphData(null));

    expect(result.current.graphData).toEqual({ nodes: [], edges: [] });
    expect(result.current.filteredGraphData).toEqual({ nodes: [], edges: [] });
    expect(result.current.patterns).toEqual([]);
  });

  it('propagates repoLoading state', () => {
    mockUseWebSocketConnection.mockReturnValue({
      ...sampleWsReturn,
      repoLoading: true,
    });

    const { result } = renderHook(() => useGraphData('/project/repo'));

    expect(result.current.repoLoading).toBe(true);
  });

  it('propagates scanProgress null state', () => {
    mockUseWebSocketConnection.mockReturnValue({
      ...sampleWsReturn,
      scanProgress: null,
    });

    const { result } = renderHook(() => useGraphData('/project/repo'));

    expect(result.current.scanProgress).toBeNull();
  });
});
