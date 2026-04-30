import React, { useCallback, useEffect, useRef } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { GraphData, GraphNode, GraphEdge } from '../types';

interface GraphViewProps {
  graphData: GraphData;
  onNodeClick: (node: GraphNode) => void;
  highlightNodeId?: string;
}

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

export function GraphView({ graphData, onNodeClick, highlightNodeId }: GraphViewProps) {
  const fgRef = useRef<any>(null);

  // Configure d3 forces after the graph mounts or node count changes.
  // Default charge of -30 packs sparse graphs; -280 gives enough breathing room.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force('charge')?.strength(-280);
    fg.d3Force('link')?.distance(160);
    fg.d3Force('center')?.strength(0.08);
    fg.d3ReheatSimulation();
  }, [graphData.nodes.length]);

  const paintNode = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const size = Math.max(5, (node.size ?? 1) * 6);
      const color = ratingColor(node.rating);
      const isHighlighted = node.id === highlightNodeId;

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

      // Label — always show, scale font with zoom
      const fontSize = Math.max(10, Math.min(14, 12 / globalScale));
      ctx.font = `${isHighlighted ? 'bold ' : ''}${fontSize}px ui-monospace, "SF Mono", monospace`;
      ctx.fillStyle = isHighlighted ? '#fff' : '#cbd5e1';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(node.label, node.x!, node.y! + size + 3);
    },
    [highlightNodeId]
  );

  // Define a circular hit area for every node shape so drag works reliably
  // even on triangles and squares whose actual painted area differs from a circle.
  const paintPointerArea = useCallback(
    (node: GraphNode, color: string, ctx: CanvasRenderingContext2D) => {
      const size = Math.max(5, (node.size ?? 1) * 6) + 6;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(node.x!, node.y!, size, 0, 2 * Math.PI);
      ctx.fill();
    },
    []
  );

  // Pin nodes in place after dragging by writing fx/fy.
  // d3-force skips velocity updates for nodes with non-null fx/fy.
  const handleNodeDragEnd = useCallback((node: GraphNode) => {
    node.fx = node.x;
    node.fy = node.y;
  }, []);

  const forceData = {
    nodes: graphData.nodes,
    links: graphData.edges.map(e => ({
      source: typeof e.source === 'string' ? e.source : e.source.id,
      target: typeof e.target === 'string' ? e.target : e.target.id,
      strength: e.strength,
      type: e.type
    }))
  };

  return (
    <div style={{ flex: 1, position: 'relative', background: '#0a0f1e', overflow: 'hidden' }}>

      {/* Empty state */}
      {graphData.nodes.length === 0 && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          color: '#1e293b',
          pointerEvents: 'none'
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
        ref={fgRef}
        graphData={forceData}
        nodeId="id"
        nodeLabel={(n: any) =>
          `${n.label}\nRating: ${n.rating}/10\nLOC: ${n.metrics?.linesOfCode ?? 0}\nViolations: ${(n.violations ?? []).length}`
        }
        nodeCanvasObject={(n, ctx, scale) => paintNode(n as GraphNode, ctx, scale)}
        nodeCanvasObjectMode={() => 'replace'}
        nodePointerAreaPaint={(n, color, ctx) => paintPointerArea(n as GraphNode, color, ctx)}
        linkColor={(link: any) =>
          link.type === 'import' ? 'rgba(59,130,246,0.25)' : 'rgba(249,115,22,0.25)'
        }
        linkWidth={(link: any) => Math.max(0.5, (link.strength ?? 1) * 1.2)}
        linkDirectionalArrowLength={5}
        linkDirectionalArrowRelPos={1}
        onNodeClick={(n: any) => onNodeClick(n as GraphNode)}
        onNodeDragEnd={(n: any) => handleNodeDragEnd(n as GraphNode)}
        cooldownTicks={120}
        warmupTicks={40}
        backgroundColor="#0a0f1e"
        d3AlphaDecay={0.015}
        d3VelocityDecay={0.25}
      />

      {/* Legend */}
      <div style={{
        position: 'absolute',
        bottom: 16,
        left: 16,
        background: 'rgba(17,24,39,0.9)',
        border: '1px solid #1e293b',
        borderRadius: 8,
        padding: '10px 14px',
        fontSize: 12,
        color: '#64748b',
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
    </div>
  );
}
