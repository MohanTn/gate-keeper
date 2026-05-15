import { renderHook, act } from '@testing-library/react';
import { useAppState } from './useAppState';
import { GraphData, GraphNode, RepoInfo } from '../types';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const emptyGraph: GraphData = { nodes: [], edges: [] };

const makeNode = (id: string): GraphNode => ({
  id, label: id.split('/').pop() ?? id, type: 'typescript',
  rating: 8, size: 1, violations: [],
  metrics: { linesOfCode: 100, cyclomaticComplexity: 2, numberOfMethods: 3, numberOfClasses: 1, importCount: 5 },
});

const sampleRepos: RepoInfo[] = [
  { repoRoot: '/home/proj', label: 'my-project', fileCount: 10 },
];

// ── Mock all sub-hooks ────────────────────────────────────────────────────────

const mockRepoSelection = {
  repos: sampleRepos,
  selectedRepo: '/home/proj' as string | null,
  showRepoSelector: false,
  setShowRepoSelector: jest.fn(),
  handleRepoSelect: jest.fn(),
  handleRepoDelete: jest.fn(),
  refreshRepos: jest.fn(),
};

const mockGraphData = {
  graphData: emptyGraph,
  filteredGraphData: emptyGraph,
  patterns: [],
  addPattern: jest.fn(),
  removePattern: jest.fn(),
  scanExcludePatterns: null,
  wsStatus: 'connected' as const,
  scanProgress: null,
  scanning: false,
  setScanning: jest.fn(),
  lastScan: null,
  setLastScan: jest.fn(),
  handleScanAll: jest.fn(),
  repoLoading: false,
};

const selectedNode = makeNode('/home/proj/src/app.ts');

const mockNodeHandlers = {
  selectedNode: null as GraphNode | null,
  handleClearSelection: jest.fn(),
  handleNodeSelect: jest.fn(),
};

const mockSearchUI = {
  searchQuery: '',
  searchRef: { current: null },
  searchResults: [] as GraphNode[],
  showSearchDropdown: false,
  handleSearchSelect: jest.fn(),
  handleSearchChange: jest.fn(),
  handleSearchFocus: jest.fn(),
  handleSearchBlur: jest.fn(),
  handleSearchKeyDown: jest.fn(),
};

const mockPanelActions = {
  showFileList: false,
  showFilterPanel: false,
  showViolationsPanel: false,
  handleShowRepoSelector: jest.fn(),
  handleFileListOpen: jest.fn(),
  handleFileListSelect: jest.fn(),
  handleFileListClose: jest.fn(),
  handleToggleFilterPanel: jest.fn(),
  handleCloseFilterPanel: jest.fn(),
  handleToggleViolationsPanel: jest.fn(),
  handleCloseViolationsPanel: jest.fn(),
  handleClear: jest.fn(),
};

const mockMetrics = {
  totalViolations: 3,
  overallRating: 8.5,
  currentRepoLabel: 'my-project',
  scanPct: null,
};

jest.mock('./useRepoSelection', () => ({ useRepoSelection: () => mockRepoSelection }));
jest.mock('./useGraphData', () => ({ useGraphData: () => mockGraphData }));
jest.mock('./useNodeHandlers', () => ({ useNodeHandlers: () => mockNodeHandlers }));
jest.mock('./useSearchUI', () => ({ useSearchUI: () => mockSearchUI }));
jest.mock('./usePanelActions', () => ({ usePanelActions: () => mockPanelActions }));
jest.mock('./useAppMetrics', () => ({ useAppMetrics: () => mockMetrics }));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useAppState', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('initial view', () => {
    it('defaults to graph view', () => {
      const { result } = renderHook(() => useAppState());
      expect(result.current.view).toBe('graph');
    });

    it('setView switches to quality view', () => {
      const { result } = renderHook(() => useAppState());
      act(() => { result.current.setView('quality'); });
      expect(result.current.view).toBe('quality');
    });

    it('setView switches back to graph view', () => {
      const { result } = renderHook(() => useAppState());
      act(() => { result.current.setView('quality'); });
      act(() => { result.current.setView('graph'); });
      expect(result.current.view).toBe('graph');
    });
  });

  describe('repo selection passthrough', () => {
    it('exposes repos from useRepoSelection', () => {
      const { result } = renderHook(() => useAppState());
      expect(result.current.repos).toEqual(sampleRepos);
    });

    it('exposes selectedRepo', () => {
      const { result } = renderHook(() => useAppState());
      expect(result.current.selectedRepo).toBe('/home/proj');
    });

    it('exposes showRepoSelector', () => {
      const { result } = renderHook(() => useAppState());
      expect(result.current.showRepoSelector).toBe(false);
    });

    it('exposes handleRepoSelect', () => {
      const { result } = renderHook(() => useAppState());
      result.current.handleRepoSelect('/new/repo');
      expect(mockRepoSelection.handleRepoSelect).toHaveBeenCalledWith('/new/repo');
    });

    it('exposes handleRepoDelete', () => {
      const { result } = renderHook(() => useAppState());
      result.current.handleRepoDelete('/home/proj');
      expect(mockRepoSelection.handleRepoDelete).toHaveBeenCalledWith('/home/proj');
    });
  });

  describe('graph data passthrough', () => {
    it('exposes graphData', () => {
      const { result } = renderHook(() => useAppState());
      expect(result.current.graphData).toEqual(emptyGraph);
    });

    it('exposes filteredGraphData', () => {
      const { result } = renderHook(() => useAppState());
      expect(result.current.filteredGraphData).toEqual(emptyGraph);
    });

    it('exposes wsStatus', () => {
      const { result } = renderHook(() => useAppState());
      expect(result.current.wsStatus).toBe('connected');
    });

    it('exposes scanning', () => {
      const { result } = renderHook(() => useAppState());
      expect(result.current.scanning).toBe(false);
    });

    it('exposes repoLoading', () => {
      const { result } = renderHook(() => useAppState());
      expect(result.current.repoLoading).toBe(false);
    });

    it('exposes handleScanAll', () => {
      const { result } = renderHook(() => useAppState());
      expect(typeof result.current.handleScanAll).toBe('function');
    });
  });

  describe('node handlers passthrough', () => {
    it('exposes selectedNode', () => {
      const { result } = renderHook(() => useAppState());
      expect(result.current.selectedNode).toBeNull();
    });

    it('exposes handleClearSelection', () => {
      const { result } = renderHook(() => useAppState());
      result.current.handleClearSelection();
      expect(mockNodeHandlers.handleClearSelection).toHaveBeenCalled();
    });

    it('exposes handleNodeSelect', () => {
      const { result } = renderHook(() => useAppState());
      result.current.handleNodeSelect(selectedNode);
      expect(mockNodeHandlers.handleNodeSelect).toHaveBeenCalledWith(selectedNode);
    });
  });

  describe('search UI passthrough', () => {
    it('exposes searchQuery', () => {
      const { result } = renderHook(() => useAppState());
      expect(result.current.searchQuery).toBe('');
    });

    it('exposes searchResults', () => {
      const { result } = renderHook(() => useAppState());
      expect(result.current.searchResults).toEqual([]);
    });

    it('exposes showSearchDropdown', () => {
      const { result } = renderHook(() => useAppState());
      expect(result.current.showSearchDropdown).toBe(false);
    });
  });

  describe('panel actions passthrough', () => {
    it('exposes showFileList', () => {
      const { result } = renderHook(() => useAppState());
      expect(result.current.showFileList).toBe(false);
    });

    it('exposes showFilterPanel', () => {
      const { result } = renderHook(() => useAppState());
      expect(result.current.showFilterPanel).toBe(false);
    });

    it('exposes showViolationsPanel', () => {
      const { result } = renderHook(() => useAppState());
      expect(result.current.showViolationsPanel).toBe(false);
    });

    it('exposes handleShowRepoSelector', () => {
      const { result } = renderHook(() => useAppState());
      result.current.handleShowRepoSelector();
      expect(mockPanelActions.handleShowRepoSelector).toHaveBeenCalled();
    });

    it('exposes handleClear', () => {
      const { result } = renderHook(() => useAppState());
      expect(typeof result.current.handleClear).toBe('function');
    });
  });

  describe('metrics passthrough', () => {
    it('exposes totalViolations', () => {
      const { result } = renderHook(() => useAppState());
      expect(result.current.totalViolations).toBe(3);
    });

    it('exposes overallRating', () => {
      const { result } = renderHook(() => useAppState());
      expect(result.current.overallRating).toBe(8.5);
    });

    it('exposes currentRepoLabel', () => {
      const { result } = renderHook(() => useAppState());
      expect(result.current.currentRepoLabel).toBe('my-project');
    });

    it('exposes scanPct', () => {
      const { result } = renderHook(() => useAppState());
      expect(result.current.scanPct).toBeNull();
    });
  });
});
