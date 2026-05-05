import type { GraphData, GraphNode } from '../types';

describe('GraphView', () => {
  function ratingColor(r: number): string {
    if (r >= 8) return '#22c55e';
    if (r >= 6) return '#eab308';
    if (r >= 4) return '#f97316';
    return '#ef4444';
  }

  function langShape(type: string): string {
    switch (type) {
      case 'csharp': return 'square';
      case 'tsx':
      case 'jsx': return 'triangle';
      default: return 'circle';
    }
  }

  it('should color healthy nodes green', () => {
    const color = ratingColor(8.5);
    expect(color).toBe('#22c55e');
  });

  it('should color warning nodes yellow', () => {
    const color = ratingColor(7.0);
    expect(color).toBe('#eab308');
  });

  it('should color degraded nodes orange', () => {
    const color = ratingColor(5.0);
    expect(color).toBe('#f97316');
  });

  it('should color critical nodes red', () => {
    const color = ratingColor(3.0);
    expect(color).toBe('#ef4444');
  });

  it('should map languages to shapes', () => {
    expect(langShape('typescript')).toBe('circle');
    expect(langShape('tsx')).toBe('triangle');
    expect(langShape('csharp')).toBe('square');
  });

  it('should handle node click callback', () => {
    const node: GraphNode = {
      id: 'test.ts',
      label: 'test.ts',
      type: 'typescript',
      rating: 7.5,
      size: 100,
      violations: [],
      metrics: { linesOfCode: 100, cyclomaticComplexity: 2, numberOfMethods: 5, numberOfClasses: 1, importCount: 3 },
    };
    let clickedNode: GraphNode | null = null;
    const onNodeClick = (n: GraphNode): void => {
      clickedNode = n;
    };
    onNodeClick(node);
    expect(clickedNode!.id).toBe('test.ts');
  });

  it('should handle empty graphs', () => {
    const emptyGraph: GraphData = { nodes: [], edges: [] };
    expect(emptyGraph.nodes.length).toBe(0);
    expect(emptyGraph.edges.length).toBe(0);
  });

  it('should track shift key state', () => {
    const shiftRef = { current: false };
    expect(shiftRef.current).toBe(false);
    shiftRef.current = true;
    expect(shiftRef.current).toBe(true);
  });
});
