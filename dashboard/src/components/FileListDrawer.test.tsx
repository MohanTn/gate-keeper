/**
 * Tests for FileListDrawer component.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { FileListDrawer } from './FileListDrawer';
import type { GraphData, GraphNode } from '../types';

// ── Theme mock (define tokens inline to avoid hoisting issues) ──
const T = {
  text: '#e2e8f0', textMuted: '#94a3b8', textDim: '#64748b', textFaint: '#475569',
  panel: '#1e293b', panelHover: '#334155', elevated: '#334155',
  border: '#334155', borderBright: '#475569', accent: '#3b82f6',
  green: '#22c55e', red: '#ef4444', yellow: '#f59e0b',
};

jest.mock('../ThemeContext', () => ({
  useTheme: () => ({ T }),
  ratingColor: () => '#22c55e',
  healthLabel: () => 'Good',
}));

// ── Fixtures ────────────────────────────────────────────────

function makeNode(
  id: string, label: string, rating = 7,
  violations: GraphNode['violations'] = [],
  linesOfCode = 100,
): GraphNode {
  return {
    id, label, type: 'typescript', rating, size: 1, violations,
    metrics: { linesOfCode, cyclomaticComplexity: 5, numberOfMethods: 3, numberOfClasses: 0, importCount: 2 },
  };
}

function makeGraph(nodes: GraphNode[]): GraphData {
  return { nodes, edges: [] };
}

// ── Tests ───────────────────────────────────────────────────

describe('FileListDrawer', () => {
  const onNodeSelect = jest.fn();
  const onClose = jest.fn();
  beforeEach(() => jest.clearAllMocks());

  it('renders "All Files" header', () => {
    render(<FileListDrawer graphData={makeGraph([makeNode('a', 'a.ts')])} onNodeSelect={onNodeSelect} onClose={onClose} />);
    expect(screen.getByText('All Files')).toBeInTheDocument();
  });

  it('renders Close button and calls onClose when clicked', () => {
    render(<FileListDrawer graphData={makeGraph([makeNode('a', 'a.ts')])} onNodeSelect={onNodeSelect} onClose={onClose} />);
    const btn = screen.getByText('Close');
    fireEvent.click(btn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders summary cards: Score, Issues, Errors', () => {
    const graph = makeGraph([makeNode('a', 'a.ts', 8, [{ type: 't', severity: 'error', message: 'm' }])]);
    render(<FileListDrawer graphData={graph} onNodeSelect={onNodeSelect} onClose={onClose} />);
    expect(screen.getByText('Score')).toBeInTheDocument();
    expect(screen.getAllByText('Issues').length).toBeGreaterThan(0);
    expect(screen.getByText('Errors')).toBeInTheDocument();
  });

  it('renders all file rows', () => {
    const graph = makeGraph([makeNode('a', 'alpha.ts'), makeNode('b', 'beta.ts')]);
    render(<FileListDrawer graphData={graph} onNodeSelect={onNodeSelect} onClose={onClose} />);
    expect(screen.getByText('alpha.ts')).toBeInTheDocument();
    expect(screen.getByText('beta.ts')).toBeInTheDocument();
  });

  it('shows "No files analyzed yet" when graph is empty', () => {
    render(<FileListDrawer graphData={makeGraph([])} onNodeSelect={onNodeSelect} onClose={onClose} />);
    expect(screen.getByText('No files analyzed yet')).toBeInTheDocument();
  });

  it('filters files by search text', () => {
    const graph = makeGraph([makeNode('/src/alpha.ts', 'alpha.ts'), makeNode('/src/beta.ts', 'beta.ts')]);
    render(<FileListDrawer graphData={graph} onNodeSelect={onNodeSelect} onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText('Filter files…'), { target: { value: 'beta' } });
    expect(screen.queryByText('alpha.ts')).not.toBeInTheDocument();
    expect(screen.getByText('beta.ts')).toBeInTheDocument();
  });

  it('shows "No files match your search" when search has no results', () => {
    const graph = makeGraph([makeNode('a', 'alpha.ts')]);
    render(<FileListDrawer graphData={graph} onNodeSelect={onNodeSelect} onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText('Filter files…'), { target: { value: 'zzz' } });
    expect(screen.getByText('No files match your search')).toBeInTheDocument();
  });

  it('calls onNodeSelect when a file row is clicked', () => {
    const graph = makeGraph([makeNode('/a.ts', 'a.ts')]);
    render(<FileListDrawer graphData={graph} onNodeSelect={onNodeSelect} onClose={onClose} />);
    fireEvent.click(screen.getByText('a.ts'));
    expect(onNodeSelect).toHaveBeenCalledWith(expect.objectContaining({ id: '/a.ts' }));
  });

  it('renders column headers: File, Rating, LOC', () => {
    render(<FileListDrawer graphData={makeGraph([makeNode('a', 'a.ts')])} onNodeSelect={onNodeSelect} onClose={onClose} />);
    expect(screen.getByText('File')).toBeInTheDocument();
    // "Rating" is the active sort column so it renders with an arrow indicator
    expect(screen.getByText(/^Rating/)).toBeInTheDocument();
    expect(screen.getByText('LOC')).toBeInTheDocument();
  });

  it('shows error badge on rows with error violations', () => {
    const errNode = makeNode('a', 'a.ts', 5, [{ type: 't', severity: 'error', message: 'bad' }]);
    render(<FileListDrawer graphData={makeGraph([errNode])} onNodeSelect={onNodeSelect} onClose={onClose} />);
    expect(screen.getByText('1 error')).toBeInTheDocument();
  });

  it('renders with custom width', () => {
    const { container } = render(
      <FileListDrawer graphData={makeGraph([])} onNodeSelect={onNodeSelect} onClose={onClose} width={600} />
    );
    // The outer div style should include the custom width
    const outer = container.firstChild as HTMLElement;
    expect(outer.style.flex).toContain('600');
  });
});
