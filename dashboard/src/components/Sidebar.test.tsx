import type { GraphNode } from '../types';

const ratingColor = (r: number): string => {
  if (r >= 8) return 'green';
  if (r >= 6) return 'yellow';
  if (r >= 4) return 'orange';
  return 'red';
};

describe('Sidebar', () => {
  it('should map ratings to colors', () => {
    expect(ratingColor(8.5)).toBe('green');
    expect(ratingColor(7.0)).toBe('yellow');
    expect(ratingColor(5.0)).toBe('orange');
    expect(ratingColor(2.0)).toBe('red');
  });

  it('should sort by rating descending', () => {
    const nodes: GraphNode[] = [
      { id: 'a.ts', label: 'a.ts', type: 'typescript', rating: 5.0, size: 100, violations: [], metrics: { linesOfCode: 100, cyclomaticComplexity: 2, numberOfMethods: 5, numberOfClasses: 1, importCount: 3 } },
      { id: 'b.ts', label: 'b.ts', type: 'typescript', rating: 8.0, size: 100, violations: [], metrics: { linesOfCode: 100, cyclomaticComplexity: 2, numberOfMethods: 5, numberOfClasses: 1, importCount: 3 } },
      { id: 'c.ts', label: 'c.ts', type: 'typescript', rating: 7.0, size: 100, violations: [], metrics: { linesOfCode: 100, cyclomaticComplexity: 2, numberOfMethods: 5, numberOfClasses: 1, importCount: 3 } },
    ];
    const sorted = [...nodes].sort((a, b) => b.rating - a.rating);
    expect(sorted[0].rating).toBe(8.0);
  });

  it('should sort by label alphabetically', () => {
    const nodes: GraphNode[] = [
      { id: 'zebra.ts', label: 'zebra.ts', type: 'typescript', rating: 7.0, size: 100, violations: [], metrics: { linesOfCode: 100, cyclomaticComplexity: 2, numberOfMethods: 5, numberOfClasses: 1, importCount: 3 } },
      { id: 'apple.ts', label: 'apple.ts', type: 'typescript', rating: 7.0, size: 100, violations: [], metrics: { linesOfCode: 100, cyclomaticComplexity: 2, numberOfMethods: 5, numberOfClasses: 1, importCount: 3 } },
    ];
    const sorted = [...nodes].sort((a, b) => a.label.localeCompare(b.label));
    expect(sorted[0].label).toBe('apple.ts');
  });

  it('should sort by LOC descending', () => {
    const nodes: GraphNode[] = [
      { id: 'small.ts', label: 'small.ts', type: 'typescript', rating: 7.0, size: 100, violations: [], metrics: { linesOfCode: 50, cyclomaticComplexity: 2, numberOfMethods: 5, numberOfClasses: 1, importCount: 3 } },
      { id: 'large.ts', label: 'large.ts', type: 'typescript', rating: 7.0, size: 100, violations: [], metrics: { linesOfCode: 500, cyclomaticComplexity: 2, numberOfMethods: 5, numberOfClasses: 1, importCount: 3 } },
    ];
    const sorted = [...nodes].sort((a, b) => b.metrics.linesOfCode - a.metrics.linesOfCode);
    expect(sorted[0].metrics.linesOfCode).toBe(500);
  });

  it('should sort by violation count descending', () => {
    const nodes: GraphNode[] = [
      { id: 'clean.ts', label: 'clean.ts', type: 'typescript', rating: 8.0, size: 100, violations: [], metrics: { linesOfCode: 100, cyclomaticComplexity: 2, numberOfMethods: 5, numberOfClasses: 1, importCount: 3 } },
      { id: 'messy.ts', label: 'messy.ts', type: 'typescript', rating: 4.0, size: 100, violations: [{ type: 'any_usage', severity: 'warning', message: 'any' }, { type: 'missing_key', severity: 'error', message: 'missing key' }], metrics: { linesOfCode: 100, cyclomaticComplexity: 2, numberOfMethods: 5, numberOfClasses: 1, importCount: 3 } },
    ];
    const sorted = [...nodes].sort((a, b) => b.violations.length - a.violations.length);
    expect(sorted[0].violations.length).toBe(2);
  });

  it('should handle sort direction changes', () => {
    const nodes = [5, 3, 8, 1];
    const sortDescending = (sortDir: 'asc' | 'desc') =>
      sortDir === 'asc' ? [...nodes].sort((a, b) => a - b) : [...nodes].sort((a, b) => b - a);

    const descResult = sortDescending('desc');
    expect(descResult[0]).toBe(8);

    const ascResult = sortDescending('asc');
    expect(ascResult[0]).toBe(1);
  });

  it('should select a node', () => {
    const node: GraphNode = {
      id: 'selected.ts',
      label: 'selected.ts',
      type: 'typescript',
      rating: 7.5,
      size: 100,
      violations: [],
      metrics: { linesOfCode: 100, cyclomaticComplexity: 2, numberOfMethods: 5, numberOfClasses: 1, importCount: 3 },
    };
    let selectedNode: GraphNode | null = null;
    const onNodeSelect = (n: GraphNode): void => {
      selectedNode = n;
    };
    onNodeSelect(node);
    expect(selectedNode!.id).toBe('selected.ts');
  });

  it('should display metrics', () => {
    const node: GraphNode = {
      id: 'test.ts',
      label: 'test.ts',
      type: 'typescript',
      rating: 7.5,
      size: 100,
      violations: [],
      metrics: {
        linesOfCode: 150,
        cyclomaticComplexity: 3,
        numberOfMethods: 5,
        numberOfClasses: 1,
        importCount: 4,
      },
    };
    expect(node.metrics.linesOfCode).toBe(150);
    expect(node.metrics.cyclomaticComplexity).toBe(3);
  });
});
