import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { AppContent, RepoOverlay } from './AppContent';
import { darkTokens } from '../ThemeContext';
import type { GraphData, GraphNode, RepoInfo } from '../types';
import '@testing-library/jest-dom';

// ── Theme mock ──────────────────────────────────────────────────────────────

jest.mock('../ThemeContext', () => ({
  useTheme: () => ({ T: darkTokens, mode: 'dark', toggleTheme: jest.fn() }),
  darkTokens: jest.requireActual('../ThemeContext').darkTokens,
}));

// ── Child component mocks ───────────────────────────────────────────────────

jest.mock('./VisGraphView', () => ({
  VisGraphView: () => <div data-testid="vis-graph-view">Graph View</div>,
}));

jest.mock('./DetailPanel', () => ({
  DetailPanel: () => <div data-testid="detail-panel">Detail Panel</div>,
}));

jest.mock('./FileListDrawer', () => ({
  FileListDrawer: () => <div data-testid="file-list-drawer">File List</div>,
}));

jest.mock('./ViolationsPanel', () => ({
  ViolationsPanel: () => <div data-testid="violations-panel">Violations</div>,
}));

jest.mock('./FilterPanel', () => ({
  FilterPanel: () => <div data-testid="filter-panel">Filter Panel</div>,
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 'src/file.ts',
    label: 'file.ts',
    type: 'typescript',
    rating: 8.0,
    size: 10,
    violations: [],
    metrics: {
      linesOfCode: 50,
      cyclomaticComplexity: 2,
      numberOfMethods: 3,
      numberOfClasses: 1,
      importCount: 3,
    },
    ...overrides,
  } as GraphNode;
}

const emptyGraph: GraphData = { nodes: [], edges: [] };
const populatedGraph: GraphData = { nodes: [makeNode()], edges: [] };

function defaultProps(overrides: Partial<React.ComponentProps<typeof AppContent>> = {}): React.ComponentProps<typeof AppContent> {
  return {
    repoLoading: false,
    scanning: false,
    filteredGraphData: emptyGraph,
    graphData: emptyGraph,
    selectedNode: null,
    showFileList: false,
    showFilterPanel: false,
    showViolationsPanel: false,
    selectedRepo: '/repo',
    patterns: [],
    scanExcludePatterns: null,
    wsStatus: 'connected' as const,
    onNodeSelect: jest.fn(),
    onCanvasClick: jest.fn(),
    onFileListSelect: jest.fn(),
    onFileListClose: jest.fn(),
    onFilterClose: jest.fn(),
    onViolationsClose: jest.fn(),
    onAddPattern: jest.fn(),
    onRemovePattern: jest.fn(),
    onScanAll: jest.fn(),
    T: darkTokens,
    ...overrides,
  };
}

function renderAppContent(props: Partial<React.ComponentProps<typeof AppContent>> = {}) {
  return render(<AppContent {...defaultProps(props)} />);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('AppContent', () => {
  describe('loading state', () => {
    it('shows loading state when repoLoading=true', () => {
      renderAppContent({ repoLoading: true });
      expect(screen.getByText('Connecting to daemon on port 5378…')).toBeInTheDocument();
    });
  });

  describe('disconnected state', () => {
    it('shows "Daemon unreachable" when wsStatus=disconnected', () => {
      renderAppContent({ wsStatus: 'disconnected' });
      expect(screen.getByText('Daemon unreachable')).toBeInTheDocument();
      expect(screen.getByText(/Cannot connect to the daemon/)).toBeInTheDocument();
      expect(screen.getByText(/Retrying every 3 seconds/)).toBeInTheDocument();
    });
  });

  describe('no repository selected', () => {
    it('shows "No repository selected" when selectedRepo is null', () => {
      renderAppContent({ selectedRepo: null });
      expect(screen.getByText('No repository selected')).toBeInTheDocument();
      expect(screen.getByText(/Pick one from the dropdown/)).toBeInTheDocument();
    });
  });

  describe('empty files state', () => {
    it('shows "No files analyzed yet" when connected with empty data and not scanning', () => {
      renderAppContent({
        wsStatus: 'connected',
        filteredGraphData: emptyGraph,
        scanning: false,
      });
      expect(screen.getByText('No files analyzed yet')).toBeInTheDocument();
      expect(screen.getByText('Scan all files')).toBeInTheDocument();
    });

    it('does not show empty state when scanning is true', () => {
      renderAppContent({
        wsStatus: 'connected',
        filteredGraphData: emptyGraph,
        scanning: true,
      });
      // Should NOT show "No files analyzed yet" because scanning hides it
      expect(screen.queryByText('No files analyzed yet')).not.toBeInTheDocument();
    });

    it('calls onScanAll when Scan all files is clicked', () => {
      const onScanAll = jest.fn();
      renderAppContent({
        wsStatus: 'connected',
        filteredGraphData: emptyGraph,
        scanning: false,
        onScanAll,
      });

      fireEvent.click(screen.getByText('Scan all files'));
      expect(onScanAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('main graph view', () => {
    it('renders VisGraphView when all conditions met', () => {
      renderAppContent({
        wsStatus: 'connected',
        filteredGraphData: populatedGraph,
        scanning: false,
      });
      expect(screen.getByTestId('vis-graph-view')).toBeInTheDocument();
    });

    it('does not render DetailPanel when no selectedNode', () => {
      renderAppContent({
        wsStatus: 'connected',
        filteredGraphData: populatedGraph,
        selectedNode: null,
      });
      expect(screen.queryByTestId('detail-panel')).not.toBeInTheDocument();
    });

    it('renders DetailPanel when selectedNode is set', () => {
      renderAppContent({
        wsStatus: 'connected',
        filteredGraphData: populatedGraph,
        selectedNode: makeNode(),
        showFilterPanel: false,
      });
      expect(screen.getByTestId('detail-panel')).toBeInTheDocument();
    });

    it('does not render DetailPanel when showFilterPanel is true', () => {
      renderAppContent({
        wsStatus: 'connected',
        filteredGraphData: populatedGraph,
        selectedNode: makeNode(),
        showFilterPanel: true,
      });
      // The condition is `selectedNode && !showFilterPanel` — so with filter open, detail hides
      expect(screen.queryByTestId('detail-panel')).not.toBeInTheDocument();
    });

    it('renders FileListDrawer when showFileList is true', () => {
      renderAppContent({
        wsStatus: 'connected',
        filteredGraphData: populatedGraph,
        showFileList: true,
      });
      expect(screen.getByTestId('file-list-drawer')).toBeInTheDocument();
    });

    it('does not render FileListDrawer when showFileList is false', () => {
      renderAppContent({
        wsStatus: 'connected',
        filteredGraphData: populatedGraph,
        showFileList: false,
      });
      expect(screen.queryByTestId('file-list-drawer')).not.toBeInTheDocument();
    });

    it('renders FilterPanel when showFilterPanel is true and selectedRepo is set', () => {
      renderAppContent({
        wsStatus: 'connected',
        filteredGraphData: populatedGraph,
        showFilterPanel: true,
        selectedRepo: '/repo',
      });
      expect(screen.getByTestId('filter-panel')).toBeInTheDocument();
    });

    it('does not render FilterPanel when showFilterPanel is false', () => {
      renderAppContent({
        wsStatus: 'connected',
        filteredGraphData: populatedGraph,
        showFilterPanel: false,
      });
      expect(screen.queryByTestId('filter-panel')).not.toBeInTheDocument();
    });

    it('renders ViolationsPanel when showViolationsPanel is true', () => {
      renderAppContent({
        wsStatus: 'connected',
        filteredGraphData: populatedGraph,
        showViolationsPanel: true,
      });
      expect(screen.getByTestId('violations-panel')).toBeInTheDocument();
    });

    it('does not render ViolationsPanel when showViolationsPanel is false', () => {
      renderAppContent({
        wsStatus: 'connected',
        filteredGraphData: populatedGraph,
        showViolationsPanel: false,
      });
      expect(screen.queryByTestId('violations-panel')).not.toBeInTheDocument();
    });
  });

  describe('resizable divider', () => {
    it('renders a divider element', () => {
      const { container } = renderAppContent({
        wsStatus: 'connected',
        filteredGraphData: populatedGraph,
      });

      // The divider has title "Drag to resize right panel"
      const divider = screen.getByTitle('Drag to resize right panel');
      expect(divider).toBeInTheDocument();
      expect(divider).toHaveStyle('cursor: col-resize');
    });

    it('divider responds to mouse events visually', () => {
      const { container } = renderAppContent({
        wsStatus: 'connected',
        filteredGraphData: populatedGraph,
      });

      const divider = screen.getByTitle('Drag to resize right panel');

      // Mouse enter should trigger hover state
      fireEvent.mouseEnter(divider);

      // Mouse leave should clear hover state
      fireEvent.mouseLeave(divider);
      // Just checking no error occurs — the visual state change is internal
    });

    it('divider mouseDown starts resize', () => {
      renderAppContent({
        wsStatus: 'connected',
        filteredGraphData: populatedGraph,
      });

      const divider = screen.getByTitle('Drag to resize right panel');

      fireEvent.mouseDown(divider);
      // After mouseDown, isResizing is true. Firing mousemove should not crash
      fireEvent.mouseMove(document, { clientX: 500 });
      fireEvent.mouseUp(document);

      // Should be in non-resizing state after mouseup
      // Just verifying no crash
    });
  });

  describe('RepoOverlay', () => {
    const repos: RepoInfo[] = [
      { repoRoot: '/repo/one', label: 'One', fileCount: 10 },
    ];

    it('renders RepoSelectorModal when showRepoSelector is true', () => {
      render(
        <RepoOverlay
          showRepoSelector={true}
          repos={repos}
          selectedRepo={null}
          onSelect={jest.fn()}
          onClose={jest.fn()}
          onDelete={jest.fn()}
        />
      );
      expect(screen.getByText('Select Repository')).toBeInTheDocument();
    });

    it('returns null when showRepoSelector is false', () => {
      const { container } = render(
        <RepoOverlay
          showRepoSelector={false}
          repos={repos}
          selectedRepo={null}
          onSelect={jest.fn()}
          onClose={jest.fn()}
          onDelete={jest.fn()}
        />
      );
      expect(container.firstChild).toBeNull();
    });
  });
});
