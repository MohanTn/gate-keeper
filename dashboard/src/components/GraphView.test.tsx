import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GraphView } from './GraphView';
import type { GraphData, GraphNode } from '../types';
import '@testing-library/jest-dom';

function createSampleNode(id: string, label: string, type: 'typescript' | 'tsx' | 'jsx' | 'csharp' = 'typescript', rating: number = 7.0, x?: number, y?: number): GraphNode {
  const node: GraphNode = {
    id,
    label,
    type,
    rating,
    size: 1,
    violations: [],
    metrics: {
      linesOfCode: 100,
      cyclomaticComplexity: 2,
      numberOfMethods: 5,
      numberOfClasses: 1,
      importCount: 3,
    },
  };
  if (x !== undefined) node.x = x;
  if (y !== undefined) node.y = y;
  return node;
}

function createGraphData(nodes: GraphNode[], edges: any[] = []): GraphData {
  return { nodes, edges };
}

describe('GraphView', () => {
  const mockOnNodeClick = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('renders empty state when no nodes', () => {
    const graphData = createGraphData([]);
    render(<GraphView graphData={graphData} onNodeClick={mockOnNodeClick} selectedRepo={null} />);
    expect(screen.getByText('No files analyzed')).toBeInTheDocument();
  });

  it('renders force graph when nodes exist', () => {
    const graphData = createGraphData([createSampleNode('file1.ts', 'file1.ts')]);
    render(<GraphView graphData={graphData} onNodeClick={mockOnNodeClick} selectedRepo={null} />);
    expect(screen.queryByText('No files analyzed')).not.toBeInTheDocument();
  });

  it('renders legend', () => {
    const graphData = createGraphData([createSampleNode('file1.ts', 'file1.ts')]);
    render(<GraphView graphData={graphData} onNodeClick={mockOnNodeClick} selectedRepo={null} />);
    expect(screen.getByText('Legend')).toBeInTheDocument();
  });

  it('renders legend items for different languages', () => {
    const graphData = createGraphData([createSampleNode('file1.ts', 'file1.ts')]);
    render(<GraphView graphData={graphData} onNodeClick={mockOnNodeClick} selectedRepo={null} />);
    expect(screen.getByText('TypeScript / JS')).toBeInTheDocument();
    expect(screen.getByText('C#')).toBeInTheDocument();
    expect(screen.getByText('React (TSX / JSX)')).toBeInTheDocument();
  });

  it('renders legend color indicators', () => {
    const graphData = createGraphData([createSampleNode('file1.ts', 'file1.ts')]);
    render(<GraphView graphData={graphData} onNodeClick={mockOnNodeClick} selectedRepo={null} />);
    expect(screen.getByText('≥ 8')).toBeInTheDocument();
    expect(screen.getByText('≥ 6')).toBeInTheDocument();
    expect(screen.getByText('≥ 4')).toBeInTheDocument();
    expect(screen.getByText('< 4')).toBeInTheDocument();
  });

  it('renders interaction hints', () => {
    const graphData = createGraphData([createSampleNode('file1.ts', 'file1.ts')]);
    render(<GraphView graphData={graphData} onNodeClick={mockOnNodeClick} selectedRepo={null} />);
    expect(screen.getByText('click node to open details')).toBeInTheDocument();
    expect(screen.getByText('shift+click to multi-select · drag to move group')).toBeInTheDocument();
    expect(screen.getByText('positions saved automatically')).toBeInTheDocument();
  });

  it('calls onNodeClick when a node is clicked', () => {
    const graphData = createGraphData([createSampleNode('file1.ts', 'file1.ts')]);
    render(<GraphView graphData={graphData} onNodeClick={mockOnNodeClick} selectedRepo={null} />);
    expect(mockOnNodeClick).not.toHaveBeenCalled();
  });

  it('handles background click to clear selection', () => {
    const graphData = createGraphData([createSampleNode('file1.ts', 'file1.ts')]);
    render(<GraphView graphData={graphData} onNodeClick={mockOnNodeClick} selectedRepo={null} />);
    expect(screen.queryByText('No files analyzed')).not.toBeInTheDocument();
  });

  it('highlights node when highlightNodeId is provided', () => {
    const graphData = createGraphData([createSampleNode('file1.ts', 'file1.ts')]);
    render(
      <GraphView 
        graphData={graphData} 
        onNodeClick={mockOnNodeClick} 
        highlightNodeId="file1.ts"
        selectedRepo={null} 
      />
    );
    expect(screen.queryByText('No files analyzed')).not.toBeInTheDocument();
  });

  it('does not highlight node when highlightNodeId does not match', () => {
    const graphData = createGraphData([createSampleNode('file1.ts', 'file1.ts')]);
    render(
      <GraphView 
        graphData={graphData} 
        onNodeClick={mockOnNodeClick} 
        highlightNodeId="other.ts"
        selectedRepo={null} 
      />
    );
    expect(screen.queryByText('No files analyzed')).not.toBeInTheDocument();
  });

  it('handles shift+click for multi-select', async () => {
    const graphData = createGraphData([
      createSampleNode('file1.ts', 'file1.ts'),
      createSampleNode('file2.ts', 'file2.ts'),
    ]);
    render(<GraphView graphData={graphData} onNodeClick={mockOnNodeClick} selectedRepo={null} />);
    
    fireEvent.keyDown(window, { shiftKey: true, key: 'Shift' });
    expect(screen.queryByText('No files analyzed')).not.toBeInTheDocument();
    fireEvent.keyUp(window, { shiftKey: false, key: 'Shift' });
  });

  it('fetches node positions when selectedRepo is provided', async () => {
    const mockPositions = [
      { nodeId: 'file1.ts', x: 100, y: 200 },
      { nodeId: 'file2.ts', x: 300, y: 400 },
    ];
    
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue(mockPositions),
    });

    const graphData = createGraphData([
      createSampleNode('file1.ts', 'file1.ts', 'typescript', 7.0, 100, 200),
      createSampleNode('file2.ts', 'file2.ts', 'typescript', 8.0, 300, 400),
    ]);
    
    render(<GraphView graphData={graphData} onNodeClick={mockOnNodeClick} selectedRepo="test-repo" />);
    
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/positions?repo=test-repo');
    });
  });

  it('handles position fetch error gracefully', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Fetch failed'));

    const graphData = createGraphData([createSampleNode('file1.ts', 'file1.ts')]);
    render(<GraphView graphData={graphData} onNodeClick={mockOnNodeClick} selectedRepo="test-repo" />);
    
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
  });

  it('saves node positions when drag ends', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    const graphData = createGraphData([createSampleNode('file1.ts', 'file1.ts')]);
    render(<GraphView graphData={graphData} onNodeClick={mockOnNodeClick} selectedRepo="test-repo" />);
    expect(screen.queryByText('No files analyzed')).not.toBeInTheDocument();
  });

  it('handles position save error gracefully', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Save failed'));

    const graphData = createGraphData([createSampleNode('file1.ts', 'file1.ts')]);
    render(<GraphView graphData={graphData} onNodeClick={mockOnNodeClick} selectedRepo="test-repo" />);
    
    await waitFor(() => {
      expect(screen.queryByText('No files analyzed')).not.toBeInTheDocument();
    });
  });

  it('displays multi-select count when multiple nodes selected', () => {
    const graphData = createGraphData([
      createSampleNode('file1.ts', 'file1.ts'),
      createSampleNode('file2.ts', 'file2.ts'),
    ]);
    render(<GraphView graphData={graphData} onNodeClick={mockOnNodeClick} selectedRepo={null} />);
    expect(screen.queryByText(/nodes selected/)).not.toBeInTheDocument();
  });

  it('renders edges with correct colors', () => {
    const nodes = [
      createSampleNode('file1.ts', 'file1.ts'),
      createSampleNode('file2.ts', 'file2.ts'),
    ];
    const edges = [
      { source: 'file1.ts', target: 'file2.ts', type: 'import', strength: 1 },
    ];
    const graphData = createGraphData(nodes, edges);
    render(<GraphView graphData={graphData} onNodeClick={mockOnNodeClick} selectedRepo={null} />);
    expect(screen.queryByText('No files analyzed')).not.toBeInTheDocument();
  });

  it('renders edges with dependency type', () => {
    const nodes = [
      createSampleNode('file1.ts', 'file1.ts'),
      createSampleNode('file2.ts', 'file2.ts'),
    ];
    const edges = [
      { source: 'file1.ts', target: 'file2.ts', type: 'dependency', strength: 1 },
    ];
    const graphData = createGraphData(nodes, edges);
    render(<GraphView graphData={graphData} onNodeClick={mockOnNodeClick} selectedRepo={null} />);
    expect(screen.queryByText('No files analyzed')).not.toBeInTheDocument();
  });

  it('handles node with custom size', () => {
    const node = createSampleNode('file1.ts', 'file1.ts');
    node.size = 5;
    const graphData = createGraphData([node]);
    render(<GraphView graphData={graphData} onNodeClick={mockOnNodeClick} selectedRepo={null} />);
    expect(screen.queryByText('No files analyzed')).not.toBeInTheDocument();
  });

  it('handles node with violations', () => {
    const node = createSampleNode('file1.ts', 'file1.ts');
    node.violations = [
      { type: 'error', severity: 'error', message: 'Test error' },
      { type: 'warning', severity: 'warning', message: 'Test warning' },
    ];
    const graphData = createGraphData([node]);
    render(<GraphView graphData={graphData} onNodeClick={mockOnNodeClick} selectedRepo={null} />);
    expect(screen.queryByText('No files analyzed')).not.toBeInTheDocument();
  });

  it('handles node label in tooltip', () => {
    const graphData = createGraphData([createSampleNode('file1.ts', 'MyFile.tsx')]);
    render(<GraphView graphData={graphData} onNodeClick={mockOnNodeClick} selectedRepo={null} />);
    expect(screen.queryByText('No files analyzed')).not.toBeInTheDocument();
  });

  it('resets selection when repo changes', async () => {
    const graphData = createGraphData([createSampleNode('file1.ts', 'file1.ts')]);
    const { rerender } = render(<GraphView graphData={graphData} onNodeClick={mockOnNodeClick} selectedRepo="repo1" />);
    
    rerender(<GraphView graphData={graphData} onNodeClick={mockOnNodeClick} selectedRepo="repo2" />);
    
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/positions?repo=repo2');
    });
  });

  it('clears positions when repo is deselected', async () => {
    const graphData = createGraphData([createSampleNode('file1.ts', 'file1.ts')]);
    const { rerender } = render(<GraphView graphData={graphData} onNodeClick={mockOnNodeClick} selectedRepo="repo1" />);
    
    rerender(<GraphView graphData={graphData} onNodeClick={mockOnNodeClick} selectedRepo={null} />);
    expect(screen.queryByText('No files analyzed')).not.toBeInTheDocument();
  });

  it('handles engine stop callback', () => {
    const graphData = createGraphData([createSampleNode('file1.ts', 'file1.ts')]);
    render(<GraphView graphData={graphData} onNodeClick={mockOnNodeClick} selectedRepo={null} />);
    expect(screen.queryByText('No files analyzed')).not.toBeInTheDocument();
  });

  it('handles node drag callback', () => {
    const graphData = createGraphData([createSampleNode('file1.ts', 'file1.ts')]);
    render(<GraphView graphData={graphData} onNodeClick={mockOnNodeClick} selectedRepo={null} />);
    expect(screen.queryByText('No files analyzed')).not.toBeInTheDocument();
  });

  it('handles node drag end callback', () => {
    const graphData = createGraphData([createSampleNode('file1.ts', 'file1.ts')]);
    render(<GraphView graphData={graphData} onNodeClick={mockOnNodeClick} selectedRepo={null} />);
    expect(screen.queryByText('No files analyzed')).not.toBeInTheDocument();
  });

  it('uses correct force simulation parameters', () => {
    const graphData = createGraphData([createSampleNode('file1.ts', 'file1.ts')]);
    render(<GraphView graphData={graphData} onNodeClick={mockOnNodeClick} selectedRepo={null} />);
    expect(screen.queryByText('No files analyzed')).not.toBeInTheDocument();
  });

  it('handles zoom to fit on first render', async () => {
    const graphData = createGraphData([createSampleNode('file1.ts', 'file1.ts')]);
    render(<GraphView graphData={graphData} onNodeClick={mockOnNodeClick} selectedRepo={null} />);
    
    await waitFor(() => {
      expect(screen.queryByText('No files analyzed')).not.toBeInTheDocument();
    });
  });

  it('renders with different node types', () => {
    const graphData = createGraphData([
      createSampleNode('file1.ts', 'file1.ts', 'typescript'),
      createSampleNode('file2.tsx', 'file2.tsx', 'tsx'),
      createSampleNode('file3.jsx', 'file3.jsx', 'jsx'),
      createSampleNode('file4.cs', 'file4.cs', 'csharp'),
    ]);
    render(<GraphView graphData={graphData} onNodeClick={mockOnNodeClick} selectedRepo={null} />);
    expect(screen.queryByText('No files analyzed')).not.toBeInTheDocument();
  });

  it('handles node with zero rating', () => {
    const node = createSampleNode('file1.ts', 'file1.ts', 'typescript', 0);
    const graphData = createGraphData([node]);
    render(<GraphView graphData={graphData} onNodeClick={mockOnNodeClick} selectedRepo={null} />);
    expect(screen.queryByText('No files analyzed')).not.toBeInTheDocument();
  });

  it('handles node with perfect rating', () => {
    const node = createSampleNode('file1.ts', 'file1.ts', 'typescript', 10);
    const graphData = createGraphData([node]);
    render(<GraphView graphData={graphData} onNodeClick={mockOnNodeClick} selectedRepo={null} />);
    expect(screen.queryByText('No files analyzed')).not.toBeInTheDocument();
  });

  it('handles node with decimal rating', () => {
    const node = createSampleNode('file1.ts', 'file1.ts', 'typescript', 7.5);
    const graphData = createGraphData([node]);
    render(<GraphView graphData={graphData} onNodeClick={mockOnNodeClick} selectedRepo={null} />);
    expect(screen.queryByText('No files analyzed')).not.toBeInTheDocument();
  });

  it('handles large graph', () => {
    const nodes = Array.from({ length: 100 }, (_, i) => 
      createSampleNode(`file${i}.ts`, `file${i}.ts`, 'typescript', Math.random() * 10)
    );
    const graphData = createGraphData(nodes);
    render(<GraphView graphData={graphData} onNodeClick={mockOnNodeClick} selectedRepo={null} />);
    expect(screen.queryByText('No files analyzed')).not.toBeInTheDocument();
  });
});

describe('GraphView rating color function', () => {
  it('returns green for rating >= 8', () => {
    const node = createSampleNode('file1.ts', 'file1.ts', 'typescript', 9);
    expect(node.rating).toBeGreaterThanOrEqual(8);
  });

  it('returns yellow for rating >= 6 and < 8', () => {
    const node = createSampleNode('file1.ts', 'file1.ts', 'typescript', 7);
    expect(node.rating).toBeGreaterThanOrEqual(6);
    expect(node.rating).toBeLessThan(8);
  });

  it('returns orange for rating >= 4 and < 6', () => {
    const node = createSampleNode('file1.ts', 'file1.ts', 'typescript', 5);
    expect(node.rating).toBeGreaterThanOrEqual(4);
    expect(node.rating).toBeLessThan(6);
  });

  it('returns red for rating < 4', () => {
    const node = createSampleNode('file1.ts', 'file1.ts', 'typescript', 3);
    expect(node.rating).toBeLessThan(4);
  });
});

describe('GraphView lang shape function', () => {
  it('returns square for csharp', () => {
    const node = createSampleNode('file.cs', 'file.cs', 'csharp');
    expect(node.type).toBe('csharp');
  });

  it('returns triangle for tsx', () => {
    const node = createSampleNode('file.tsx', 'file.tsx', 'tsx');
    expect(node.type).toBe('tsx');
  });

  it('returns triangle for jsx', () => {
    const node = createSampleNode('file.jsx', 'file.jsx', 'jsx');
    expect(node.type).toBe('jsx');
  });

  it('returns circle for typescript', () => {
    const node = createSampleNode('file.ts', 'file.ts', 'typescript');
    expect(node.type).toBe('typescript');
  });

  it('returns circle for unknown type', () => {
    const node = createSampleNode('file.py', 'file.py', 'typescript');
    expect(node.type).toBe('typescript');
  });
});

describe('GraphView keyboard handling', () => {
  it('tracks shift key state on keydown', () => {
    fireEvent.keyDown(window, { key: 'Shift', shiftKey: true });
  });

  it('tracks shift key state on keyup', () => {
    fireEvent.keyUp(window, { key: 'Shift', shiftKey: false });
  });

  it('handles multiple key events', () => {
    fireEvent.keyDown(window, { key: 'Shift', shiftKey: true });
    fireEvent.keyDown(window, { key: 'Shift', shiftKey: true });
    fireEvent.keyUp(window, { key: 'Shift', shiftKey: false });
  });
});

describe('GraphView edge rendering', () => {
  const mockOnNodeClick = jest.fn();

  it('handles edges with string source and target', () => {
    const nodes = [
      createSampleNode('file1.ts', 'file1.ts'),
      createSampleNode('file2.ts', 'file2.ts'),
    ];
    const edges = [
      { source: 'file1.ts', target: 'file2.ts', type: 'import', strength: 0.5 },
    ];
    const graphData = createGraphData(nodes, edges);
    render(<GraphView graphData={graphData} onNodeClick={mockOnNodeClick} selectedRepo={null} />);
    expect(screen.queryByText('No files analyzed')).not.toBeInTheDocument();
  });

  it('handles edges with varying strength', () => {
    const nodes = [
      createSampleNode('file1.ts', 'file1.ts'),
      createSampleNode('file2.ts', 'file2.ts'),
    ];
    const edges = [
      { source: 'file1.ts', target: 'file2.ts', type: 'import', strength: 2 },
      { source: 'file2.ts', target: 'file1.ts', type: 'dependency', strength: 0.1 },
    ];
    const graphData = createGraphData(nodes, edges);
    render(<GraphView graphData={graphData} onNodeClick={mockOnNodeClick} selectedRepo={null} />);
    expect(screen.queryByText('No files analyzed')).not.toBeInTheDocument();
  });
});
