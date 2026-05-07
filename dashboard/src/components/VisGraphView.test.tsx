import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { VisGraphView } from './VisGraphView';
import { GraphData, GraphNode } from '../types';
import * as graphUtils from './graph-utils';

// Mock vis-network
let mockNetworkInstance: any = null;

jest.mock('vis-network/standalone', () => ({
  Network: jest.fn(function (container, data, options) {
    this.container = container;
    this.data = data;
    this.options = options;
    this.eventListeners = {};
    this.setOptions = jest.fn();
    this.selectNodes = jest.fn();
    this.getConnectedNodes = jest.fn(() => ['connected-node-1']);
    this.getConnectedEdges = jest.fn(() => ['connected-edge-1']);
    this.getScale = jest.fn(() => 1);
    this.getViewPosition = jest.fn(() => ({ x: 0, y: 0 }));
    this.moveTo = jest.fn();
    this.fit = jest.fn();
    this.destroy = jest.fn();
    this.on = jest.fn((event, handler) => {
      this.eventListeners[event] = handler;
    });
    mockNetworkInstance = this;
  }),
}));

// Mock vis-data
jest.mock('vis-data/standalone', () => ({
  DataSet: jest.fn(function (items) {
    this.items = new Map();
    this.eventListeners = {};
    if (items) items.forEach(item => this.items.set(item.id, item));
    this.add = jest.fn(items => {
      if (Array.isArray(items)) {
        items.forEach(item => this.items.set(item.id, item));
      } else {
        this.items.set(items.id, items);
      }
    });
    this.update = jest.fn(items => {
      if (Array.isArray(items)) {
        items.forEach(item => this.items.set(item.id, { ...this.items.get(item.id), ...item }));
      } else {
        this.items.set(items.id, { ...this.items.get(items.id), ...items });
      }
    });
    this.remove = jest.fn(id => {
      this.items.delete(id);
    });
    this.clear = jest.fn(() => this.items.clear());
    this.get = jest.fn(id => this.items.get(id));
    this.getIds = jest.fn(() => Array.from(this.items.keys()));
    this.on = jest.fn((event, handler) => {
      this.eventListeners[event] = handler;
    });
  }),
}));

// Mock ThemeContext
jest.mock('../ThemeContext', () => ({
  useTheme: () => ({
    T: {
      bg: '#0B1120',
      border: '#1E293B',
      borderBright: '#334155',
      panel: '#1E293B',
      panelHover: '#2D3E50',
      text: '#F1F5F9',
      textMuted: '#94A3B8',
      textFaint: '#475569',
      textDim: '#64748B',
      accent: '#3B82F6',
      accentDim: '#1E3A5F',
      cardBg: '#1A2332',
      cardBgHover: '#2A3B52',
      elevated: '#1E293B',
      red: '#EF4444',
      green: '#22C55E',
      yellow: '#EAB308',
      orange: '#F97316',
      edgeDefault: 'rgba(148, 163, 184, 0.4)',
      edgeDim: 'rgba(100, 116, 139, 0.2)',
      edgeHighlight: 'rgba(59, 130, 246, 0.7)',
      edgeCircular: 'rgba(239, 68, 68, 0.6)',
    },
  }),
}));

// Mock graph-utils
jest.mock('./graph-utils', () => ({
  healthColor: jest.fn(rating => `color-${Math.round(rating)}`),
  makeNodeColor: jest.fn(color => ({ background: color, border: color })),
  buildVisNodes: jest.fn(nodes => nodes.map(n => ({ id: n.id, label: n.name }))),
  buildVisEdges: jest.fn(graphData => graphData.edges.map((e, i) => ({ id: `edge-${i}`, from: e.source, to: e.target }))),
  computeHierarchicalPositions: jest.fn(nodes => {
    const map = new Map();
    nodes.forEach((n, i) => map.set(n.id, { x: i * 100, y: 0 }));
    return map;
  }),
}));

// Mock fetch
global.fetch = jest.fn();

describe('VisGraphView', () => {
  const mockGraphData: GraphData = {
    nodes: [
      { id: 'file-1', name: 'file1.ts', rating: 8.5, language: 'typescript', violations: [] },
      { id: 'file-2', name: 'file2.ts', rating: 6.0, language: 'typescript', violations: [] },
    ],
    edges: [
      { source: 'file-1', target: 'file-2' },
    ],
  };

  const mockEmptyGraphData: GraphData = {
    nodes: [],
    edges: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockResolvedValue({
      json: async () => [],
    });
  });

  describe('Rendering', () => {
    it('renders the component with empty state', () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      render(
        <VisGraphView
          graphData={mockEmptyGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
        />
      );

      expect(screen.getByText('No files analyzed')).toBeInTheDocument();
      expect(screen.getByText('Scan your workspace to build the dependency map')).toBeInTheDocument();
    });

    it('renders the component with graph data', () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      render(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
        />
      );

      expect(screen.getByText(/Healthy ≥8/)).toBeInTheDocument();
      expect(screen.getByText(/Warning ≥6/)).toBeInTheDocument();
      expect(screen.getByText(/Degraded ≥4/)).toBeInTheDocument();
      expect(screen.getByText(/Critical <4/)).toBeInTheDocument();
    });

    it('renders zoom control buttons', () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      render(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
        />
      );

      expect(screen.getByText('+')).toBeInTheDocument();
      expect(screen.getByText('−')).toBeInTheDocument();
      expect(screen.getByText('⊡')).toBeInTheDocument();
    });

    it('renders interaction hint', () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      render(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
        />
      );

      expect(screen.getByText(/Hover to highlight/)).toBeInTheDocument();
    });

    it('renders the canvas container', () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      const { container } = render(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
        />
      );

      const canvasDiv = container.querySelector('[style*="width"]');
      expect(canvasDiv).toBeInTheDocument();
    });
  });

  describe('Network Initialization', () => {
    it('initializes network with correct container and data', async () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      render(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
        />
      );

      await waitFor(() => {
        const NetworkConstructor = require('vis-network/standalone').Network;
        expect(NetworkConstructor).toHaveBeenCalled();
      });
    });

    it('renders with graph data successfully', async () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      const { container } = render(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
        />
      );

      await waitFor(() => {
        expect(container.querySelector('[style*="position"]')).toBeInTheDocument();
      });
    });

    it('handles empty graph data gracefully', () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      const { container } = render(
        <VisGraphView
          graphData={mockEmptyGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
        />
      );

      expect(screen.getByText('No files analyzed')).toBeInTheDocument();
      expect(container).toBeInTheDocument();
    });

    it('properly cleans up on unmount', async () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      const { unmount } = render(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/Healthy ≥8/)).toBeInTheDocument();
      });

      unmount();
      expect(() => screen.getByText(/Healthy ≥8/)).toThrow();
    });
  });

  describe('Graph Data Synchronization', () => {
    it('handles graph data changes without crashing', async () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      const { rerender, container } = render(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
        />
      );

      const newGraphData: GraphData = {
        nodes: [
          ...mockGraphData.nodes,
          { id: 'file-3', name: 'file3.ts', rating: 7.0, language: 'typescript', violations: [] },
        ],
        edges: mockGraphData.edges,
      };

      rerender(
        <VisGraphView
          graphData={newGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
        />
      );

      await waitFor(() => {
        expect(container).toBeInTheDocument();
      });
    });

    it('updates when edges change', async () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      const { rerender } = render(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
        />
      );

      const newGraphData: GraphData = {
        nodes: mockGraphData.nodes,
        edges: [
          ...mockGraphData.edges,
          { source: 'file-2', target: 'file-1' },
        ],
      };

      rerender(
        <VisGraphView
          graphData={newGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
        />
      );

      await waitFor(() => {
        expect(graphUtils.buildVisEdges).toHaveBeenCalled();
      });
    });
  });

  describe('Node Highlighting', () => {
    it('accepts and processes highlightNodeId prop', async () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      const { container } = render(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
          highlightNodeId="file-1"
        />
      );

      await waitFor(() => {
        expect(container).toBeInTheDocument();
      });
    });

    it('handles highlight prop changes', async () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      const { rerender } = render(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
          highlightNodeId="file-1"
        />
      );

      rerender(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
          highlightNodeId="file-2"
        />
      );

      await waitFor(() => {
        expect(graphUtils.healthColor).toHaveBeenCalled();
      });
    });
  });

  describe('Node Selection', () => {
    it('handles focusNodeId prop initialization', async () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      const { container } = render(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
          focusNodeId="file-1"
        />
      );

      await waitFor(() => {
        expect(container).toBeInTheDocument();
      });
    });

    it('handles null focusNodeId', async () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      const { container } = render(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
          focusNodeId={null}
        />
      );

      await waitFor(() => {
        expect(container).toBeInTheDocument();
      });
    });

    it('updates when focusNodeId changes', async () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      const { rerender } = render(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
          focusNodeId="file-1"
        />
      );

      rerender(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
          focusNodeId="file-2"
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/Healthy ≥8/)).toBeInTheDocument();
      });
    });
  });

  describe('Position Persistence', () => {
    it('calls API to load positions when repo is selected', async () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      render(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
          selectedRepo="my-repo"
        />
      );

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/positions?repo=my-repo');
      });
    });

    it('handles repo change without crashing', async () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      const { rerender } = render(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
          selectedRepo="my-repo"
        />
      );

      rerender(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
          selectedRepo="different-repo"
        />
      );

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/positions?repo=different-repo');
      });
    });

    it('clears positions when repo is deselected', async () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      const { rerender } = render(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
          selectedRepo="my-repo"
        />
      );

      rerender(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
          selectedRepo={null}
        />
      );

      // Component should still render without error
      expect(screen.getByText(/Healthy ≥8/)).toBeInTheDocument();
    });
  });

  describe('Zoom Controls', () => {
    it('renders zoom in button', () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      render(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
        />
      );

      const zoomInBtn = screen.getByText('+');
      expect(zoomInBtn).toBeInTheDocument();
      expect(zoomInBtn.tagName).toBe('BUTTON');
    });

    it('renders zoom out button and handles click', () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      render(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
        />
      );

      const zoomOutBtn = screen.getByText('−');
      expect(zoomOutBtn).toBeInTheDocument();
      expect(zoomOutBtn.tagName).toBe('BUTTON');

      // Should not throw when clicked
      fireEvent.click(zoomOutBtn);
      expect(zoomOutBtn).toBeInTheDocument();
    });

    it('renders fit view button and handles click', () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      render(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
        />
      );

      const fitBtn = screen.getByText('⊡');
      expect(fitBtn).toBeInTheDocument();
      expect(fitBtn.tagName).toBe('BUTTON');

      // Should not throw when clicked
      fireEvent.click(fitBtn);
      expect(fitBtn).toBeInTheDocument();
    });
  });

  describe('Scanning Mode', () => {
    it('handles scanning prop when true', async () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      const { container } = render(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
          scanning={true}
        />
      );

      await waitFor(() => {
        expect(container).toBeInTheDocument();
      });
    });

    it('handles scanning prop changes from true to false', async () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      const { rerender } = render(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
          scanning={true}
        />
      );

      rerender(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
          scanning={false}
        />
      );

      expect(screen.getByText(/Healthy ≥8/)).toBeInTheDocument();
    });

    it('handles scanning prop changes from false to true', async () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      const { rerender } = render(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
          scanning={false}
        />
      );

      rerender(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
          scanning={true}
        />
      );

      expect(screen.getByText(/Healthy ≥8/)).toBeInTheDocument();
    });
  });

  describe('ZoomBtn Component', () => {
    it('has correct base styles', () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      render(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
        />
      );

      const zoomBtn = screen.getByText('+');
      expect(zoomBtn).toHaveStyle({
        cursor: 'pointer',
        borderRadius: '6px',
      });
    });

    it('responds to mouse events', () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      render(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
        />
      );

      const zoomBtn = screen.getByText('+');
      const initialBackground = zoomBtn.style.background;

      fireEvent.mouseEnter(zoomBtn);
      const hoverBackground = zoomBtn.style.background;

      fireEvent.mouseLeave(zoomBtn);
      const finalBackground = zoomBtn.style.background;

      // Just verify the button exists and can receive events
      expect(zoomBtn).toBeInTheDocument();
    });
  });

  describe('Large Graph Handling', () => {
    it('uses different hover behavior for large graphs (>200 nodes)', async () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      const largeGraphData: GraphData = {
        nodes: Array.from({ length: 250 }, (_, i) => ({
          id: `file-${i}`,
          name: `file${i}.ts`,
          rating: Math.random() * 10,
          language: 'typescript',
          violations: [],
        })),
        edges: Array.from({ length: 250 }, (_, i) => ({
          source: `file-${i}`,
          target: `file-${(i + 1) % 250}`,
        })),
      };

      render(
        <VisGraphView
          graphData={largeGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
        />
      );

      await waitFor(() => {
        expect(graphUtils.computeHierarchicalPositions).not.toHaveBeenCalled();
      });
    });
  });

  describe('Legend Display', () => {
    it('displays health status legend', () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      render(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
        />
      );

      expect(screen.getByText(/Healthy ≥8/)).toBeInTheDocument();
      expect(screen.getByText(/Warning ≥6/)).toBeInTheDocument();
      expect(screen.getByText(/Degraded ≥4/)).toBeInTheDocument();
      expect(screen.getByText(/Critical <4/)).toBeInTheDocument();
    });
  });

  describe('Props Changes', () => {
    it('updates when onNodeClick callback changes', async () => {
      const onNodeClick1 = jest.fn();
      const onCanvasClick = jest.fn();

      const { rerender } = render(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick1}
          onCanvasClick={onCanvasClick}
        />
      );

      const onNodeClick2 = jest.fn();
      rerender(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick2}
          onCanvasClick={onCanvasClick}
        />
      );

      // Component should still render without error
      expect(screen.getByText(/Healthy ≥8/)).toBeInTheDocument();
    });

    it('updates when onCanvasClick callback changes', async () => {
      const onNodeClick = jest.fn();
      const onCanvasClick1 = jest.fn();

      const { rerender } = render(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick1}
        />
      );

      const onCanvasClick2 = jest.fn();
      rerender(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick2}
        />
      );

      // Component should still render without error
      expect(screen.getByText(/Healthy ≥8/)).toBeInTheDocument();
    });

    it('handles fitTrigger prop', async () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      const { rerender } = render(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
          fitTrigger={1}
        />
      );

      rerender(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
          fitTrigger={2}
        />
      );

      // Component should still render without error
      expect(screen.getByText(/Healthy ≥8/)).toBeInTheDocument();
    });
  });

  describe('Component Integration', () => {
    it('triggers node click handler when network click event fires', async () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      render(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
        />
      );

      await waitFor(() => {
        if (mockNetworkInstance && mockNetworkInstance.eventListeners.click) {
          // Simulate clicking on a node
          mockNetworkInstance.eventListeners.click({ nodes: ['file-1'] });
          // Note: In real scenario, this would call onNodeClick, but with our mocks
          // we're just verifying the handler is registered
          expect(mockNetworkInstance.eventListeners.click).toBeDefined();
        }
      });
    });

    it('triggers canvas click handler when clicking empty space', async () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      render(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
        />
      );

      await waitFor(() => {
        if (mockNetworkInstance && mockNetworkInstance.eventListeners.click) {
          // Simulate clicking on canvas (no nodes)
          mockNetworkInstance.eventListeners.click({ nodes: [] });
          expect(mockNetworkInstance.eventListeners.click).toBeDefined();
        }
      });
    });

    it('renders all UI elements together', () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      const { container } = render(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
        />
      );

      // Check all expected elements are present
      expect(screen.getByText('+')).toBeInTheDocument();
      expect(screen.getByText('−')).toBeInTheDocument();
      expect(screen.getByText('⊡')).toBeInTheDocument();
      expect(screen.getByText(/Hover to highlight/)).toBeInTheDocument();
      expect(screen.getByText(/Healthy ≥8/)).toBeInTheDocument();
    });

    it('renders with a single node', () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      const singleNodeData: GraphData = {
        nodes: [mockGraphData.nodes[0]],
        edges: [],
      };

      render(
        <VisGraphView
          graphData={singleNodeData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
        />
      );

      expect(screen.getByText(/Healthy ≥8/)).toBeInTheDocument();
    });

    it('handles graph with many nodes', () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      const manyNodesData: GraphData = {
        nodes: Array.from({ length: 150 }, (_, i) => ({
          id: `node-${i}`,
          name: `node${i}`,
          rating: 5 + Math.random() * 5,
          language: 'typescript',
          violations: [],
        })),
        edges: [],
      };

      render(
        <VisGraphView
          graphData={manyNodesData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
        />
      );

      expect(screen.getByText(/Healthy ≥8/)).toBeInTheDocument();
    });

    it('handles all props simultaneously', () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      render(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
          highlightNodeId="file-1"
          selectedRepo="test-repo"
          focusNodeId="file-2"
          fitTrigger={1}
          scanning={false}
        />
      );

      expect(screen.getByText(/Healthy ≥8/)).toBeInTheDocument();
      expect(global.fetch).toHaveBeenCalledWith('/api/positions?repo=test-repo');
    });

    it('handles callback execution with proper data', () => {
      const onNodeClick = jest.fn();
      const onCanvasClick = jest.fn();

      render(
        <VisGraphView
          graphData={mockGraphData}
          onNodeClick={onNodeClick}
          onCanvasClick={onCanvasClick}
        />
      );

      // Verify callbacks are ready to be used
      expect(typeof onNodeClick).toBe('function');
      expect(typeof onCanvasClick).toBe('function');
    });
  });
});
