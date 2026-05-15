import { renderHook, act } from '@testing-library/react';
import { usePanelActions } from './usePanelActions';
import { GraphData, GraphNode, RepoInfo } from '../types';

// Mock useClearData
jest.mock('./useClearData', () => ({
  useClearData: jest.fn(),
}));

import { useClearData } from './useClearData';
const mockUseClearData = useClearData as jest.Mock;

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
  edges: [],
};

const repos: RepoInfo[] = [
  { repoRoot: '/project/repo', label: 'My Repo', fileCount: 10 },
];

describe('usePanelActions', () => {
  const handleClearSelection = jest.fn();
  const handleNodeSelect = jest.fn();
  const setShowRepoSelector = jest.fn();
  const setScanning = jest.fn();
  const setLastScan = jest.fn();
  const handleClearFn = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    // Mock Date.now for setLastScan timing
    jest.spyOn(Date, 'now').mockReturnValue(1000);
    mockUseClearData.mockReturnValue(handleClearFn);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('initial state: all panels closed', () => {
    const { result } = renderHook(() =>
      usePanelActions(
        handleClearSelection,
        handleNodeSelect,
        setShowRepoSelector,
        sampleGraphData,
        setScanning,
        setLastScan,
        '/project/repo',
        repos,
      ),
    );

    expect(result.current.showFileList).toBe(false);
    expect(result.current.showFilterPanel).toBe(false);
    expect(result.current.showViolationsPanel).toBe(false);
  });

  it('sets lastScan on mount based on filteredGraphData nodes length', () => {
    renderHook(() =>
      usePanelActions(
        handleClearSelection,
        handleNodeSelect,
        setShowRepoSelector,
        sampleGraphData,
        setScanning,
        setLastScan,
        '/project/repo',
        repos,
      ),
    );

    expect(setLastScan).toHaveBeenCalledWith({ fileCount: 2, ts: 1000 });
  });

  it('handleShowRepoSelector calls setShowRepoSelector(true)', () => {
    const { result } = renderHook(() =>
      usePanelActions(
        handleClearSelection,
        handleNodeSelect,
        setShowRepoSelector,
        sampleGraphData,
        setScanning,
        setLastScan,
        '/project/repo',
        repos,
      ),
    );

    act(() => {
      result.current.handleShowRepoSelector();
    });

    expect(setShowRepoSelector).toHaveBeenCalledWith(true);
  });

  it('handleFileListOpen opens file list, closes others, clears selection', () => {
    const { result } = renderHook(() =>
      usePanelActions(
        handleClearSelection,
        handleNodeSelect,
        setShowRepoSelector,
        sampleGraphData,
        setScanning,
        setLastScan,
        '/project/repo',
        repos,
      ),
    );

    // First open filter panel
    act(() => {
      result.current.handleToggleFilterPanel();
    });
    expect(result.current.showFilterPanel).toBe(true);

    // Now open file list
    act(() => {
      result.current.handleFileListOpen();
    });

    expect(result.current.showFileList).toBe(true);
    expect(result.current.showFilterPanel).toBe(false);
    expect(result.current.showViolationsPanel).toBe(false);
    expect(handleClearSelection).toHaveBeenCalled();
  });

  it('handleFileListSelect selects node and closes file list', () => {
    const { result } = renderHook(() =>
      usePanelActions(
        handleClearSelection,
        handleNodeSelect,
        setShowRepoSelector,
        sampleGraphData,
        setScanning,
        setLastScan,
        '/project/repo',
        repos,
      ),
    );

    // Open file list first
    act(() => {
      result.current.handleFileListOpen();
    });
    expect(result.current.showFileList).toBe(true);

    // Select a node
    const node = makeNode('/src/a.ts');
    act(() => {
      result.current.handleFileListSelect(node);
    });

    expect(handleNodeSelect).toHaveBeenCalledWith(node);
    expect(result.current.showFileList).toBe(false);
  });

  it('handleFileListClose closes file list', () => {
    const { result } = renderHook(() =>
      usePanelActions(
        handleClearSelection,
        handleNodeSelect,
        setShowRepoSelector,
        sampleGraphData,
        setScanning,
        setLastScan,
        '/project/repo',
        repos,
      ),
    );

    act(() => {
      result.current.handleFileListOpen();
    });
    expect(result.current.showFileList).toBe(true);

    act(() => {
      result.current.handleFileListClose();
    });
    expect(result.current.showFileList).toBe(false);
  });

  it('handleToggleFilterPanel toggles filter panel and closes others', () => {
    const { result } = renderHook(() =>
      usePanelActions(
        handleClearSelection,
        handleNodeSelect,
        setShowRepoSelector,
        sampleGraphData,
        setScanning,
        setLastScan,
        '/project/repo',
        repos,
      ),
    );

    // Toggle on
    act(() => {
      result.current.handleToggleFilterPanel();
    });
    expect(result.current.showFilterPanel).toBe(true);
    expect(result.current.showFileList).toBe(false);
    expect(result.current.showViolationsPanel).toBe(false);

    // Toggle off
    act(() => {
      result.current.handleToggleFilterPanel();
    });
    expect(result.current.showFilterPanel).toBe(false);
  });

  it('handleCloseFilterPanel closes filter panel', () => {
    const { result } = renderHook(() =>
      usePanelActions(
        handleClearSelection,
        handleNodeSelect,
        setShowRepoSelector,
        sampleGraphData,
        setScanning,
        setLastScan,
        '/project/repo',
        repos,
      ),
    );

    act(() => {
      result.current.handleToggleFilterPanel();
    });
    expect(result.current.showFilterPanel).toBe(true);

    act(() => {
      result.current.handleCloseFilterPanel();
    });
    expect(result.current.showFilterPanel).toBe(false);
  });

  it('handleToggleViolationsPanel toggles violations panel and closes others', () => {
    const { result } = renderHook(() =>
      usePanelActions(
        handleClearSelection,
        handleNodeSelect,
        setShowRepoSelector,
        sampleGraphData,
        setScanning,
        setLastScan,
        '/project/repo',
        repos,
      ),
    );

    // Toggle on
    act(() => {
      result.current.handleToggleViolationsPanel();
    });
    expect(result.current.showViolationsPanel).toBe(true);
    expect(result.current.showFileList).toBe(false);
    expect(result.current.showFilterPanel).toBe(false);

    // Toggle off
    act(() => {
      result.current.handleToggleViolationsPanel();
    });
    expect(result.current.showViolationsPanel).toBe(false);
  });

  it('handleCloseViolationsPanel closes violations panel', () => {
    const { result } = renderHook(() =>
      usePanelActions(
        handleClearSelection,
        handleNodeSelect,
        setShowRepoSelector,
        sampleGraphData,
        setScanning,
        setLastScan,
        '/project/repo',
        repos,
      ),
    );

    act(() => {
      result.current.handleToggleViolationsPanel();
    });
    expect(result.current.showViolationsPanel).toBe(true);

    act(() => {
      result.current.handleCloseViolationsPanel();
    });
    expect(result.current.showViolationsPanel).toBe(false);
  });

  it('handleClear calls useClearData callback', () => {
    const { result } = renderHook(() =>
      usePanelActions(
        handleClearSelection,
        handleNodeSelect,
        setShowRepoSelector,
        sampleGraphData,
        setScanning,
        setLastScan,
        '/project/repo',
        repos,
      ),
    );

    // handleClear is async
    act(() => {
      result.current.handleClear();
    });

    expect(handleClearFn).toHaveBeenCalled();
  });

  it('updates lastScan when filteredGraphData nodes length changes', () => {
    // Clear initial call from first render
    setLastScan.mockClear();

    const { rerender } = renderHook(
      (graphData: GraphData) =>
        usePanelActions(
          handleClearSelection,
          handleNodeSelect,
          setShowRepoSelector,
          graphData,
          setScanning,
          setLastScan,
          '/project/repo',
          repos,
        ),
      { initialProps: sampleGraphData },
    );

    const biggerGraph: GraphData = {
      nodes: [makeNode('/src/a.ts'), makeNode('/src/b.ts'), makeNode('/src/c.ts')],
      edges: [],
    };

    rerender(biggerGraph);

    expect(setLastScan).toHaveBeenCalledWith({ fileCount: 3, ts: 1000 });
  });

  it('handleToggleFilterPanel closes file list and violations panel', () => {
    const { result } = renderHook(() =>
      usePanelActions(
        handleClearSelection,
        handleNodeSelect,
        setShowRepoSelector,
        sampleGraphData,
        setScanning,
        setLastScan,
        '/project/repo',
        repos,
      ),
    );

    // Open file list first
    act(() => {
      result.current.handleFileListOpen();
    });
    expect(result.current.showFileList).toBe(true);

    // Toggle filter panel on — should close file list
    act(() => {
      result.current.handleToggleFilterPanel();
    });
    expect(result.current.showFilterPanel).toBe(true);
    expect(result.current.showFileList).toBe(false);
  });
});
