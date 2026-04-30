import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, { ForceGraphMethods, NodeObject, LinkObject } from 'react-force-graph-2d';
import { GraphData, GraphNode, NodePosition } from '../types';

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

function ratingColor(rating: number): string {
  if (rating >= 8) return '#22c55e';
  if (rating >= 6) return '#eab308';
  if (rating >= 4) return '#f97316';
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

function useNodePositions(selectedRepo: string | null, nodeCount: number) {
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const hasAutoFitted = useRef(false);

  useEffect(() => {
    hasAutoFitted.current = false;
  }, [nodeCount, selectedRepo]);

  useEffect(() => {
    if (!selectedRepo) {
      setPositions(new Map());
      hasAutoFitted.current = false;
      return;
    }
    fetch(`/api/positions?repo=${encodeURIComponent(selectedRepo)}`)
      .then(r => r.json())
      .then((data: NodePosition[]) => {
        setPositions(new Map(data.map(p => [p.nodeId, { x: p.x, y: p.y }])));
      })
      .catch(() => setPositions(new Map()));
    hasAutoFitted.current = false;
  }, [selectedRepo]);

  return { positions, setPositions, hasAutoFitted };
}

function useGraphForces(
  fgRef: React.MutableRefObject<FGRef | undefined>,
  nodeCount: number,
  hasAutoFitted: React.MutableRefObject<boolean>
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
    // Pin every node so force simulation can't pull them when a single node is dragged
    const nodes = (fg as unknown as FGWithData).graphData().nodes;
    for (const n of nodes) {
      if (n.fx == null) {
        n.fx = n.x;
        n.fy = n.y;
      }
    }
  }, [fgRef, nodeCount, hasAutoFitted]);

  return { handleEngineStop };
}

function useNodePainter(highlightNodeId: string | undefined, selectedNodes: Set<string>) {
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
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      ctx.beginPath();
      ctx.fillStyle = isHighlighted ? '#fff' : color;
      ctx.strokeStyle = isHighlighted ? '#fff' : `${color}55`;
      ctx.lineWidth = isHighlighted ? 2.5 : 1;

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
      ctx.fillStyle = isHighlighted ? '#fff' : '#cbd5e1';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(node.label, node.x!, node.y! + size + 3);
    },
    [highlightNodeId, selectedNodes]
  );

  const paintPointerArea = useCallback(
    (node: GraphNode, color: string, ctx: CanvasRenderingContext2D) => {
      const size = Math.max(5, (node.size ?? 1) * 6) + 6;
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
  setPositions: React.Dispatch<React.SetStateAction<Map<string, { x: number; y: number }>>>
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
    const graphNodes = (fgRef.current as FGWithData | undefined)?.graphData().nodes ?? [];

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
    node.fx = node.x;
    node.fy = node.y;

    const movedPositions = new Map<string, { x: number; y: number }>();
    movedPositions.set(nodeId, { x: node.x ?? 0, y: node.y ?? 0 });

    if (selectedNodes.has(nodeId) && selectedNodes.size > 1) {
      const graphNodes = (fgRef.current as FGWithData | undefined)?.graphData().nodes ?? [];
      for (const id of selectedNodes) {
        if (id === nodeId) continue;
        const n = graphNodes.find(n => n.id === id);
        if (n) {
          n.fx = n.x;
          n.fy = n.y;
          movedPositions.set(id, { x: n.x ?? 0, y: n.y ?? 0 });
        }
      }
    }

    setPositions(prev => {
      const next = new Map(prev);
      for (const [id, pos] of movedPositions) next.set(id, pos);
      return next;
    });

    if (selectedRepo) {
      for (const [id, pos] of movedPositions) {
        fetch('/api/positions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repo: selectedRepo, nodeId: id, x: pos.x, y: pos.y })
        }).catch(() => {});
      }
    }
  }, [selectedNodes, selectedRepo, fgRef, setPositions]);

  const handleClearSelection = useCallback(() => setSelectedNodes(new Set()), []);

  return { selectedNodes, handleNodeClick, handleNodeDrag, handleNodeDragEnd, handleClearSelection };
}

export function GraphView({ graphData, onNodeClick, highlightNodeId, selectedRepo }: GraphViewProps) {
  const fgRef = useRef<FGRef | undefined>(undefined);
  const { positions, setPositions, hasAutoFitted } = useNodePositions(selectedRepo, graphData.nodes.length);
  const { handleEngineStop } = useGraphForces(fgRef, graphData.nodes.length, hasAutoFitted);
  const { selectedNodes, handleNodeClick, handleNodeDrag, handleNodeDragEnd, handleClearSelection } =
    useNodeInteraction(onNodeClick, selectedRepo, fgRef, setPositions);
  const { paintNode, paintPointerArea } = useNodePainter(highlightNodeId, selectedNodes);

  const forceData = useMemo(() => ({
    nodes: graphData.nodes.map(n => {
      const pos = positions.get(n.id);
      return pos ? { ...n, fx: pos.x, fy: pos.y } : { ...n };
    }),
    links: graphData.edges.map(e => ({
      source: typeof e.source === 'string' ? e.source : (e.source as GraphNode).id,
      target: typeof e.target === 'string' ? e.target : (e.target as GraphNode).id,
      strength: e.strength,
      type: e.type
    }))
  }), [graphData, positions]);

  const multiSelectCount = selectedNodes.size;

  return (
    <div style={{ flex: 1, position: 'relative', background: '#0a0f1e', overflow: 'hidden' }}>

      {graphData.nodes.length === 0 && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 12, color: '#1e293b', pointerEvents: 'none'
        }}>
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
            <path d="M32 4L58 18V46L32 60L6 46V18L32 4Z" stroke="#1e293b" strokeWidth="2" fill="none" />
            <path d="M32 20L44 27V41L32 48L20 41V27L32 20Z" stroke="#263347" strokeWidth="1.5" fill="none" />
          </svg>
          <div style={{ fontSize: 16, color: '#334155', fontWeight: 600 }}>No files analyzed</div>
          <div style={{ fontSize: 13, color: '#1e293b' }}>Click "Scan All Files" to analyze your workspace</div>
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
          link.type === 'import' ? 'rgba(59,130,246,0.25)' : 'rgba(249,115,22,0.25)'
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
        backgroundColor="#0a0f1e"
        d3AlphaDecay={0.015}
        d3VelocityDecay={0.25}
      />

      {/* Legend */}
      <div style={{
        position: 'absolute', bottom: 16, left: 16,
        background: 'rgba(17,24,39,0.9)', border: '1px solid #1e293b',
        borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#64748b',
        backdropFilter: 'blur(4px)'
      }}>
        <div style={{ fontWeight: 600, marginBottom: 8, color: '#94a3b8', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8 }}>Legend</div>
        <div style={{ marginBottom: 3 }}>● TypeScript / JS</div>
        <div style={{ marginBottom: 3 }}>■ C#</div>
        <div style={{ marginBottom: 8 }}>▲ React (TSX / JSX)</div>
        <div style={{ display: 'flex', gap: 10, borderTop: '1px solid #1e293b', paddingTop: 8 }}>
          <span style={{ color: '#22c55e' }}>■</span><span>≥ 8</span>
          <span style={{ color: '#eab308' }}>■</span><span>≥ 6</span>
          <span style={{ color: '#f97316' }}>■</span><span>≥ 4</span>
          <span style={{ color: '#ef4444' }}>■</span><span>&lt; 4</span>
        </div>
      </div>

      {/* Interaction hints */}
      <div style={{
        position: 'absolute', bottom: 16, right: 16,
        fontSize: 11, color: '#1e293b', pointerEvents: 'none',
        textAlign: 'right', lineHeight: 1.8
      }}>
        <div>click node to open details</div>
        <div>shift+click to multi-select · drag to move group</div>
        <div>positions saved automatically</div>
      </div>

      {multiSelectCount > 1 && (
        <div style={{
          position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(59,130,246,0.15)', border: '1px solid #3b82f6',
          borderRadius: 20, padding: '5px 14px',
          fontSize: 12, color: '#93c5fd',
          backdropFilter: 'blur(4px)',
          pointerEvents: 'none'
        }}>
          {multiSelectCount} nodes selected — drag any to move group
        </div>
      )}
    </div>
  );
}
