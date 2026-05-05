import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ViolationsPanel } from './ViolationsPanel';
import { darkTokens } from '../ThemeContext';
import type { GraphData, GraphNode, Violation } from '../types';
import '@testing-library/jest-dom';

// Mock useTheme to return dark tokens directly
jest.mock('../ThemeContext', () => {
  const actual = jest.requireActual('../ThemeContext');
  return {
    ...actual,
    useTheme: () => ({ T: darkTokens, mode: 'dark' as const, toggleTheme: () => {} }),
  };
});

function createSampleNode(id: string, label: string, violations: Violation[] = []): GraphNode {
  return {
    id,
    label,
    type: 'typescript' as const,
    rating: 7.0,
    size: 100,
    violations,
    metrics: {
      linesOfCode: 100,
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

describe('ViolationsPanel', () => {
  const mockOnClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the panel header', () => {
    const graphData = createGraphData([]);
    renderWithTheme(<ViolationsPanel graphData={graphData} onClose={mockOnClose} T={darkTokens} />);
    expect(screen.getByText('All Violations')).toBeInTheDocument();
  });

  it('renders the close button', () => {
    const graphData = createGraphData([]);
    renderWithTheme(<ViolationsPanel graphData={graphData} onClose={mockOnClose} T={darkTokens} />);
    expect(screen.getByText('×')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const graphData = createGraphData([]);
    renderWithTheme(<ViolationsPanel graphData={graphData} onClose={mockOnClose} T={darkTokens} />);
    fireEvent.click(screen.getByText('×'));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop is clicked', () => {
    const graphData = createGraphData([]);
    renderWithTheme(<ViolationsPanel graphData={graphData} onClose={mockOnClose} T={darkTokens} />);
    const backdrop = document.querySelector('.fade-in');
    if (backdrop) {
      fireEvent.click(backdrop);
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    }
  });

  it('renders copy button', () => {
    const graphData = createGraphData([]);
    renderWithTheme(<ViolationsPanel graphData={graphData} onClose={mockOnClose} T={darkTokens} />);
    expect(screen.getByText('⎘ Copy')).toBeInTheDocument();
  });

  it('shows "Copied" text after clicking copy', async () => {
    const graphData = createGraphData([]);
    // Mock clipboard API
    const mockClipboard = {
      writeText: jest.fn().mockResolvedValue(undefined),
    };
    Object.assign(navigator, { clipboard: mockClipboard });

    renderWithTheme(<ViolationsPanel graphData={graphData} onClose={mockOnClose} T={darkTokens} />);
    fireEvent.click(screen.getByText('⎘ Copy'));
    
    await waitFor(() => {
      expect(screen.getByText('✓ Copied')).toBeInTheDocument();
    });
  });

  it('renders severity filter buttons', () => {
    const graphData = createGraphData([]);
    renderWithTheme(<ViolationsPanel graphData={graphData} onClose={mockOnClose} T={darkTokens} />);
    expect(screen.getByText('All 0')).toBeInTheDocument();
    expect(screen.getByText('Errors 0')).toBeInTheDocument();
    expect(screen.getByText('Warnings 0')).toBeInTheDocument();
    expect(screen.getByText('Info 0')).toBeInTheDocument();
  });

  it('filters violations by severity - All', () => {
    const nodes = [
      createSampleNode('file1.ts', 'file1.ts', [
        { type: 'error', severity: 'error', message: 'Error message' },
        { type: 'warning', severity: 'warning', message: 'Warning message' },
        { type: 'info', severity: 'info', message: 'Info message' },
      ]),
    ];
    const graphData = createGraphData(nodes);
    renderWithTheme(<ViolationsPanel graphData={graphData} onClose={mockOnClose} T={darkTokens} />);
    
    fireEvent.click(screen.getByText('All 3'));
    expect(screen.getByText('Error message')).toBeInTheDocument();
    expect(screen.getByText('Warning message')).toBeInTheDocument();
    expect(screen.getByText('Info message')).toBeInTheDocument();
  });

  it('filters violations by severity - Errors', () => {
    const nodes = [
      createSampleNode('file1.ts', 'file1.ts', [
        { type: 'error', severity: 'error', message: 'Error message' },
        { type: 'warning', severity: 'warning', message: 'Warning message' },
      ]),
    ];
    const graphData = createGraphData(nodes);
    renderWithTheme(<ViolationsPanel graphData={graphData} onClose={mockOnClose} T={darkTokens} />);
    
    fireEvent.click(screen.getByText('Errors 1'));
    expect(screen.getByText('Error message')).toBeInTheDocument();
    expect(screen.queryByText('Warning message')).not.toBeInTheDocument();
  });

  it('filters violations by severity - Warnings', () => {
    const nodes = [
      createSampleNode('file1.ts', 'file1.ts', [
        { type: 'error', severity: 'error', message: 'Error message' },
        { type: 'warning', severity: 'warning', message: 'Warning message' },
      ]),
    ];
    const graphData = createGraphData(nodes);
    renderWithTheme(<ViolationsPanel graphData={graphData} onClose={mockOnClose} T={darkTokens} />);
    
    fireEvent.click(screen.getByText('Warnings 1'));
    expect(screen.getByText('Warning message')).toBeInTheDocument();
    expect(screen.queryByText('Error message')).not.toBeInTheDocument();
  });

  it('filters violations by severity - Info', () => {
    const nodes = [
      createSampleNode('file1.ts', 'file1.ts', [
        { type: 'info', severity: 'info', message: 'Info message' },
        { type: 'error', severity: 'error', message: 'Error message' },
      ]),
    ];
    const graphData = createGraphData(nodes);
    renderWithTheme(<ViolationsPanel graphData={graphData} onClose={mockOnClose} T={darkTokens} />);
    
    fireEvent.click(screen.getByText('Info 1'));
    expect(screen.getByText('Info message')).toBeInTheDocument();
    expect(screen.queryByText('Error message')).not.toBeInTheDocument();
  });

  it('renders search input', () => {
    const graphData = createGraphData([]);
    renderWithTheme(<ViolationsPanel graphData={graphData} onClose={mockOnClose} T={darkTokens} />);
    expect(screen.getByPlaceholderText('Filter by file or message…')).toBeInTheDocument();
  });

  it('filters violations by search query - message', () => {
    const nodes = [
      createSampleNode('file1.ts', 'file1.ts', [
        { type: 'error', severity: 'error', message: 'Missing key prop' },
        { type: 'warning', severity: 'warning', message: 'Use of any type' },
      ]),
    ];
    const graphData = createGraphData(nodes);
    renderWithTheme(<ViolationsPanel graphData={graphData} onClose={mockOnClose} T={darkTokens} />);
    
    const searchInput = screen.getByPlaceholderText('Filter by file or message…');
    fireEvent.change(searchInput, { target: { value: 'key' } });
    
    expect(screen.getByText('Missing key prop')).toBeInTheDocument();
    expect(screen.queryByText('Use of any type')).not.toBeInTheDocument();
  });

  it('filters violations by search query - file name', () => {
    const nodes = [
      createSampleNode('Button.tsx', 'Button.tsx', [
        { type: 'error', severity: 'error', message: 'Missing key' },
      ]),
      createSampleNode('utils.ts', 'utils.ts', [
        { type: 'warning', severity: 'warning', message: 'Console log' },
      ]),
    ];
    const graphData = createGraphData(nodes);
    renderWithTheme(<ViolationsPanel graphData={graphData} onClose={mockOnClose} T={darkTokens} />);
    
    const searchInput = screen.getByPlaceholderText('Filter by file or message…');
    fireEvent.change(searchInput, { target: { value: 'Button' } });
    
    expect(screen.getByText('Missing key')).toBeInTheDocument();
    expect(screen.queryByText('Console log')).not.toBeInTheDocument();
  });

  it('filters violations by search query - type', () => {
    const nodes = [
      createSampleNode('file1.ts', 'file1.ts', [
        { type: 'missing_key', severity: 'error', message: 'Missing key' },
        { type: 'console_log', severity: 'warning', message: 'Console log' },
      ]),
    ];
    const graphData = createGraphData(nodes);
    renderWithTheme(<ViolationsPanel graphData={graphData} onClose={mockOnClose} T={darkTokens} />);
    
    const searchInput = screen.getByPlaceholderText('Filter by file or message…');
    fireEvent.change(searchInput, { target: { value: 'missing' } });
    
    expect(screen.getByText('Missing key')).toBeInTheDocument();
  });

  it('groups violations by file', () => {
    const nodes = [
      createSampleNode('file1.ts', 'file1.ts', [
        { type: 'error', severity: 'error', message: 'Error 1' },
        { type: 'error', severity: 'error', message: 'Error 2' },
      ]),
      createSampleNode('file2.ts', 'file2.ts', [
        { type: 'warning', severity: 'warning', message: 'Warning 1' },
      ]),
    ];
    const graphData = createGraphData(nodes);
    renderWithTheme(<ViolationsPanel graphData={graphData} onClose={mockOnClose} T={darkTokens} />);
    
    expect(screen.getByText('file1.ts')).toBeInTheDocument();
    expect(screen.getByText('file2.ts')).toBeInTheDocument();
  });

  it('sorts file groups by violation count descending', () => {
    const nodes = [
      createSampleNode('file1.ts', 'file1.ts', [
        { type: 'error', severity: 'error', message: 'Error 1' },
      ]),
      createSampleNode('file2.ts', 'file2.ts', [
        { type: 'warning', severity: 'warning', message: 'Warning 1' },
        { type: 'warning', severity: 'warning', message: 'Warning 2' },
        { type: 'warning', severity: 'warning', message: 'Warning 3' },
      ]),
    ];
    const graphData = createGraphData(nodes);
    renderWithTheme(<ViolationsPanel graphData={graphData} onClose={mockOnClose} T={darkTokens} />);
    
    // file2.ts should appear first (3 violations vs 1)
    const fileLabels = screen.getAllByText(/file\d+\.ts/);
    expect(fileLabels[0].textContent).toBe('file2.ts');
  });

  it('toggles file group expansion', () => {
    const nodes = [
      createSampleNode('file1.ts', 'file1.ts', [
        { type: 'error', severity: 'error', message: 'Error 1' },
        { type: 'error', severity: 'error', message: 'Error 2' },
      ]),
    ];
    const graphData = createGraphData(nodes);
    renderWithTheme(<ViolationsPanel graphData={graphData} onClose={mockOnClose} T={darkTokens} />);
    
    // Initially expanded - violations visible
    expect(screen.getByText('Error 1')).toBeInTheDocument();
    
    // Click to collapse
    fireEvent.click(screen.getByText('file1.ts'));
    expect(screen.queryByText('Error 1')).not.toBeInTheDocument();
    
    // Click to expand again
    fireEvent.click(screen.getByText('file1.ts'));
    expect(screen.getByText('Error 1')).toBeInTheDocument();
  });

  it('displays error count badge for files with errors', () => {
    const nodes = [
      createSampleNode('file1.ts', 'file1.ts', [
        { type: 'error', severity: 'error', message: 'Error 1' },
        { type: 'error', severity: 'error', message: 'Error 2' },
        { type: 'warning', severity: 'warning', message: 'Warning 1' },
      ]),
    ];
    const graphData = createGraphData(nodes);
    renderWithTheme(<ViolationsPanel graphData={graphData} onClose={mockOnClose} T={darkTokens} />);
    
    expect(screen.getByText('2 errors')).toBeInTheDocument();
  });

  it('displays violation severity badges', () => {
    const nodes = [
      createSampleNode('file1.ts', 'file1.ts', [
        { type: 'error', severity: 'error', message: 'Error' },
        { type: 'warning', severity: 'warning', message: 'Warning' },
        { type: 'info', severity: 'info', message: 'Info' },
      ]),
    ];
    const graphData = createGraphData(nodes);
    renderWithTheme(<ViolationsPanel graphData={graphData} onClose={mockOnClose} T={darkTokens} />);
    
    expect(screen.getByText('ERR')).toBeInTheDocument();
    expect(screen.getByText('WARN')).toBeInTheDocument();
    expect(screen.getByText('INFO')).toBeInTheDocument();
  });

  it('displays violation line numbers', () => {
    const nodes = [
      createSampleNode('file1.ts', 'file1.ts', [
        { type: 'error', severity: 'error', message: 'Error on line', line: 42 },
      ]),
    ];
    const graphData = createGraphData(nodes);
    renderWithTheme(<ViolationsPanel graphData={graphData} onClose={mockOnClose} T={darkTokens} />);
    
    expect(screen.getByText('line 42')).toBeInTheDocument();
  });

  it('displays violation fix suggestions', () => {
    const nodes = [
      createSampleNode('file1.ts', 'file1.ts', [
        { type: 'error', severity: 'error', message: 'Missing import', fix: 'Add import statement' },
      ]),
    ];
    const graphData = createGraphData(nodes);
    renderWithTheme(<ViolationsPanel graphData={graphData} onClose={mockOnClose} T={darkTokens} />);
    
    expect(screen.getByText('→ Add import statement')).toBeInTheDocument();
  });

  it('shows empty state when no violations', () => {
    const graphData = createGraphData([]);
    renderWithTheme(<ViolationsPanel graphData={graphData} onClose={mockOnClose} T={darkTokens} />);
    
    expect(screen.getByText('No violations found')).toBeInTheDocument();
  });

  it('shows filtered empty state when filter yields no results', () => {
    const nodes = [
      createSampleNode('file1.ts', 'file1.ts', [
        { type: 'warning', severity: 'warning', message: 'Warning' },
      ]),
    ];
    const graphData = createGraphData(nodes);
    renderWithTheme(<ViolationsPanel graphData={graphData} onClose={mockOnClose} T={darkTokens} />);
    
    fireEvent.click(screen.getByText('Errors 0'));
    expect(screen.getByText('No violations match your filter')).toBeInTheDocument();
  });

  it('shows search empty state when search yields no results', () => {
    const nodes = [
      createSampleNode('file1.ts', 'file1.ts', [
        { type: 'warning', severity: 'warning', message: 'Warning' },
      ]),
    ];
    const graphData = createGraphData(nodes);
    renderWithTheme(<ViolationsPanel graphData={graphData} onClose={mockOnClose} T={darkTokens} />);
    
    const searchInput = screen.getByPlaceholderText('Filter by file or message…');
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } });
    
    expect(screen.getByText('No violations match your filter')).toBeInTheDocument();
  });

  it('displays violation count summary', () => {
    const nodes = [
      createSampleNode('file1.ts', 'file1.ts', [
        { type: 'error', severity: 'error', message: 'Error 1' },
        { type: 'error', severity: 'error', message: 'Error 2' },
      ]),
      createSampleNode('file2.ts', 'file2.ts', [
        { type: 'warning', severity: 'warning', message: 'Warning 1' },
      ]),
    ];
    const graphData = createGraphData(nodes);
    renderWithTheme(<ViolationsPanel graphData={graphData} onClose={mockOnClose} T={darkTokens} />);
    
    expect(screen.getByText('3 violations across 2 files')).toBeInTheDocument();
  });

  it('handles clipboard API not available', async () => {
    const graphData = createGraphData([
      createSampleNode('file1.ts', 'file1.ts', [
        { type: 'error', severity: 'error', message: 'Error' },
      ]),
    ]);
    
    // Mock clipboard to fail
    const mockClipboard = {
      writeText: jest.fn().mockRejectedValue(new Error('Not available')),
    };
    Object.assign(navigator, { clipboard: mockClipboard });

    renderWithTheme(<ViolationsPanel graphData={graphData} onClose={mockOnClose} T={darkTokens} />);
    fireEvent.click(screen.getByText('⎘ Copy'));
    
    // Should not crash, just won't show "Copied"
    await waitFor(() => {
      expect(screen.getByText('⎘ Copy')).toBeInTheDocument();
    });
  });

  it('handles mouse hover on file group headers', () => {
    const nodes = [
      createSampleNode('file1.ts', 'file1.ts', [
        { type: 'error', severity: 'error', message: 'Error' },
      ]),
    ];
    const graphData = createGraphData(nodes);
    renderWithTheme(<ViolationsPanel graphData={graphData} onClose={mockOnClose} T={darkTokens} />);
    
    const groupHeader = screen.getByText('file1.ts').closest('[style*="cursor: pointer"]');
    if (groupHeader) {
      fireEvent.mouseEnter(groupHeader);
      fireEvent.mouseLeave(groupHeader);
    }
  });

  it('handles focus and blur on search input', () => {
    const graphData = createGraphData([]);
    renderWithTheme(<ViolationsPanel graphData={graphData} onClose={mockOnClose} T={darkTokens} />);
    
    const searchInput = screen.getByPlaceholderText('Filter by file or message…');
    fireEvent.focus(searchInput);
    fireEvent.blur(searchInput);
  });

  it('handles focus and blur on close button', () => {
    const graphData = createGraphData([]);
    renderWithTheme(<ViolationsPanel graphData={graphData} onClose={mockOnClose} T={darkTokens} />);
    
    const closeBtn = screen.getByText('×');
    fireEvent.mouseEnter(closeBtn);
    fireEvent.mouseLeave(closeBtn);
  });

  it('copies violations with line numbers and fix suggestions', async () => {
    const nodes = [
      createSampleNode('file1.ts', 'file1.ts', [
        { type: 'error', severity: 'error', message: 'Error with line', line: 10, fix: 'Fix it' },
        { type: 'warning', severity: 'warning', message: 'Warning without line' },
      ]),
    ];
    const graphData = createGraphData(nodes);
    
    const mockClipboard = {
      writeText: jest.fn().mockResolvedValue(undefined),
    };
    Object.assign(navigator, { clipboard: mockClipboard });

    renderWithTheme(<ViolationsPanel graphData={graphData} onClose={mockOnClose} T={darkTokens} />);
    fireEvent.click(screen.getByText('⎘ Copy'));
    
    await waitFor(() => {
      expect(mockClipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('file1.ts')
      );
    });
  });

  it('handles singular/plural in violation count summary', () => {
    const nodes = [
      createSampleNode('file1.ts', 'file1.ts', [
        { type: 'error', severity: 'error', message: 'Error' },
      ]),
    ];
    const graphData = createGraphData(nodes);
    renderWithTheme(<ViolationsPanel graphData={graphData} onClose={mockOnClose} T={darkTokens} />);
    
    expect(screen.getByText('1 violation across 1 file')).toBeInTheDocument();
  });
});

describe('ViolationsPanel severity colors', () => {
  const mockOnClose = jest.fn();

  it('uses red color for error severity', () => {
    const nodes = [
      createSampleNode('file1.ts', 'file1.ts', [
        { type: 'error', severity: 'error', message: 'Error' },
      ]),
    ];
    const graphData = createGraphData(nodes);
    const { container } = renderWithTheme(<ViolationsPanel graphData={graphData} onClose={mockOnClose} T={darkTokens} />);
    expect(container.innerHTML).toContain(darkTokens.red);
  });

  it('uses yellow color for warning severity', () => {
    const nodes = [
      createSampleNode('file1.ts', 'file1.ts', [
        { type: 'warning', severity: 'warning', message: 'Warning' },
      ]),
    ];
    const graphData = createGraphData(nodes);
    const { container } = renderWithTheme(<ViolationsPanel graphData={graphData} onClose={mockOnClose} T={darkTokens} />);
    expect(container.innerHTML).toContain(darkTokens.yellow);
  });
});
