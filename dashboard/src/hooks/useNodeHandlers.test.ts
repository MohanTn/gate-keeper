import { renderHook, act } from '@testing-library/react';
import { useNodeHandlers } from './useNodeHandlers';
import { GraphData, GraphNode } from '../types';

const makeNode = (id: string, rating = 8): GraphNode => ({
  id,
  label: id.split('/').pop() || id,
  type: 'typescript',
  rating,
  size: 1,
  violations: [],
  metrics: { linesOfCode: 50, cyclomaticComplexity: 1, numberOfMethods: 1, numberOfClasses: 0, importCount: 0 },
});

const nodeA = makeNode('/src/a.ts', 8);
const nodeB = makeNode('/src/b.ts', 7);
const nodeC = makeNode('/src/c.ts', 9);

describe('useNodeHandlers', () => {
  const baseGraph: GraphData = { nodes: [nodeA, nodeB, nodeC], edges: [] };

  it('initial state is null', () => {
    const { result } = renderHook(() => useNodeHandlers(baseGraph));

    expect(result.current.selectedNode).toBeNull();
  });

  it('handleNodeSelect sets selectedNode', () => {
    const { result } = renderHook(() => useNodeHandlers(baseGraph));

    act(() => {
      result.current.handleNodeSelect(nodeA);
    });

    expect(result.current.selectedNode).toEqual(nodeA);
  });

  it('handleClearSelection clears selection', () => {
    const { result } = renderHook(() => useNodeHandlers(baseGraph));

    act(() => {
      result.current.handleNodeSelect(nodeA);
    });

    expect(result.current.selectedNode).toEqual(nodeA);

    act(() => {
      result.current.handleClearSelection();
    });

    expect(result.current.selectedNode).toBeNull();
  });

  it('auto-updates selectedNode when graphData nodes change (reference update)', () => {
    const { result, rerender } = renderHook(
      (graphData: GraphData) => useNodeHandlers(graphData),
      { initialProps: baseGraph },
    );

    act(() => {
      result.current.handleNodeSelect(nodeA);
    });

    expect(result.current.selectedNode?.rating).toBe(8);

    // Create a new nodeA with updated rating
    const updatedNodeA = makeNode('/src/a.ts', 6);
    const updatedGraph: GraphData = {
      nodes: [updatedNodeA, nodeB, nodeC],
      edges: [],
    };

    rerender(updatedGraph);

    expect(result.current.selectedNode).not.toBeNull();
    expect(result.current.selectedNode?.id).toBe('/src/a.ts');
    expect(result.current.selectedNode?.rating).toBe(6);
  });

  it('auto-clears if selectedNode is no longer in graphData', () => {
    const { result, rerender } = renderHook(
      (graphData: GraphData) => useNodeHandlers(graphData),
      { initialProps: baseGraph },
    );

    act(() => {
      result.current.handleNodeSelect(nodeA);
    });

    expect(result.current.selectedNode).toEqual(nodeA);

    // Remove nodeA from graph
    const reducedGraph: GraphData = {
      nodes: [nodeB, nodeC],
      edges: [],
    };

    rerender(reducedGraph);

    expect(result.current.selectedNode).toBeNull();
  });

  it('multiple selections update sequentially', () => {
    const { result } = renderHook(() => useNodeHandlers(baseGraph));

    act(() => {
      result.current.handleNodeSelect(nodeA);
    });
    expect(result.current.selectedNode?.id).toBe('/src/a.ts');

    act(() => {
      result.current.handleNodeSelect(nodeB);
    });
    expect(result.current.selectedNode?.id).toBe('/src/b.ts');

    act(() => {
      result.current.handleNodeSelect(nodeC);
    });
    expect(result.current.selectedNode?.id).toBe('/src/c.ts');
  });

  it('does not auto-update when no node is selected', () => {
    const { result, rerender } = renderHook(
      (graphData: GraphData) => useNodeHandlers(graphData),
      { initialProps: baseGraph },
    );

    expect(result.current.selectedNode).toBeNull();

    const newGraph: GraphData = { nodes: [], edges: [] };
    rerender(newGraph);

    // Should still be null (no crash)
    expect(result.current.selectedNode).toBeNull();
  });

  it('auto-update does not set state when same reference node exists', () => {
    const { result, rerender } = renderHook(
      (graphData: GraphData) => useNodeHandlers(graphData),
      { initialProps: baseGraph },
    );

    act(() => {
      result.current.handleNodeSelect(nodeA);
    });

    // Rerender with same graph (same node references)
    rerender(baseGraph);

    // selectedNode should still be nodeA
    expect(result.current.selectedNode).toBe(nodeA);
  });
});
