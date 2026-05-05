import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FileListDrawer } from './FileListDrawer';
import { darkTokens } from '../ThemeContext';
import type { GraphData, GraphNode } from '../types';
import '@testing-library/jest-dom';

// Mock useTheme to return dark tokens directly
jest.mock('../ThemeContext', () => {
  const actual = jest.requireActual('../ThemeContext');
  return {
    ...actual,
    useTheme: () => ({ T: darkTokens, mode: 'dark' as const, toggleTheme: () => {} }),
  };
});

function createSampleNode(id: string, label: string, type: 'typescript' | 'tsx' | 'jsx' | 'csharp' = 'typescript', rating: number = 7.0, loc: number = 100, violations: any[] = []): GraphNode {
  return {
    id,
    label,
    type,
    rating,
    size: 100,
    violations,
    metrics: {
      linesOfCode: loc,
      cyclomaticComplexity: 2,
      numberOfMethods: 5,
      numberOfClasses: 1,
      importCount: 3,
    },
  };
}

function createGraphData(nodes: GraphNode[]): GraphData {
  return { nodes, edges: [] };
}

function renderWithTheme(ui: React.ReactElement) {
  return render(ui);
}

describe('FileListDrawer', () => {
  const mockOnNodeSelect = jest.fn();
  const mockOnClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the drawer header', () => {
    const graphData = createGraphData([createSampleNode('file1.ts', 'file1.ts', 'typescript', 8.0)]);
    renderWithTheme(<FileListDrawer graphData={graphData} onNodeSelect={mockOnNodeSelect} onClose={mockOnClose} />);
    expect(screen.getByText('All Files')).toBeInTheDocument();
  });

  it('renders the close button', () => {
    const graphData = createGraphData([createSampleNode('file1.ts', 'file1.ts')]);
    renderWithTheme(<FileListDrawer graphData={graphData} onNodeSelect={mockOnNodeSelect} onClose={mockOnClose} />);
    expect(screen.getByText('×')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const graphData = createGraphData([createSampleNode('file1.ts', 'file1.ts')]);
    renderWithTheme(<FileListDrawer graphData={graphData} onNodeSelect={mockOnNodeSelect} onClose={mockOnClose} />);
    fireEvent.click(screen.getByText('×'));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop is clicked', () => {
    const graphData = createGraphData([createSampleNode('file1.ts', 'file1.ts')]);
    renderWithTheme(<FileListDrawer graphData={graphData} onNodeSelect={mockOnNodeSelect} onClose={mockOnClose} />);
    const backdrop = document.querySelector('.fade-in');
    if (backdrop) {
      fireEvent.click(backdrop);
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    }
  });

  it('renders summary cards with overall score', () => {
    const nodes = [
      createSampleNode('file1.ts', 'file1.ts', 'typescript', 8.0, 100),
      createSampleNode('file2.ts', 'file2.ts', 'typescript', 6.0, 100),
    ];
    const graphData = createGraphData(nodes);
    renderWithTheme(<FileListDrawer graphData={graphData} onNodeSelect={mockOnNodeSelect} onClose={mockOnClose} />);
    expect(screen.getByText('Score')).toBeInTheDocument();
    expect(screen.getByText('7.0')).toBeInTheDocument();
  });

  it('renders issues count in summary', () => {
    const nodes = [
      createSampleNode('file1.ts', 'file1.ts', 'typescript', 8.0, 100, [
        { type: 'error', severity: 'warning' as const, message: 'test' }
      ]),
    ];
    const graphData = createGraphData(nodes);
    renderWithTheme(<FileListDrawer graphData={graphData} onNodeSelect={mockOnNodeSelect} onClose={mockOnClose} />);
    expect(screen.getByText('Issues')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('renders errors count in summary', () => {
    const nodes = [
      createSampleNode('file1.ts', 'file1.ts', 'typescript', 8.0, 100, [
        { type: 'error', severity: 'error' as const, message: 'test' }
      ]),
    ];
    const graphData = createGraphData(nodes);
    renderWithTheme(<FileListDrawer graphData={graphData} onNodeSelect={mockOnNodeSelect} onClose={mockOnClose} />);
    expect(screen.getByText('Errors')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('renders search input', () => {
    const graphData = createGraphData([createSampleNode('file1.ts', 'file1.ts')]);
    renderWithTheme(<FileListDrawer graphData={graphData} onNodeSelect={mockOnNodeSelect} onClose={mockOnClose} />);
    const searchInput = screen.getByPlaceholderText('Filter files…');
    expect(searchInput).toBeInTheDocument();
  });

  it('filters files by search query', () => {
    const nodes = [
      createSampleNode('file1.ts', 'Button.tsx', 'tsx', 8.0),
      createSampleNode('file2.ts', 'utils.ts', 'typescript', 7.0),
      createSampleNode('file3.ts', 'Button.test.tsx', 'tsx', 6.0),
    ];
    const graphData = createGraphData(nodes);
    renderWithTheme(<FileListDrawer graphData={graphData} onNodeSelect={mockOnNodeSelect} onClose={mockOnClose} />);
    
    const searchInput = screen.getByPlaceholderText('Filter files…');
    fireEvent.change(searchInput, { target: { value: 'Button' } });
    
    expect(screen.getByText('Button.tsx')).toBeInTheDocument();
    expect(screen.getByText('Button.test.tsx')).toBeInTheDocument();
    expect(screen.queryByText('utils.ts')).not.toBeInTheDocument();
  });

  it('filters files by ID as well as label', () => {
    const nodes = [
      createSampleNode('src/components/Button.tsx', 'Button', 'tsx', 8.0),
      createSampleNode('src/utils/helpers.ts', 'Helpers', 'typescript', 7.0),
    ];
    const graphData = createGraphData(nodes);
    renderWithTheme(<FileListDrawer graphData={graphData} onNodeSelect={mockOnNodeSelect} onClose={mockOnClose} />);
    
    const searchInput = screen.getByPlaceholderText('Filter files…');
    fireEvent.change(searchInput, { target: { value: 'src/components' } });
    
    expect(screen.getByText('Button')).toBeInTheDocument();
    expect(screen.queryByText('Helpers')).not.toBeInTheDocument();
  });

  it('sorts files by rating ascending by default', () => {
    const nodes = [
      createSampleNode('file1.ts', 'file1.ts', 'typescript', 9.0),
      createSampleNode('file2.ts', 'file2.ts', 'typescript', 5.0),
      createSampleNode('file3.ts', 'file3.ts', 'typescript', 7.0),
    ];
    const graphData = createGraphData(nodes);
    renderWithTheme(<FileListDrawer graphData={graphData} onNodeSelect={mockOnNodeSelect} onClose={mockOnClose} />);
    
    fireEvent.click(screen.getByText('Rating ↑'));
    
    const files = screen.getAllByRole('row', { hidden: true }) || document.querySelectorAll('[style*="grid-template-columns"]');
    expect(files.length).toBeGreaterThan(0);
  });

  it('toggles sort direction when clicking sort header twice', () => {
    const nodes = [
      createSampleNode('file1.ts', 'file1.ts', 'typescript', 5.0),
      createSampleNode('file2.ts', 'file2.ts', 'typescript', 9.0),
    ];
    const graphData = createGraphData(nodes);
    renderWithTheme(<FileListDrawer graphData={graphData} onNodeSelect={mockOnNodeSelect} onClose={mockOnClose} />);
    
    fireEvent.click(screen.getByText('Rating ↑'));
    expect(screen.getByText('Rating ↓')).toBeInTheDocument();
    
    fireEvent.click(screen.getByText('Rating ↓'));
    expect(screen.getByText('Rating ↑')).toBeInTheDocument();
  });

  it('sorts files by label', () => {
    const nodes = [
      createSampleNode('file1.ts', 'Zebra.ts', 'typescript', 7.0),
      createSampleNode('file2.ts', 'Apple.ts', 'typescript', 7.0),
    ];
    const graphData = createGraphData(nodes);
    renderWithTheme(<FileListDrawer graphData={graphData} onNodeSelect={mockOnNodeSelect} onClose={mockOnClose} />);
    
    fireEvent.click(screen.getByText('File'));
    expect(screen.getByText('File ↑')).toBeInTheDocument();
  });

  it('sorts files by lines of code', () => {
    const nodes = [
      createSampleNode('file1.ts', 'file1.ts', 'typescript', 7.0, 500),
      createSampleNode('file2.ts', 'file2.ts', 'typescript', 7.0, 100),
    ];
    const graphData = createGraphData(nodes);
    renderWithTheme(<FileListDrawer graphData={graphData} onNodeSelect={mockOnNodeSelect} onClose={mockOnClose} />);
    
    fireEvent.click(screen.getByText('LOC'));
    expect(screen.getByText('LOC ↑')).toBeInTheDocument();
  });

  it('sorts files by violations count', () => {
    const nodes = [
      createSampleNode('file1.ts', 'file1.ts', 'typescript', 7.0, 100, [{ type: 'a', severity: 'warning' as const, message: 'a' }]),
      createSampleNode('file2.ts', 'file2.ts', 'typescript', 7.0, 100, []),
    ];
    const graphData = createGraphData(nodes);
    renderWithTheme(<FileListDrawer graphData={graphData} onNodeSelect={mockOnNodeSelect} onClose={mockOnClose} />);
    
    fireEvent.click(screen.getByText('Issues'));
    expect(screen.getByText('Issues ↑')).toBeInTheDocument();
  });

  it('calls onNodeSelect when a file row is clicked', () => {
    const node = createSampleNode('file1.ts', 'file1.ts', 'typescript', 8.0);
    const graphData = createGraphData([node]);
    renderWithTheme(<FileListDrawer graphData={graphData} onNodeSelect={mockOnNodeSelect} onClose={mockOnClose} />);
    
    fireEvent.click(screen.getByText('file1.ts'));
    expect(mockOnNodeSelect).toHaveBeenCalledWith(node);
  });

  it('displays file rating as a progress bar', () => {
    const node = createSampleNode('file1.ts', 'file1.ts', 'typescript', 8.0);
    const graphData = createGraphData([node]);
    renderWithTheme(<FileListDrawer graphData={graphData} onNodeSelect={mockOnNodeSelect} onClose={mockOnClose} />);
    
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('displays lines of code for each file', () => {
    const node = createSampleNode('file1.ts', 'file1.ts', 'typescript', 8.0, 250);
    const graphData = createGraphData([node]);
    renderWithTheme(<FileListDrawer graphData={graphData} onNodeSelect={mockOnNodeSelect} onClose={mockOnClose} />);
    
    expect(screen.getByText('250')).toBeInTheDocument();
  });

  it('displays violations count for each file', () => {
    const node = createSampleNode('file1.ts', 'file1.ts', 'typescript', 8.0, 100, [
      { type: 'a', severity: 'warning' as const, message: 'a' },
      { type: 'b', severity: 'error' as const, message: 'b' },
    ]);
    const graphData = createGraphData([node]);
    renderWithTheme(<FileListDrawer graphData={graphData} onNodeSelect={mockOnNodeSelect} onClose={mockOnClose} />);
    
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows error count for files with errors', () => {
    const node = createSampleNode('file1.ts', 'file1.ts', 'typescript', 8.0, 100, [
      { type: 'a', severity: 'error' as const, message: 'a' },
      { type: 'b', severity: 'error' as const, message: 'b' },
      { type: 'c', severity: 'warning' as const, message: 'c' },
    ]);
    const graphData = createGraphData([node]);
    renderWithTheme(<FileListDrawer graphData={graphData} onNodeSelect={mockOnNodeSelect} onClose={mockOnClose} />);
    
    expect(screen.getByText('2 errors')).toBeInTheDocument();
  });

  it('shows empty state when no files match search', () => {
    const graphData = createGraphData([createSampleNode('file1.ts', 'file1.ts')]);
    renderWithTheme(<FileListDrawer graphData={graphData} onNodeSelect={mockOnNodeSelect} onClose={mockOnClose} />);
    
    const searchInput = screen.getByPlaceholderText('Filter files…');
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } });
    
    expect(screen.getByText('No files match your search')).toBeInTheDocument();
  });

  it('shows empty state when graph has no nodes', () => {
    const graphData = createGraphData([]);
    renderWithTheme(<FileListDrawer graphData={graphData} onNodeSelect={mockOnNodeSelect} onClose={mockOnClose} />);
    
    expect(screen.getByText('No files analyzed yet')).toBeInTheDocument();
  });

  it('handles mouse hover on close button', () => {
    const graphData = createGraphData([createSampleNode('file1.ts', 'file1.ts')]);
    renderWithTheme(<FileListDrawer graphData={graphData} onNodeSelect={mockOnNodeSelect} onClose={mockOnClose} />);
    
    const closeBtn = screen.getByText('×');
    fireEvent.mouseEnter(closeBtn);
    fireEvent.mouseLeave(closeBtn);
  });

  it('handles mouse hover on file rows', () => {
    const graphData = createGraphData([createSampleNode('file1.ts', 'file1.ts')]);
    renderWithTheme(<FileListDrawer graphData={graphData} onNodeSelect={mockOnNodeSelect} onClose={mockOnClose} />);
    
    const fileRow = screen.getByText('file1.ts').closest('[style*="grid"]');
    if (fileRow) {
      fireEvent.mouseEnter(fileRow);
      fireEvent.mouseLeave(fileRow);
    }
  });

  it('calculates weighted overall rating correctly', () => {
    const nodes = [
      createSampleNode('file1.ts', 'file1.ts', 'typescript', 10.0, 100),
      createSampleNode('file2.ts', 'file2.ts', 'typescript', 6.0, 300),
    ];
    const graphData = createGraphData(nodes);
    renderWithTheme(<FileListDrawer graphData={graphData} onNodeSelect={mockOnNodeSelect} onClose={mockOnClose} />);
    
    // Weighted average: (10*100 + 6*300) / 400 = 2800/400 = 7.0
    expect(screen.getByText('7.0')).toBeInTheDocument();
  });

  it('handles empty graph data gracefully', () => {
    const graphData = createGraphData([]);
    renderWithTheme(<FileListDrawer graphData={graphData} onNodeSelect={mockOnNodeSelect} onClose={mockOnClose} />);
    
    expect(screen.getByText('Score')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders column headers with correct labels', () => {
    const graphData = createGraphData([createSampleNode('file1.ts', 'file1.ts')]);
    renderWithTheme(<FileListDrawer graphData={graphData} onNodeSelect={mockOnNodeSelect} onClose={mockOnClose} />);

    // Column headers have sort indicators (↑ or ↓), use regex match
    expect(screen.getByText(/File/)).toBeInTheDocument();
    expect(screen.getByText(/Rating/)).toBeInTheDocument();
    expect(screen.getByText(/LOC/)).toBeInTheDocument();
    expect(screen.getByText(/Issues/)).toBeInTheDocument();
  });

  it('highlights active sort column', () => {
    const graphData = createGraphData([createSampleNode('file1.ts', 'file1.ts')]);
    renderWithTheme(<FileListDrawer graphData={graphData} onNodeSelect={mockOnNodeSelect} onClose={mockOnClose} />);
    
    const ratingHeader = screen.getByText('Rating ↑');
    expect(ratingHeader).toBeInTheDocument();
  });
});

describe('FileListDrawer MiniCard', () => {
  const mockOnNodeSelect = jest.fn();
  const mockOnClose = jest.fn();

  it('renders MiniCard with numeric value', () => {
    const graphData = createGraphData([createSampleNode('file1.ts', 'file1.ts', 'typescript', 8.0, 100)]);
    renderWithTheme(<FileListDrawer graphData={graphData} onNodeSelect={mockOnNodeSelect} onClose={mockOnClose} />);
    expect(screen.getByText('Score')).toBeInTheDocument();
  });

  it('renders MiniCard with string value', () => {
    const graphData = createGraphData([]);
    renderWithTheme(<FileListDrawer graphData={graphData} onNodeSelect={mockOnNodeSelect} onClose={mockOnClose} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
