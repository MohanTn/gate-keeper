import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, { ForceGraphMethods, NodeObject, LinkObject } from 'react-force-graph-2d';
import { GraphData, GraphNode, NodePosition } from '../types';
import { useTheme } from '../ThemeContext';

interface GraphViewProps {
  graphData: GraphData;
  onNodeClick: (node: GraphNode) => void;
  highlightNodeId?: string;
  selectedRepo: string | null;
}

type SimNode = NodeObject<GraphNode>;
type SimLink = LinkObject<GraphNode, { strength?: number; type?: string }>;
type FGRef = ForceGraphMethods<SimNode, SimLink>;
type FGWithData = { graphData(): { nodes: SimNode[] } };

function langShape(type: string): string {
  switch (type) {
    case 'csharp': return 'square';
    case 'tsx':
    case 'jsx': return 'triangle';
    default: return 'circle';
  }
}

function useShiftKey(): React.MutableRefObject<boolean> {
  const shiftRef = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { shiftRef.current = e.shiftKey; };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, []);
  return shiftRef;
}

/**
 * Manages pinned node positions using a stable ref so that drag-end writes
 * never trigger a React re-render (and therefore never restart the simulation).
 * `initVersion` is the only signal that rebuilds forceData — it increments once
 * when the server-side positions load completes.
 */
function useNodePositions(selectedRepo: string | null, nodeCount: number) {
  const pinnedRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const [initVersion, setInitVersion] = useState(0);
  const hasAutoFitted = useRef(false);

  useEffect(() => {
    hasAutoFitted.current = false;
  }, [nodeCount, selectedRepo]);

  useEffect(() => {
    pinnedRef.current = new Map();
    hasAutoFitted.current = false;
    if (!selectedRepo) {
      setInitVersion(v => v + 1);
      return;
    }
    fetch(`/api/positions?repo=${encodeURIComponent(selectedRepo)}`)
      .then(r => r.json())
      .then((data: NodePosition[]) => {
        pinnedRef.current = new Map(data.map(p => [p.nodeId, { x: p.x, y: p.y }]));
        setInitVersion(v => v + 1);
      })
      .catch(() => setInitVersion(v => v + 1));
  }, [selectedRepo]);

  return { pinnedRef, initVersion, hasAutoFitted };
}

function useGraphForces(
  fgRef: React.MutableRefObject<FGRef | undefined>,
  nodeCount: number,
  hasAutoFitted: React.MutableRefObject<boolean>,
  pinnedRef: React.MutableRefObject<Map<string, { x: number; y: number }>>
) {
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force('charge')?.strength(-120);
    fg.d3Force('link')?.distance(80);
    fg.d3Force('center')?.strength(0.15);
    fg.d3ReheatSimulation();
  }, [fgRef, nodeCount]);

  const handleEngineStop = useCallback(() => {
    const fg = fgRef.current;
    if (!fg) return;
    if (!hasAutoFitted.current && nodeCount > 0) {
      fg.zoomToFit(400, 60);
      hasAutoFitted.current = true;
    }
    // Pin all free nodes and record their positions so forceData can restore them
    // correctly when a new node is added and forceData rebuilds.
    const nodes = (fg as unknown as FGWithData).graphData().nodes;
    for (const n of nodes) {
      if (n.fx == null) {
        n.fx = n.x;
        n.fy = n.y;
      }
      if (n.x != null && n.y != null) {
        pinnedRef.current.set(n.id as string, { x: n.x, y: n.y });
      }
    }
  }, [fgRef, nodeCount, hasAutoFitted, pinnedRef]);

  return { handleEngineStop };
}

function useNodePainter(highlightNodeId: string | undefined, selectedNodes: Set<string>, theme: any) {
  const ratingColor = (r: number) => {
    if (r >= 8) return theme.green;
    if (r >= 6) return theme.yellow;
    if (r >= 4) return theme.orange;
    return theme.red;
  };

  const paintNode = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const size = Math.max(5, (node.size ?? 1) * 6);
      const color = ratingColor(node.rating);
      const isHighlighted = node.id === highlightNodeId;
      const isSelected = selectedNodes.has(node.id);

      if (isSelected) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(node.x!, node.y!, size + 7, 0, 2 * Math.PI);
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      ctx.beginPath();
      ctx.fillStyle = isHighlighted ? theme.text : theme.cardBg;
      ctx.strokeStyle = isHighlighted ? theme.accent : color;
      ctx.lineWidth = isHighlighted ? 2.5 : 2;

      const shape = langShape(node.type);
      if (shape === 'square') {
        ctx.rect(node.x! - size / 2, node.y! - size / 2, size, size);
      } else if (shape === 'triangle') {
        ctx.moveTo(node.x!, node.y! - size);
        ctx.lineTo(node.x! + size * 0.866, node.y! + size * 0.5);
        ctx.lineTo(node.x! - size * 0.866, node.y! + size * 0.5);
        ctx.closePath();
      } else {
        ctx.arc(node.x!, node.y!, size, 0, 2 * Math.PI);
      }
      ctx.fill();
      ctx.stroke();

      const fontSize = Math.max(10, Math.min(14, 12 / globalScale));
      ctx.font = `${isHighlighted ? 'bold ' : ''}${fontSize}px ui-monospace, "SF Mono", monospace`;
      ctx.fillStyle = isHighlighted ? theme.accent : theme.textMuted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(node.label, node.x!, node.y! + size + 3);
    },
    [highlightNodeId, selectedNodes, theme]
  );

  const paintPointerArea = useCallback(
    (node: GraphNode, color: string, ctx: CanvasRenderingContext2D) => {
      const size = Math.max(5, (node.size ?? 1) * 6) + 8;
      ctx.fillStyle = color;
      ctx.beginPath();
      const shape = langShape(node.type);
      if (shape === 'square') {
        ctx.rect(node.x! - size / 2, node.y! - size / 2, size, size);
      } else if (shape === 'triangle') {
        ctx.moveTo(node.x!, node.y! - size);
        ctx.lineTo(node.x! + size * 0.866, node.y! + size * 0.5);
        ctx.lineTo(node.x! - size * 0.866, node.y! + size * 0.5);
        ctx.closePath();
      } else {
        ctx.arc(node.x!, node.y!, size, 0, 2 * Math.PI);
      }
      ctx.fill();
    },
    []
  );

  return { paintNode, paintPointerArea };
}

function useNodeInteraction(
  onNodeClick: (node: GraphNode) => void,
  selectedRepo: string | null,
  fgRef: React.MutableRefObject<FGRef | undefined>,
  pinnedRef: React.MutableRefObject<Map<string, { x: number; y: number }>>
) {
  const shiftRef = useShiftKey();
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const isDragging = useRef(false);
  const dragStartPositions = useRef<Map<string, { x: number; y: number }>>(new Map());

  const handleNodeClick = useCallback((node: SimNode) => {
    const id = node.id as string;
    if (shiftRef.current) {
      setSelectedNodes(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    } else {
      setSelectedNodes(new Set([id]));
      onNodeClick(node as GraphNode);
    }
  }, [onNodeClick, shiftRef]);

  const handleNodeDrag = useCallback((node: SimNode, translate: { x: number; y: number }) => {
    const nodeId = node.id as string;
    if (!selectedNodes.has(nodeId) || selectedNodes.size <= 1) return;
    const graphNodes = (fgRef.current as unknown as FGWithData | undefined)?.graphData().nodes ?? [];

    if (!isDragging.current) {
      isDragging.current = true;
      const starts = new Map<string, { x: number; y: number }>();
      starts.set(nodeId, { x: (node.x ?? 0) - translate.x, y: (node.y ?? 0) - translate.y });
      for (const id of selectedNodes) {
        if (id === nodeId) continue;
        const n = graphNodes.find(n => n.id === id);
        if (n) starts.set(id, { x: n.x ?? 0, y: n.y ?? 0 });
      }
      dragStartPositions.current = starts;
    }

    for (const [id, startPos] of dragStartPositions.current) {
      if (id === nodeId) continue;
      const n = graphNodes.find(n => n.id === id);
      if (n) {
        n.fx = startPos.x + translate.x;
        n.fy = startPos.y + translate.y;
        n.x = startPos.x + translate.x;
        n.y = startPos.y + translate.y;
      }
    }
  }, [selectedNodes, fgRef]);

  const handleNodeDragEnd = useCallback((node: SimNode) => {
    isDragging.current = false;
    const nodeId = node.id as string;
    // Re-pin the dragged node at its dropped position.
    node.fx = node.x;
    node.fy = node.y;
    pinnedRef.current.set(nodeId, { x: node.x ?? 0, y: node.y ?? 0 });

    const movedPositions = new Map<string, { x: number; y: number }>();
    movedPositions.set(nodeId, { x: node.x ?? 0, y: node.y ?? 0 });

    if (selectedNodes.has(nodeId) && selectedNodes.size > 1) {
      const graphNodes = (fgRef.current as unknown as FGWithData | undefined)?.graphData().nodes ?? [];
      for (const id of selectedNodes) {
        if (id === nodeId) continue;
        const n = graphNodes.find(n => n.id === id);
        if (n) {
          n.fx = n.x;
          n.fy = n.y;
          pinnedRef.current.set(id, { x: n.x ?? 0, y: n.y ?? 0 });
          movedPositions.set(id, { x: n.x ?? 0, y: n.y ?? 0 });
        }
      }
    }

    // Persist to server without touching React state (no forceData recompute).
    if (selectedRepo) {
      for (const [id, pos] of movedPositions) {
        fetch('/api/positions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repo: selectedRepo, nodeId: id, x: pos.x, y: pos.y })
        }).catch(() => {});
      }
    }
  }, [selectedNodes, selectedRepo, fgRef, pinnedRef]);

  const handleClearSelection = useCallback(() => setSelectedNodes(new Set()), []);

  return { selectedNodes, handleNodeClick, handleNodeDrag, handleNodeDragEnd, handleClearSelection };
}

export function GraphView({ graphData, onNodeClick, highlightNodeId, selectedRepo }: GraphViewProps) {
  const { T } = useTheme();
  const fgRef = useRef<FGRef | undefined>(undefined);
  const { pinnedRef, initVersion, hasAutoFitted } = useNodePositions(selectedRepo, graphData.nodes.length);
  const { handleEngineStop } = useGraphForces(fgRef, graphData.nodes.length, hasAutoFitted, pinnedRef);
  const { selectedNodes, handleNodeClick, handleNodeDrag, handleNodeDragEnd, handleClearSelection } =
    useNodeInteraction(onNodeClick, selectedRepo, fgRef, pinnedRef);
  const { paintNode, paintPointerArea } = useNodePainter(highlightNodeId, selectedNodes, T);

  // Rebuild forceData only when graphData changes or initial positions finish loading.
  // Drag-end writes go to pinnedRef directly — no state update, no simulation restart.
  const forceData = useMemo(() => {
    const pinned = pinnedRef.current;

    // Compute centroid of pinned nodes so newly added nodes start near the cluster
    // rather than at the origin where repulsion forces scatter them off-screen.
    let cx = 0, cy = 0, count = 0;
    for (const pos of pinned.values()) { cx += pos.x; cy += pos.y; count++; }
    if (count > 0) { cx /= count; cy /= count; }

    return {
      nodes: graphData.nodes.map(n => {
        const pos = pinned.get(n.id);
        if (pos) return { ...n, fx: pos.x, fy: pos.y };
        // New node: seed position near centroid so simulation keeps it in frame.
        if (count > 0) return { ...n, x: cx + (Math.random() - 0.5) * 60, y: cy + (Math.random() - 0.5) * 60 };
        return { ...n };
      }),
      links: graphData.edges.map(e => ({
        source: typeof e.source === 'string' ? e.source : (e.source as GraphNode).id,
        target: typeof e.target === 'string' ? e.target : (e.target as GraphNode).id,
        strength: e.strength,
        type: e.type
      }))
    };
  // initVersion is the only positions-related trigger; pinnedRef.current is read intentionally.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphData, initVersion]);

  const multiSelectCount = selectedNodes.size;

  return (
    <div style={{ flex: 1, position: 'relative', background: T.bg, overflow: 'hidden' }}>

      {graphData.nodes.length === 0 && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 12, color: T.textFaint, pointerEvents: 'none'
        }}>
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
            <path d="M32 4L58 18V46L32 60L6 46V18L32 4Z" stroke={T.border} strokeWidth="2" fill="none" />
            <path d="M32 20L44 27V41L32 48L20 41V27L32 20Z" stroke={T.textDim} strokeWidth="1.5" fill="none" />
          </svg>
          <div style={{ fontSize: 16, color: T.textMuted, fontWeight: 600 }}>No files analyzed</div>
          <div style={{ fontSize: 13, color: T.textFaint }}>Click "Scan All Files" to analyze your workspace</div>
        </div>
      )}

      <ForceGraph2D
        ref={fgRef as React.MutableRefObject<FGRef | undefined>}
        graphData={forceData}
        nodeId="id"
        nodeLabel={(n: SimNode) =>
          `${n.label}\nRating: ${n.rating}/10\nLOC: ${n.metrics?.linesOfCode ?? 0}\nViolations: ${(n.violations ?? []).length}`
        }
        nodeCanvasObject={(n, ctx, scale) => paintNode(n as GraphNode, ctx, scale)}
        nodeCanvasObjectMode={() => 'replace'}
        nodePointerAreaPaint={(n, color, ctx) => paintPointerArea(n as GraphNode, color, ctx)}
        linkColor={(link: SimLink) =>
          link.type === 'import' ? T.edgeDefault : T.edgeCircular
        }
        linkWidth={(link: SimLink) => Math.max(0.5, (link.strength ?? 1) * 1.2)}
        linkDirectionalArrowLength={5}
        linkDirectionalArrowRelPos={1}
        onNodeClick={handleNodeClick}
        onNodeDrag={handleNodeDrag}
        onNodeDragEnd={handleNodeDragEnd}
        onBackgroundClick={handleClearSelection}
        onEngineStop={handleEngineStop}
        cooldownTicks={120}
        warmupTicks={40}
        backgroundColor={T.bg}
        d3AlphaDecay={0.015}
        d3VelocityDecay={0.25}
      />

      {/* Legend */}
      <div style={{
        position: 'absolute', bottom: 16, left: 16,
        background: T.panel, border: `1px solid ${T.border}`,
        borderRadius: 8, padding: '10px 14px', fontSize: 12, color: T.textMuted,
        boxShadow: T.shadow
      }}>
        <div style={{ fontWeight: 600, marginBottom: 8, color: T.text, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8 }}>Legend</div>
        <div style={{ marginBottom: 3, color: T.text }}>● TypeScript / JS</div>
        <div style={{ marginBottom: 3, color: T.text }}>■ C#</div>
        <div style={{ marginBottom: 8, color: T.text }}>▲ React (TSX / JSX)</div>
        <div style={{ display: 'flex', gap: 10, borderTop: `1px solid ${T.border}`, paddingTop: 8 }}>
          <span style={{ color: T.green }}>■</span><span>≥ 8</span>
          <span style={{ color: T.yellow }}>■</span><span>≥ 6</span>
          <span style={{ color: T.orange }}>■</span><span>≥ 4</span>
          <span style={{ color: T.red }}>■</span><span>&lt; 4</span>
        </div>
      </div>

      {/* Interaction hints */}
      <div style={{
        position: 'absolute', bottom: 16, right: 16,
        fontSize: 11, color: T.textFaint, pointerEvents: 'none',
        textAlign: 'right', lineHeight: 1.8
      }}>
        <div>click node to open details</div>
        <div>shift+click to multi-select · drag to move group</div>
        <div>positions saved automatically</div>
      </div>

      {multiSelectCount > 1 && (
        <div style={{
          position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
          background: `${T.accent}26`, border: `1px solid ${T.accent}`,
          borderRadius: 20, padding: '5px 14px',
          fontSize: 12, color: T.accent,
          boxShadow: T.shadow,
          pointerEvents: 'none'
        }}>
          {multiSelectCount} nodes selected — drag any to move group
        </div>
      )}
    </div>
  );
}
