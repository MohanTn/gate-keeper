import React, { Component, ErrorInfo, useMemo } from 'react';
import { GraphData, GraphNode } from '../types';
import { ThemeTokens, ratingColor, healthLabel } from '../ThemeContext';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallbackData?: GraphData;
  onNodeSelect?: (node: GraphNode) => void;
  T: ThemeTokens;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class GraphErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Gate Keeper] Graph render error:', error.message, info.componentStack);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <FallbackTable
          data={this.props.fallbackData}
          onNodeSelect={this.props.onNodeSelect}
          T={this.props.T}
          error={this.state.error?.message ?? 'Unknown error'}
          onRetry={this.handleRetry}
        />
      );
    }
    return this.props.children;
  }
}

function FallbackTable({
  data, onNodeSelect, T, error, onRetry,
}: {
  data?: GraphData;
  onNodeSelect?: (node: GraphNode) => void;
  T: ThemeTokens;
  error: string;
  onRetry: () => void;
}) {
  const nodes = data?.nodes ?? [];
  const sorted = [...nodes].sort((a, b) => a.rating - b.rating);
  const totalViolations = nodes.reduce((s, n) => s + n.violations.length, 0);
  const errorsCnt = nodes.reduce((s, n) => s + n.violations.filter(v => v.severity === 'error').length, 0);
  const avgRating = nodes.length > 0
    ? (nodes.reduce((s, n) => s + n.rating, 0) / nodes.length).toFixed(1)
    : '—';

  return (
    <div style={{ flex: 1, overflow: 'auto', background: T.bg, padding: '24px 32px', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        background: '#7F1D1D', border: '1px solid #991B1B', borderRadius: 6,
        padding: '12px 16px', marginBottom: 20,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#FEE2E2', marginBottom: 2 }}>
            Graph render error — showing table view
          </div>
          <div style={{ fontSize: 11, color: '#FCA5A5', fontFamily: 'monospace' }}>{error}</div>
        </div>
        <button onClick={onRetry} style={{
          background: '#991B1B', border: '1px solid #B91C1C', borderRadius: 4,
          color: '#FEE2E2', cursor: 'pointer', fontSize: 12, padding: '6px 14px',
          fontWeight: 600, flexShrink: 0, marginLeft: 16,
        }}>Retry Graph</button>
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
        <StatBox label="Files" value={nodes.length} color={T.text} T={T} />
        <StatBox label="Avg Rating" value={avgRating} color={avgRating !== '—' ? ratingColor(Number(avgRating), T) : T.textFaint} T={T} />
        <StatBox label="Violations" value={totalViolations} color={totalViolations > 0 ? T.yellow : T.green} T={T} />
        <StatBox label="Errors" value={errorsCnt} color={errorsCnt > 0 ? T.red : T.green} T={T} />
      </div>

      {nodes.length === 0 ? (
        <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', color: T.textFaint, fontSize: 14, flexDirection: 'column', gap: 8 }}>
          <div>No files analyzed yet.</div>
          <div style={{ fontSize: 12 }}>Click Scan to start analysis.</div>
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${T.border}` }}>
              <Th T={T} align="left">File</Th>
              <Th T={T}>Rating</Th>
              <Th T={T}>Health</Th>
              <Th T={T}>LOC</Th>
              <Th T={T}>Violations</Th>
              <Th T={T}>Errors</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(node => (
              <TableRow key={node.id} node={node} T={T} onNodeSelect={onNodeSelect} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function StatBox({ label, value, color, T }: { label: string; value: string | number; color: string; T: ThemeTokens }) {
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 6, padding: '12px 20px', minWidth: 120 }}>
      <div style={{ fontSize: 10, color: T.textDim, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function Th({ children, T, align = 'left' }: { children: React.ReactNode; T: ThemeTokens; align?: 'left' | 'center' | 'right' }) {
  return <th style={{ padding: '10px 16px', fontSize: 10, color: T.textDim, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600, textAlign: align }}>{children}</th>;
}

function Td({ children, T, align = 'left' }: { children: React.ReactNode; T: ThemeTokens; align?: 'left' | 'center' | 'right' }) {
  return <td style={{ padding: '10px 16px', fontSize: 13, color: T.text, textAlign: align }}>{children}</td>;
}

function TableRow({ node, T, onNodeSelect }: { node: GraphNode; T: ThemeTokens; onNodeSelect?: (n: GraphNode) => void }) {
  const { handleClick, handleMouseEnter, handleMouseLeave } = useMemo(() => ({
    handleClick: () => onNodeSelect?.(node),
    handleMouseEnter: (e: React.MouseEvent<HTMLTableRowElement>) => { e.currentTarget.style.background = T.panelHover; },
    handleMouseLeave: (e: React.MouseEvent<HTMLTableRowElement>) => { e.currentTarget.style.background = 'transparent'; },
  }), [node, onNodeSelect, T.panelHover]);
  return (
    <tr onClick={handleClick}
      style={{ borderBottom: `1px solid ${T.border}`, cursor: onNodeSelect ? 'pointer' : 'default' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}>
      <Td T={T}>
        <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 400 }}>{node.label}</div>
        <div style={{ fontSize: 10, color: T.textFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 400 }}>{node.id}</div>
      </Td>
      <Td T={T} align="center">
        <span style={{ fontWeight: 700, color: ratingColor(node.rating, T) }}>{node.rating}</span>
      </Td>
      <Td T={T} align="center">
        <span style={{ fontSize: 11, fontWeight: 600, color: ratingColor(node.rating, T), padding: '2px 8px', borderRadius: 3, background: `${ratingColor(node.rating, T)}18`, border: `1px solid ${ratingColor(node.rating, T)}40` }}>{healthLabel(node.rating)}</span>
      </Td>
      <Td T={T} align="right">{node.metrics.linesOfCode}</Td>
      <Td T={T} align="right">
        <span style={{ color: node.violations.length > 0 ? T.yellow : T.textFaint, fontWeight: node.violations.length > 0 ? 600 : 400 }}>{node.violations.length}</span>
      </Td>
      <Td T={T} align="right">
        <span style={{ color: node.violations.filter(v => v.severity === 'error').length > 0 ? T.red : T.textFaint }}>{node.violations.filter(v => v.severity === 'error').length}</span>
      </Td>
    </tr>
  );
}
