import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { GraphErrorBoundary } from './ErrorBoundary';
import { darkTokens } from '../ThemeContext';
import type { GraphNode } from '../types';
import '@testing-library/jest-dom';

function createSampleNode(id: string, rating: number, violations: { severity: string }[] = []): GraphNode {
  return {
    id,
    label: id,
    type: 'typescript',
    rating,
    size: 100,
    violations: violations.map(v => ({ type: 'test', message: 'Test violation', ...v })),
    metrics: {
      linesOfCode: 50,
      cyclomaticComplexity: 2,
      numberOfMethods: 3,
      numberOfClasses: 1,
      importCount: 3,
    },
  } as GraphNode;
}

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('Render failed');
  return <div>Working</div>;
}

describe('GraphErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    render(
      <GraphErrorBoundary T={darkTokens}>
        <div>Content</div>
      </GraphErrorBoundary>
    );
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  describe('error state', () => {
    let consoleSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it('catches render errors and shows FallbackTable', () => {
      render(
        <GraphErrorBoundary T={darkTokens}>
          <Bomb shouldThrow={true} />
        </GraphErrorBoundary>
      );
      expect(screen.getByText('Graph render error — showing table view')).toBeInTheDocument();
    });

    it('displays the error message in the banner', () => {
      render(
        <GraphErrorBoundary T={darkTokens}>
          <Bomb shouldThrow={true} />
        </GraphErrorBoundary>
      );
      expect(screen.getByText('Render failed')).toBeInTheDocument();
    });

    it('retry button recovers from error when children no longer throw', () => {
      const { rerender } = render(
        <GraphErrorBoundary T={darkTokens}>
          <Bomb shouldThrow={true} />
        </GraphErrorBoundary>
      );
      expect(screen.getByText('Graph render error — showing table view')).toBeInTheDocument();

      // Replace the throwing children with safe ones, then retry
      rerender(
        <GraphErrorBoundary T={darkTokens}>
          <Bomb shouldThrow={false} />
        </GraphErrorBoundary>
      );

      fireEvent.click(screen.getByText('Retry Graph'));
      expect(screen.getByText('Working')).toBeInTheDocument();
    });

    it('shows fallback data in the table view', () => {
      const nodes = [createSampleNode('test.ts', 7.5, [{ severity: 'warning' }])];
      const fallbackData = { nodes, edges: [] };

      render(
        <GraphErrorBoundary T={darkTokens} fallbackData={fallbackData}>
          <Bomb shouldThrow={true} />
        </GraphErrorBoundary>
      );
      expect(screen.getAllByText('7.5').length).toBeGreaterThan(0);
    });

    it('shows empty state when no fallback data provided', () => {
      render(
        <GraphErrorBoundary T={darkTokens}>
          <Bomb shouldThrow={true} />
        </GraphErrorBoundary>
      );
      expect(screen.getByText('No files analyzed yet.')).toBeInTheDocument();
    });

    it('calls onNodeSelect when a table row is clicked', () => {
      const onNodeSelect = jest.fn();
      const nodes = [createSampleNode('test.ts', 8.0)];
      const fallbackData = { nodes, edges: [] };

      render(
        <GraphErrorBoundary T={darkTokens} fallbackData={fallbackData} onNodeSelect={onNodeSelect}>
          <Bomb shouldThrow={true} />
        </GraphErrorBoundary>
      );

      fireEvent.click(screen.getAllByText('test.ts')[0]);
      expect(onNodeSelect).toHaveBeenCalledTimes(1);
      expect(onNodeSelect).toHaveBeenCalledWith(nodes[0]);
    });

    it('displays error count in summary stats', () => {
      const nodes = [
        createSampleNode('good.ts', 9.0),
        createSampleNode('bad.ts', 3.0, [
          { severity: 'error' },
          { severity: 'warning' },
        ]),
      ];
      const fallbackData = { nodes, edges: [] };

      const { container } = render(
        <GraphErrorBoundary T={darkTokens} fallbackData={fallbackData}>
          <Bomb shouldThrow={true} />
        </GraphErrorBoundary>
      );

      // StatBox for "Errors" — the value div follows the label div
      const labels = container.querySelectorAll('[style*="text-transform: uppercase"]');
      const errorsLabel = Array.from(labels).find(el => el.textContent === 'Errors');
      expect(errorsLabel?.nextElementSibling?.textContent).toBe('1');
    });

    it('sorts files by rating ascending', () => {
      const nodes = [
        createSampleNode('better.ts', 9.0),
        createSampleNode('worse.ts', 2.0),
      ];
      const fallbackData = { nodes, edges: [] };

      render(
        <GraphErrorBoundary T={darkTokens} fallbackData={fallbackData}>
          <Bomb shouldThrow={true} />
        </GraphErrorBoundary>
      );

      // Each row has label + id with same text, so labels are at even indices
      const fileCells = screen.getAllByText(/\.ts/);
      expect(fileCells[0]).toHaveTextContent('worse.ts');
      expect(fileCells[2]).toHaveTextContent('better.ts');
    });

    it('shows average rating in stats', () => {
      const nodes = [
        createSampleNode('a.ts', 8.0),
        createSampleNode('b.ts', 4.0),
      ];
      const fallbackData = { nodes, edges: [] };

      render(
        <GraphErrorBoundary T={darkTokens} fallbackData={fallbackData}>
          <Bomb shouldThrow={true} />
        </GraphErrorBoundary>
      );

      expect(screen.getByText('6.0')).toBeInTheDocument();
    });

    it('shows — for avg rating when no files', () => {
      render(
        <GraphErrorBoundary T={darkTokens}>
          <Bomb shouldThrow={true} />
        </GraphErrorBoundary>
      );

      expect(screen.getByText('—')).toBeInTheDocument();
    });
  });
});
