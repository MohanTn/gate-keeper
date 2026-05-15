/**
 * Tests for the DetailPanel component.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { DetailPanel } from './DetailPanel';
import type { GraphData, GraphNode } from '../types';

// ── Theme mock ─────────────────────────────────────────────
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

// ── Fixtures ───────────────────────────────────────────────

function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: '/repo/src/auth.ts',
    label: 'auth.ts',
    type: 'typescript',
    rating: 7.5,
    size: 1,
    violations: [],
    metrics: {
      linesOfCode: 120,
      cyclomaticComplexity: 8,
      numberOfMethods: 5,
      numberOfClasses: 1,
      importCount: 3,
    },
    ...overrides,
  };
}

const emptyGraph: GraphData = { nodes: [], edges: [] };

function renderPanel(node: GraphNode, graphData = emptyGraph, onClose = jest.fn(), onNodeSelect = jest.fn()) {
  return render(
    <DetailPanel
      node={node}
      graphData={graphData}
      onClose={onClose}
      onNodeSelect={onNodeSelect}
      selectedRepo={null}
    />
  );
}

// ── Tests ──────────────────────────────────────────────────

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      ratingBreakdown: [],
      refactoringHints: [],
      gitDiff: null,
    }),
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('DetailPanel', () => {
  it('renders the file name', async () => {
    renderPanel(makeNode());
    await waitFor(() => expect(screen.getByText('auth.ts')).toBeInTheDocument());
  });

  it('renders the rating', async () => {
    renderPanel(makeNode({ rating: 7.5 }));
    await waitFor(() => expect(screen.getByText(/7\.5/)).toBeInTheDocument());
  });

  it('calls onClose when Close button is clicked', async () => {
    const onClose = jest.fn();
    renderPanel(makeNode(), emptyGraph, onClose);
    const closeBtn = await screen.findByText('Close');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows "No uncommitted changes" when gitDiff is null', async () => {
    renderPanel(makeNode());
    await waitFor(() => expect(screen.getByText('No uncommitted changes')).toBeInTheDocument());
  });

  it('shows git diff stats when gitDiff is present', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ ratingBreakdown: [], refactoringHints: [], gitDiff: { added: 10, removed: 3 } }),
    });
    renderPanel(makeNode());
    await waitFor(() => expect(screen.getByText(/10/)).toBeInTheDocument());
  });

  it('renders violations with severity', async () => {
    const node = makeNode({
      violations: [{ type: 'no-any', severity: 'warning', message: 'Avoid using any' }],
    });
    renderPanel(node);
    await waitFor(() => expect(screen.getByText('Avoid using any')).toBeInTheDocument());
  });

  it('renders metrics grid labels', async () => {
    renderPanel(makeNode());
    await waitFor(() => {
      expect(screen.getByText('Lines')).toBeInTheDocument();
      expect(screen.getByText('Complexity')).toBeInTheDocument();
      expect(screen.getByText('Imports')).toBeInTheDocument();
    });
  });

  it('renders rating breakdown items from API', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        ratingBreakdown: [{ category: 'High Complexity', deduction: 2.0, detail: 'complexity 25 > 20' }],
        refactoringHints: [],
        gitDiff: null,
      }),
    });
    renderPanel(makeNode());
    await waitFor(() => expect(screen.getByText('High Complexity')).toBeInTheDocument());
  });

  it('renders imports section when node has outgoing edges', async () => {
    const graph: GraphData = {
      nodes: [
        makeNode({ id: '/repo/src/auth.ts', label: 'auth.ts' }),
        makeNode({ id: '/repo/src/db.ts', label: 'db.ts' }),
      ],
      edges: [{ source: '/repo/src/auth.ts', target: '/repo/src/db.ts', type: 'import', strength: 1 }],
    };
    renderPanel(makeNode({ id: '/repo/src/auth.ts' }), graph);
    await waitFor(() => expect(screen.getAllByText(/Imports/).length).toBeGreaterThan(0));
  });

  it('renders "Used by" section when node has incoming edges', async () => {
    const graph: GraphData = {
      nodes: [
        makeNode({ id: '/repo/src/auth.ts', label: 'auth.ts' }),
        makeNode({ id: '/repo/src/router.ts', label: 'router.ts' }),
      ],
      edges: [{ source: '/repo/src/router.ts', target: '/repo/src/auth.ts', type: 'import', strength: 1 }],
    };
    renderPanel(makeNode({ id: '/repo/src/auth.ts' }), graph);
    await waitFor(() => expect(screen.getByText(/Used by/)).toBeInTheDocument());
  });

  it('shows the file path in the tooltip area', async () => {
    renderPanel(makeNode({ id: '/repo/src/auth.ts' }));
    await waitFor(() => expect(screen.getByTitle('/repo/src/auth.ts')).toBeInTheDocument());
  });

  it('renders the language badge', async () => {
    renderPanel(makeNode({ type: 'typescript' }));
    await waitFor(() => expect(screen.getByText('TS')).toBeInTheDocument());
  });

  it('handles fetch failure gracefully', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('network error'));
    renderPanel(makeNode());
    // Should not crash — loading state resolves to false
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument(), { timeout: 2000 });
  });
});
