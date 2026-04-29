import React, { useCallback, useRef } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { GraphData, GraphNode, GraphEdge } from '../types';

interface GraphViewProps {
  graphData: GraphData;
  onNodeClick: (node: GraphNode) => void;
  highlightNodeId?: string;
}

function ratingColor(rating: number): string {
  if (rating >= 8) return '#4caf50';
  if (rating >= 6) return '#ffc107';
  if (rating >= 4) return '#ff9800';
  return '#f44336';
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

  const paintNode = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const size = Math.max(4, (node.size ?? 1) * 6);
      const color = ratingColor(node.rating);
      const isHighlighted = node.id === highlightNodeId;

      ctx.beginPath();
      ctx.fillStyle = isHighlighted ? '#fff' : color;
      ctx.strokeStyle = isHighlighted ? color : 'rgba(255,255,255,0.15)';
      ctx.lineWidth = isHighlighted ? 2 : 0.5;

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

      // Label — only show when zoomed in enough
      if (globalScale >= 1.2 || isHighlighted) {
        const label = node.label;
        ctx.font = `${Math.max(8, 10 / globalScale)}px sans-serif`;
        ctx.fillStyle = '#e0e0e0';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(label, node.x!, node.y! + size + 2);
      }
    },
    [highlightNodeId]
  );

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
    <div style={{ flex: 1, position: 'relative', background: '#1a1a2e' }}>
      {graphData.nodes.length === 0 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#555',
            gap: 12
          }}
        >
          <div style={{ fontSize: 48 }}>⬡</div>
          <div style={{ fontSize: 16 }}>Waiting for file analysis…</div>
          <div style={{ fontSize: 12 }}>Edit any .ts / .tsx / .cs file to see the dependency graph</div>
        </div>
      )}
      <ForceGraph2D
        ref={fgRef}
        graphData={forceData}
        nodeId="id"
        nodeLabel={(n: any) => `${n.label}\nRating: ${n.rating}/10\nViolations: ${(n.violations ?? []).length}`}
        nodeCanvasObject={(n, ctx, scale) => paintNode(n as GraphNode, ctx, scale)}
        nodeCanvasObjectMode={() => 'replace'}
        linkColor={(link: any) => link.type === 'import' ? 'rgba(100,180,255,0.4)' : 'rgba(255,160,80,0.4)'}
        linkWidth={(link: any) => Math.max(0.5, (link.strength ?? 1) * 1.5)}
        linkDirectionalArrowLength={4}
        linkDirectionalArrowRelPos={1}
        onNodeClick={(n: any) => onNodeClick(n as GraphNode)}
        cooldownTicks={80}
        backgroundColor="#1a1a2e"
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
      />

      {/* Legend */}
      <div
        style={{
          position: 'absolute',
          bottom: 16,
          left: 16,
          background: 'rgba(15,52,96,0.85)',
          borderRadius: 8,
          padding: '10px 14px',
          fontSize: 11,
          color: '#ccc'
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Legend</div>
        <div>● circle = TypeScript/JS</div>
        <div>■ square = C#</div>
        <div>▲ triangle = React (TSX/JSX)</div>
        <div style={{ marginTop: 6 }}>
          <span style={{ color: '#4caf50' }}>■</span> ≥8 &nbsp;
          <span style={{ color: '#ffc107' }}>■</span> ≥6 &nbsp;
          <span style={{ color: '#ff9800' }}>■</span> ≥4 &nbsp;
          <span style={{ color: '#f44336' }}>■</span> &lt;4
        </div>
      </div>
    </div>
  );
}
