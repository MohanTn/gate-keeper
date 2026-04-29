import React from 'react';
import { GraphData, GraphNode } from '../types';
import { MetricCard } from './MetricCard';

interface SidebarProps {
  graphData: GraphData;
  selectedNode: GraphNode | null;
  onClearSelection: () => void;
}

function ratingColor(rating: number): string {
  if (rating >= 8) return '#4caf50';
  if (rating >= 6) return '#ffc107';
  if (rating >= 4) return '#ff9800';
  return '#f44336';
}

function overallRating(nodes: GraphNode[]): number {
  if (nodes.length === 0) return 10;
  const sum = nodes.reduce((acc, n) => acc + n.rating, 0);
  return Math.round((sum / nodes.length) * 10) / 10;
}

function countCircularDeps(graphData: GraphData): number {
  // Simple cycle detection: if A→B and B→A exist
  const edgeSet = new Set<string>();
  let cycles = 0;
  for (const edge of graphData.edges) {
    const src = typeof edge.source === 'string' ? edge.source : edge.source.id;
    const tgt = typeof edge.target === 'string' ? edge.target : edge.target.id;
    const forward = `${src}→${tgt}`;
    const backward = `${tgt}→${src}`;
    if (edgeSet.has(backward)) cycles++;
    edgeSet.add(forward);
  }
  return cycles;
}

export function Sidebar({ graphData, selectedNode, onClearSelection }: SidebarProps) {
  const styles = {
    container: {
      width: 300,
      minWidth: 300,
      background: '#0f3460',
      padding: 20,
      overflowY: 'auto' as const,
      borderLeft: '1px solid #1a1a4e'
    },
    header: {
      fontSize: 18,
      fontWeight: 700,
      marginBottom: 16,
      color: '#e040fb',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    },
    tag: (color: string) => ({
      display: 'inline-block',
      background: color,
      color: '#fff',
      borderRadius: 4,
      padding: '2px 8px',
      fontSize: 11,
      fontWeight: 600,
      marginBottom: 12
    }),
    violationItem: (severity: string) => ({
      background: severity === 'error' ? '#3b1a1a' : severity === 'warning' ? '#3b2d0a' : '#1a2a3b',
      borderLeft: `3px solid ${severity === 'error' ? '#f44336' : severity === 'warning' ? '#ffc107' : '#42a5f5'}`,
      padding: '8px 12px',
      marginBottom: 8,
      borderRadius: '0 4px 4px 0',
      fontSize: 13
    }),
    fixText: {
      fontSize: 11,
      color: '#4caf50',
      marginTop: 4,
      fontStyle: 'italic'
    },
    backBtn: {
      background: 'none',
      border: '1px solid #3f51b5',
      color: '#90caf9',
      borderRadius: 4,
      padding: '4px 10px',
      cursor: 'pointer',
      fontSize: 12
    }
  };

  if (selectedNode) {
    const depCount = graphData.edges.filter(e => {
      const src = typeof e.source === 'string' ? e.source : e.source.id;
      return src === selectedNode.id;
    }).length;

    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <span>File Details</span>
          <button style={styles.backBtn} onClick={onClearSelection}>← Back</button>
        </div>

        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 8, wordBreak: 'break-all' }}>
          {selectedNode.label}
        </div>
        <div style={styles.tag(ratingColor(selectedNode.rating))}>
          Rating: {selectedNode.rating}/10
        </div>
        <div style={styles.tag('#607d8b')}>{selectedNode.type.toUpperCase()}</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
          <MetricCard title="Lines" value={selectedNode.metrics.linesOfCode} color="#42a5f5" />
          <MetricCard title="Complexity" value={selectedNode.metrics.cyclomaticComplexity} color="#ab47bc" />
          <MetricCard title="Methods" value={selectedNode.metrics.numberOfMethods} color="#26c6da" />
          <MetricCard title="Imports" value={selectedNode.metrics.importCount} color="#ffca28" />
        </div>

        {selectedNode.violations.length > 0 && (
          <>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#ccc' }}>
              Violations ({selectedNode.violations.length})
            </div>
            {selectedNode.violations.map((v, i) => (
              <div key={i} style={styles.violationItem(v.severity)}>
                <div>{v.message}</div>
                {v.line && <div style={{ fontSize: 11, color: '#9e9e9e', marginTop: 2 }}>Line {v.line}</div>}
                {v.fix && <div style={styles.fixText}>Fix: {v.fix}</div>}
              </div>
            ))}
          </>
        )}

        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 16, marginBottom: 8, color: '#ccc' }}>
          Dependencies ({depCount})
        </div>
        {graphData.edges
          .filter(e => {
            const src = typeof e.source === 'string' ? e.source : e.source.id;
            return src === selectedNode.id;
          })
          .map((e, i) => {
            const tgt = typeof e.target === 'string' ? e.target : e.target.id;
            return (
              <div key={i} style={{ fontSize: 12, color: '#9e9e9e', paddingBottom: 4 }}>
                → {tgt.split('/').pop()}
              </div>
            );
          })}
      </div>
    );
  }

  const rating = overallRating(graphData.nodes);
  const cycles = countCircularDeps(graphData);
  const hotspots = [...graphData.nodes].sort((a, b) => a.rating - b.rating).slice(0, 5);

  return (
    <div style={styles.container}>
      <div style={styles.header}>Architecture Health</div>

      <MetricCard
        title="Overall Rating"
        value={`${rating}/10`}
        trend={rating < 6 ? 'down' : 'up'}
        color={ratingColor(rating)}
      />
      <MetricCard
        title="Files Analyzed"
        value={graphData.nodes.length}
        color="#42a5f5"
      />
      <MetricCard
        title="Circular Dependencies"
        value={cycles}
        alert={cycles > 0}
        subtitle={cycles > 0 ? 'Circular deps degrade maintainability' : 'None detected'}
      />
      <MetricCard
        title="Total Violations"
        value={graphData.nodes.reduce((acc, n) => acc + n.violations.length, 0)}
        alert={graphData.nodes.some(n => n.violations.some(v => v.severity === 'error'))}
      />

      {hotspots.length > 0 && (
        <>
          <div style={{ fontSize: 13, fontWeight: 600, marginTop: 8, marginBottom: 8, color: '#ccc' }}>
            Hotspots (lowest rated)
          </div>
          {hotspots.map(node => (
            <div
              key={node.id}
              style={{
                background: '#16213e',
                borderLeft: `3px solid ${ratingColor(node.rating)}`,
                padding: '6px 12px',
                marginBottom: 6,
                borderRadius: '0 4px 4px 0',
                fontSize: 13
              }}
            >
              <div style={{ fontWeight: 500 }}>{node.label}</div>
              <div style={{ color: ratingColor(node.rating), fontSize: 12 }}>
                {node.rating}/10 · {node.violations.length} violations
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
