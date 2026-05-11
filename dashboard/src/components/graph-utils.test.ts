import {
  healthColor,
  buildTooltip,
  makeNodeColor,
  edgeId,
  buildVisNodes,
  buildVisEdges,
  computeHierarchicalPositions,
} from './graph-utils';
import { healthLabel } from '../ThemeContext';
import type { GraphNode, GraphEdge, GraphData } from '../types';
import { darkTokens } from '../ThemeContext';

describe('graph-utils', () => {
  it('should map health colors for different ratings', () => {
    const healthyColor = healthColor(8.5, darkTokens);
    expect(healthyColor).toBeTruthy();

    const warningColor = healthColor(7.0, darkTokens);
    expect(warningColor).toBeTruthy();

    const degradedColor = healthColor(5.0, darkTokens);
    expect(degradedColor).toBeTruthy();

    const criticalColor = healthColor(2.0, darkTokens);
    expect(criticalColor).toBeTruthy();
  });

  it('should generate health labels for ratings', () => {
    expect(healthLabel(9)).toBe('Healthy');
    expect(healthLabel(7)).toBe('Warning');
    expect(healthLabel(5)).toBe('Degraded');
    expect(healthLabel(2)).toBe('Critical');
  });

  it('should generate tooltips for nodes', () => {
    const node: GraphNode = {
      id: 'file1.ts',
      label: 'file1.ts',
      type: 'typescript',
      rating: 7.5,
      size: 100,
      violations: [{ type: 'any_usage', severity: 'warning', message: 'any type' }],
      metrics: {
        linesOfCode: 150,
        cyclomaticComplexity: 3,
        numberOfMethods: 5,
        numberOfClasses: 1,
        importCount: 4,
      },
    };
    const tooltip = buildTooltip(node);
    expect(tooltip).toContain('file1.ts');
    expect(tooltip).toContain('7.5');
    expect(tooltip).toContain('150');
  });

  it('should create node colors with background and border', () => {
    const color = makeNodeColor('#22c55e', darkTokens);
    expect(color.background).toBeTruthy();
    expect(color.border).toBeTruthy();
    expect(color.highlight).toBeTruthy();
  });

  it('should generate unique edge IDs', () => {
    const id1 = edgeId('file1.ts', 'file2.ts');
    const id2 = edgeId('file2.ts', 'file1.ts');
    expect(id1).not.toBe(id2);
    expect(id1).toContain('→');
  });

  it('should handle rating boundaries', () => {
    expect(healthLabel(8)).toBe('Healthy');
    expect(healthLabel(7.99)).toBe('Warning');
    expect(healthLabel(6)).toBe('Warning');
    expect(healthLabel(5.99)).toBe('Degraded');
    expect(healthLabel(4)).toBe('Degraded');
    expect(healthLabel(3.99)).toBe('Critical');
  });

  it('should handle nodes with zero metrics', () => {
    const node: GraphNode = {
      id: 'test.ts',
      label: 'test.ts',
      type: 'typescript',
      rating: 6.0,
      size: 100,
      violations: [],
      metrics: {
        linesOfCode: 0,
        cyclomaticComplexity: 0,
        numberOfMethods: 0,
        numberOfClasses: 0,
        importCount: 0,
      },
    };
    const tooltip = buildTooltip(node);
    expect(tooltip).toContain('test.ts');
  });

  describe('buildVisNodes', () => {
    const mkNode = (id: string): GraphNode => ({
      id, label: id.split('/').pop() || id,
      type: 'typescript', rating: 7, size: 100, violations: [],
      metrics: { linesOfCode: 100, cyclomaticComplexity: 1, numberOfMethods: 1, numberOfClasses: 0, importCount: 1 },
    });

    it('uses the node label as-is', () => {
      const visNodes = buildVisNodes([mkNode('src/foo.ts')], new Map(), new Map(), darkTokens);
      expect(visNodes[0].label).toBe('foo.ts');
    });

    it('prefers pinned positions over tree positions', () => {
      const pinned = new Map([['a.ts', { x: 999, y: 888 }]]);
      const tree = new Map([['a.ts', { x: 10, y: 20 }]]);
      const [vn] = buildVisNodes([mkNode('a.ts')], pinned, tree, darkTokens);
      expect(vn.x).toBe(999);
      expect(vn.y).toBe(888);
    });

    it('uses tree positions when no pinned position exists', () => {
      const tree = new Map([['a.ts', { x: 42, y: 7 }]]);
      const [vn] = buildVisNodes([mkNode('a.ts')], new Map(), tree, darkTokens);
      expect(vn.x).toBe(42);
      expect(vn.y).toBe(7);
    });

    it('falls back to scatter grid for large unpositioned graphs', () => {
      const many = Array.from({ length: 250 }, (_, i) => mkNode(`f${i}.ts`));
      const visNodes = buildVisNodes(many, new Map(), new Map(), darkTokens);
      expect(visNodes).toHaveLength(250);
      expect(visNodes[0].x).toBe(0);
      expect(visNodes[0].y).toBe(0);
      // second node should be offset on the grid
      expect(visNodes[1].x).not.toBe(0);
    });
  });

  describe('buildVisEdges', () => {
    const mkNode = (id: string): GraphNode => ({
      id, label: id, type: 'typescript', rating: 7, size: 100, violations: [],
      metrics: { linesOfCode: 1, cyclomaticComplexity: 1, numberOfMethods: 0, numberOfClasses: 0, importCount: 0 },
    });

    it('builds normal edges with default styling', () => {
      const data: GraphData = {
        nodes: [mkNode('a.ts'), mkNode('b.ts')],
        edges: [{ source: 'a.ts', target: 'b.ts', type: 'import', strength: 1 }],
      };
      const [edge] = buildVisEdges(data, darkTokens);
      expect(edge.from).toBe('a.ts');
      expect(edge.to).toBe('b.ts');
      expect(edge._isCircular).toBe(false);
      expect(edge.dashes).toBe(false);
    });

    it('marks circular edges with dashes and circular color', () => {
      const data: GraphData = {
        nodes: [mkNode('a.ts'), mkNode('b.ts')],
        edges: [{ source: 'a.ts', target: 'b.ts', type: 'circular', strength: 1 }],
      };
      const [edge] = buildVisEdges(data, darkTokens);
      expect(edge._isCircular).toBe(true);
      expect(edge.dashes).toEqual([6, 4]);
      expect(edge.width).toBe(2.5);
    });

    it('handles GraphNode-object source/target shape', () => {
      const a = mkNode('a.ts');
      const b = mkNode('b.ts');
      const data: GraphData = {
        nodes: [a, b],
        edges: [{ source: a, target: b, type: 'import', strength: 1 }],
      };
      const [edge] = buildVisEdges(data, darkTokens);
      expect(edge.from).toBe('a.ts');
      expect(edge.to).toBe('b.ts');
    });
  });

  describe('computeHierarchicalPositions', () => {
    const mkNode = (id: string): GraphNode => ({
      id, label: id, type: 'typescript', rating: 7, size: 100, violations: [],
      metrics: { linesOfCode: 1, cyclomaticComplexity: 1, numberOfMethods: 0, numberOfClasses: 0, importCount: 0 },
    });

    it('returns empty map for empty input', () => {
      expect(computeHierarchicalPositions([], []).size).toBe(0);
    });

    it('lays out a linear chain across increasing layers', () => {
      const nodes = [mkNode('a'), mkNode('b'), mkNode('c')];
      const edges: GraphEdge[] = [
        { source: 'a', target: 'b', type: 'import', strength: 1 },
        { source: 'b', target: 'c', type: 'import', strength: 1 },
      ];
      const pos = computeHierarchicalPositions(nodes, edges);
      expect(pos.size).toBe(3);
      // Import targets are roots (layer 0); importers cascade rightward.
      // For a→b→c: c is the root, a is deepest.
      expect(pos.get('a')!.x).toBeGreaterThan(pos.get('c')!.x);
      expect(pos.get('b')!.x).toBeGreaterThan(pos.get('c')!.x);
    });

    it('terminates on cyclic graphs without infinite loop', () => {
      const nodes = [mkNode('a'), mkNode('b')];
      const edges: GraphEdge[] = [
        { source: 'a', target: 'b', type: 'import', strength: 1 },
        { source: 'b', target: 'a', type: 'circular', strength: 1 },
      ];
      const pos = computeHierarchicalPositions(nodes, edges);
      expect(pos.size).toBe(2);
    });

    it('sorts and lays out multiple nodes within the same layer', () => {
      // Fan shape: root imports b, c, d — so b/c/d all sit in the same layer.
      // This forces the alphabetical layer-sort and the crossing-reduction medianY pass to run.
      const nodes = [mkNode('root'), mkNode('c'), mkNode('a'), mkNode('b')];
      const edges: GraphEdge[] = [
        { source: 'root', target: 'a', type: 'import', strength: 1 },
        { source: 'root', target: 'b', type: 'import', strength: 1 },
        { source: 'root', target: 'c', type: 'import', strength: 1 },
      ];
      const pos = computeHierarchicalPositions(nodes, edges);
      expect(pos.size).toBe(4);
      // a, b, c share a layer — their x values should match
      expect(pos.get('a')!.x).toBe(pos.get('b')!.x);
      expect(pos.get('b')!.x).toBe(pos.get('c')!.x);
      // and they should be vertically separated
      const ys = ['a', 'b', 'c'].map(id => pos.get(id)!.y);
      expect(new Set(ys).size).toBe(3);
    });

    it('ignores edges to unknown nodes', () => {
      const nodes = [mkNode('a')];
      const edges: GraphEdge[] = [
        { source: 'a', target: 'ghost', type: 'import', strength: 1 },
      ];
      const pos = computeHierarchicalPositions(nodes, edges);
      expect(pos.size).toBe(1);
    });
  });
});
