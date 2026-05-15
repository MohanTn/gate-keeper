import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ViolationsPanel } from './ViolationsPanel';
import { darkTokens } from '../ThemeContext';
import type { GraphData, GraphNode, Violation } from '../types';
import '@testing-library/jest-dom';

jest.mock('../ThemeContext', () => {
  const actual = jest.requireActual('../ThemeContext');
  return {
    ...actual,
    useTheme: () => ({ T: darkTokens, mode: 'dark' as const, toggleTheme: () => {} }),
    ratingColor: (_: number, T: Record<string, string>) => T.text,
    healthLabel: () => 'Good',
  };
});

function makeNode(id: string, label: string, violations: Violation[] = []): GraphNode {
  return {
    id,
    label,
    type: 'typescript',
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

function makeGraphData(nodes: GraphNode[]): GraphData {
  return { nodes, edges: [] };
}

describe('ViolationsPanel', () => {
  const onClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(navigator, {
      clipboard: { writeText: jest.fn().mockResolvedValue(undefined) },
    });
  });

  it('renders panel header', () => {
    render(<ViolationsPanel graphData={makeGraphData([])} onClose={onClose} T={darkTokens} />);
    expect(screen.getByText('All Violations')).toBeInTheDocument();
  });

  it('renders all violation counts in filter tabs', () => {
    const node = makeNode('a.ts', 'a.ts', [
      { type: 't', severity: 'error', message: 'E' },
      { type: 't', severity: 'warning', message: 'W' },
      { type: 't', severity: 'info', message: 'I' },
    ]);
    render(<ViolationsPanel graphData={makeGraphData([node])} onClose={onClose} T={darkTokens} />);
    expect(screen.getByText('All 3')).toBeInTheDocument();
    expect(screen.getByText('Errors 1')).toBeInTheDocument();
    expect(screen.getByText('Warnings 1')).toBeInTheDocument();
    expect(screen.getByText('Info 1')).toBeInTheDocument();
  });

  it('filters to errors-only when Errors button clicked', () => {
    const node = makeNode('a.ts', 'a.ts', [
      { type: 't', severity: 'error', message: 'Error message' },
      { type: 't', severity: 'warning', message: 'Warning message' },
    ]);
    render(<ViolationsPanel graphData={makeGraphData([node])} onClose={onClose} T={darkTokens} />);
    fireEvent.click(screen.getByText('Errors 1'));
    expect(screen.getByText('Error message')).toBeInTheDocument();
    expect(screen.queryByText('Warning message')).not.toBeInTheDocument();
  });

  it('filters by search text', () => {
    const node = makeNode('a.ts', 'a.ts', [
      { type: 't', severity: 'error', message: 'Missing key prop' },
      { type: 't', severity: 'warning', message: 'Use of any type' },
    ]);
    render(<ViolationsPanel graphData={makeGraphData([node])} onClose={onClose} T={darkTokens} />);
    fireEvent.change(screen.getByPlaceholderText('Filter by file or message…'), {
      target: { value: 'key' },
    });
    expect(screen.getByText('Missing key prop')).toBeInTheDocument();
    expect(screen.queryByText('Use of any type')).not.toBeInTheDocument();
  });

  it('shows "No violations found" for empty graph', () => {
    render(<ViolationsPanel graphData={makeGraphData([])} onClose={onClose} T={darkTokens} />);
    expect(screen.getByText('No violations found')).toBeInTheDocument();
  });

  it('shows "No violations match your filter" when severity filter has no results', () => {
    const node = makeNode('a.ts', 'a.ts', [
      { type: 't', severity: 'warning', message: 'Warning' },
    ]);
    render(<ViolationsPanel graphData={makeGraphData([node])} onClose={onClose} T={darkTokens} />);
    fireEvent.click(screen.getByText('Errors 0'));
    expect(screen.getByText('No violations match your filter')).toBeInTheDocument();
  });

  it('shows "No violations match your filter" when search has no results', () => {
    const node = makeNode('a.ts', 'a.ts', [
      { type: 't', severity: 'warning', message: 'Warning' },
    ]);
    render(<ViolationsPanel graphData={makeGraphData([node])} onClose={onClose} T={darkTokens} />);
    fireEvent.change(screen.getByPlaceholderText('Filter by file or message…'), {
      target: { value: 'nonexistent-xyz' },
    });
    expect(screen.getByText('No violations match your filter')).toBeInTheDocument();
  });

  it('toggles collapse/expand on file group click', () => {
    const node = makeNode('a.ts', 'a.ts', [
      { type: 't', severity: 'error', message: 'Error 1' },
    ]);
    render(<ViolationsPanel graphData={makeGraphData([node])} onClose={onClose} T={darkTokens} />);
    expect(screen.getByText('Error 1')).toBeInTheDocument();
    fireEvent.click(screen.getByText('a.ts'));
    expect(screen.queryByText('Error 1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('a.ts'));
    expect(screen.getByText('Error 1')).toBeInTheDocument();
  });

  it('copy button triggers clipboard.writeText', async () => {
    const node = makeNode('a.ts', 'a.ts', [
      { type: 't', severity: 'error', message: 'Some error' },
    ]);
    render(<ViolationsPanel graphData={makeGraphData([node])} onClose={onClose} T={darkTokens} />);
    fireEvent.click(screen.getByTitle('Copy all visible violations'));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('a.ts')
      );
    });
  });

  it('shows Copied after copy button clicked', async () => {
    render(<ViolationsPanel graphData={makeGraphData([])} onClose={onClose} T={darkTokens} />);
    fireEvent.click(screen.getByTitle('Copy all visible violations'));
    await waitFor(() => {
      expect(screen.getByText('Copied')).toBeInTheDocument();
    });
  });

  it('calls onClose when Close button is clicked', () => {
    render(<ViolationsPanel graphData={makeGraphData([])} onClose={onClose} T={darkTokens} />);
    fireEvent.click(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop is clicked', () => {
    render(<ViolationsPanel graphData={makeGraphData([])} onClose={onClose} T={darkTokens} />);
    const backdrop = document.querySelector('.fade-in');
    if (backdrop) fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('displays violation severity badges ERR/WARN/INFO', () => {
    const node = makeNode('a.ts', 'a.ts', [
      { type: 't', severity: 'error', message: 'E' },
      { type: 't', severity: 'warning', message: 'W' },
      { type: 't', severity: 'info', message: 'I' },
    ]);
    render(<ViolationsPanel graphData={makeGraphData([node])} onClose={onClose} T={darkTokens} />);
    expect(screen.getByText('ERR')).toBeInTheDocument();
    expect(screen.getByText('WARN')).toBeInTheDocument();
    expect(screen.getByText('INFO')).toBeInTheDocument();
  });

  it('displays line numbers when present', () => {
    const node = makeNode('a.ts', 'a.ts', [
      { type: 't', severity: 'error', message: 'Error on line', line: 42 },
    ]);
    render(<ViolationsPanel graphData={makeGraphData([node])} onClose={onClose} T={darkTokens} />);
    expect(screen.getByText('line 42')).toBeInTheDocument();
  });

  it('displays fix suggestions when present', () => {
    const node = makeNode('a.ts', 'a.ts', [
      { type: 't', severity: 'error', message: 'Missing import', fix: 'Add import statement' },
    ]);
    render(<ViolationsPanel graphData={makeGraphData([node])} onClose={onClose} T={darkTokens} />);
    expect(screen.getByText('→ Add import statement')).toBeInTheDocument();
  });

  it('shows error count badge for files with errors', () => {
    const node = makeNode('a.ts', 'a.ts', [
      { type: 't', severity: 'error', message: 'E1' },
      { type: 't', severity: 'error', message: 'E2' },
      { type: 't', severity: 'warning', message: 'W' },
    ]);
    render(<ViolationsPanel graphData={makeGraphData([node])} onClose={onClose} T={darkTokens} />);
    expect(screen.getByText('2 errors')).toBeInTheDocument();
  });

  it('groups violations by file', () => {
    const nodes = [
      makeNode('file1.ts', 'file1.ts', [{ type: 't', severity: 'error', message: 'Err' }]),
      makeNode('file2.ts', 'file2.ts', [{ type: 't', severity: 'warning', message: 'Warn' }]),
    ];
    render(<ViolationsPanel graphData={makeGraphData(nodes)} onClose={onClose} T={darkTokens} />);
    expect(screen.getByText('file1.ts')).toBeInTheDocument();
    expect(screen.getByText('file2.ts')).toBeInTheDocument();
  });

  it('displays violation count summary', () => {
    const nodes = [
      makeNode('file1.ts', 'file1.ts', [
        { type: 't', severity: 'error', message: 'E1' },
        { type: 't', severity: 'error', message: 'E2' },
      ]),
      makeNode('file2.ts', 'file2.ts', [
        { type: 't', severity: 'warning', message: 'W1' },
      ]),
    ];
    render(<ViolationsPanel graphData={makeGraphData(nodes)} onClose={onClose} T={darkTokens} />);
    expect(screen.getByText('3 violations across 2 files')).toBeInTheDocument();
  });

  it('shows singular form for 1 violation / 1 file', () => {
    const node = makeNode('a.ts', 'a.ts', [
      { type: 't', severity: 'error', message: 'E' },
    ]);
    render(<ViolationsPanel graphData={makeGraphData([node])} onClose={onClose} T={darkTokens} />);
    expect(screen.getByText('1 violation across 1 file')).toBeInTheDocument();
  });

  it('handles clipboard API failure gracefully', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: jest.fn().mockRejectedValue(new Error('Not available')) },
    });
    render(<ViolationsPanel graphData={makeGraphData([])} onClose={onClose} T={darkTokens} />);
    fireEvent.click(screen.getByTitle('Copy all visible violations'));
    await waitFor(() => {
      expect(screen.getByText('Copy')).toBeInTheDocument();
    });
  });

  it('filters violations by file name via search', () => {
    const nodes = [
      makeNode('Button.tsx', 'Button.tsx', [{ type: 't', severity: 'error', message: 'Missing key' }]),
      makeNode('utils.ts', 'utils.ts', [{ type: 't', severity: 'warning', message: 'Console log' }]),
    ];
    render(<ViolationsPanel graphData={makeGraphData(nodes)} onClose={onClose} T={darkTokens} />);
    fireEvent.change(screen.getByPlaceholderText('Filter by file or message…'), {
      target: { value: 'Button' },
    });
    expect(screen.getByText('Missing key')).toBeInTheDocument();
    expect(screen.queryByText('Console log')).not.toBeInTheDocument();
  });

  it('sorts file groups by violation count descending', () => {
    const nodes = [
      makeNode('file1.ts', 'file1.ts', [{ type: 't', severity: 'error', message: 'E' }]),
      makeNode('file2.ts', 'file2.ts', [
        { type: 't', severity: 'warning', message: 'W1' },
        { type: 't', severity: 'warning', message: 'W2' },
        { type: 't', severity: 'warning', message: 'W3' },
      ]),
    ];
    render(<ViolationsPanel graphData={makeGraphData(nodes)} onClose={onClose} T={darkTokens} />);
    const fileLabels = screen.getAllByText(/file\d+\.ts/);
    expect(fileLabels[0].textContent).toBe('file2.ts');
  });
});
