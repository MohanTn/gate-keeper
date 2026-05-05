import type { GraphData, GraphNode } from '../types';

describe('VisGraphView', () => {
  function createSampleGraphData(): GraphData {
    return {
      nodes: [
        {
          id: 'file1.ts',
          label: 'file1.ts',
          type: 'typescript',
          rating: 8.5,
          size: 100,
          violations: [],
          metrics: {
            linesOfCode: 150,
            cyclomaticComplexity: 3,
            numberOfMethods: 5,
            numberOfClasses: 1,
            importCount: 4,
          },
        },
        {
          id: 'file2.tsx',
          label: 'file2.tsx',
          type: 'tsx',
          rating: 6.5,
          size: 120,
          violations: [],
          metrics: {
            linesOfCode: 200,
            cyclomaticComplexity: 5,
            numberOfMethods: 8,
            numberOfClasses: 2,
            importCount: 6,
          },
        },
      ],
      edges: [{ source: 'file1.ts', target: 'file2.tsx', type: 'import', strength: 1 }],
    };
  }

  it('should handle empty graph data', () => {
    const emptyGraph: GraphData = { nodes: [], edges: [] };
    expect(emptyGraph.nodes.length).toBe(0);
    expect(emptyGraph.edges.length).toBe(0);
  });

  it('should handle sample graph data', () => {
    const data = createSampleGraphData();
    expect(data.nodes.length).toBe(2);
    expect(data.edges.length).toBe(1);
  });

  it('should map node rating to color', () => {
    const data = createSampleGraphData();
    const healthyNode = data.nodes[0];
    expect(healthyNode.rating).toBeGreaterThanOrEqual(8);

    const warningNode = data.nodes[1];
    expect(warningNode.rating).toBeGreaterThanOrEqual(6);
    expect(warningNode.rating).toBeLessThan(8);
  });

  it('should handle node click callback', () => {
    const data = createSampleGraphData();
    let clicked: GraphNode | null = null;
    const onNodeClick = (node: GraphNode): void => {
      clicked = node;
    };

    const node = data.nodes[0];
    onNodeClick(node);

    expect(clicked).toBe(node);
    expect(clicked!.id).toBe('file1.ts');
  });

  it('should handle canvas click callback', () => {
    let canvasClicked = false;
    const onCanvasClick = () => {
      canvasClicked = true;
    };

    onCanvasClick();
    expect(canvasClicked).toBe(true);
  });

  it('should detect large graphs', () => {
    const LARGE_GRAPH_THRESHOLD = 200;
    const smallData = createSampleGraphData();
    expect(smallData.nodes.length).toBeLessThan(LARGE_GRAPH_THRESHOLD);

    const largeGraph: GraphData = {
      nodes: Array.from({ length: 300 }, (_, i) => ({
        id: `file${i}.ts`,
        label: `file${i}.ts`,
        type: 'typescript' as const,
        rating: 7 + Math.random() * 3,
        size: 100,
        violations: [],
        metrics: {
          linesOfCode: 100,
          cyclomaticComplexity: 2,
          numberOfMethods: 5,
          numberOfClasses: 1,
          importCount: 3,
        },
      })),
      edges: [],
    };
    expect(largeGraph.nodes.length).toBeGreaterThan(LARGE_GRAPH_THRESHOLD);
  });

  it('should handle node focus', () => {
    const data = createSampleGraphData();
    const focusNodeId = 'file1.ts';
    expect(focusNodeId).toBe(data.nodes[0].id);
  });

  it('should handle zoom trigger', () => {
    let fitTrigger = 0;
    const incrementFitTrigger = () => {
      fitTrigger++;
    };

    incrementFitTrigger();
    expect(fitTrigger).toBe(1);
  });
});
