import React, { useCallback, useMemo, useState } from 'react';
import { GraphData, GraphNode } from '../types';
import { ThemeTokens, useTheme } from '../ThemeContext';

function rc(r: number, T: ThemeTokens) {
  if (r >= 8) return T.green;
  if (r >= 6) return T.yellow;
  if (r >= 4) return T.orange;
  return T.red;
}

// ── Props ──────────────────────────────────────────────────
interface FileListDrawerProps {
  graphData: GraphData;
  onNodeSelect: (node: GraphNode) => void;
  onClose: () => void;
}

type SortField = 'rating' | 'label' | 'linesOfCode' | 'violations';

// ── Main Component ─────────────────────────────────────────
export function FileListDrawer({ graphData, onNodeSelect, onClose }: FileListDrawerProps) {
  const { T } = useTheme();
  const [state, setState] = useState<{ search: string; sortField: SortField; sortDir: 'asc' | 'desc' }>(
    { search: '', sortField: 'rating', sortDir: 'asc' }
  );
  const { search, sortField, sortDir } = state;

  const handleSort = useCallback((field: SortField) => {
    setState(prev => {
      if (prev.sortField === field) {
        return { ...prev, sortDir: prev.sortDir === 'asc' ? 'desc' : 'asc' };
      }
      return { ...prev, sortField: field, sortDir: 'asc' };
    });
  }, []);

  const filtered = useMemo(() => {
    let nodes = graphData.nodes;
    if (search.trim()) {
      const q = search.toLowerCase();
      nodes = nodes.filter(n => n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q));
    }
    return [...nodes].sort((a, b) => {
      let av: number, bv: number;
      if (sortField === 'label') return sortDir === 'asc' ? a.label.localeCompare(b.label) : b.label.localeCompare(a.label);
      if (sortField === 'rating') { av = a.rating; bv = b.rating; }
      else if (sortField === 'linesOfCode') { av = a.metrics.linesOfCode; bv = b.metrics.linesOfCode; }
      else { av = a.violations.length; bv = b.violations.length; }
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [graphData.nodes, search, sortField, sortDir]);

  const totalLoc = graphData.nodes.reduce((a, n) => a + (n.metrics.linesOfCode || 1), 0);
  const overallRating = graphData.nodes.length > 0 && totalLoc > 0
    ? Math.round((graphData.nodes.reduce((a, n) => a + n.rating * (n.metrics.linesOfCode || 1), 0) / totalLoc) * 10) / 10
    : null;
  const totalViolations = graphData.nodes.reduce((a, n) => a + n.violations.length, 0);
  const errors = graphData.nodes.reduce((a, n) => a + n.violations.filter(v => v.severity === 'error').length, 0);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fade-in"
        onClick={onClose}
        style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 19,
        }}
      />

      {/* Drawer */}
      <div
        className="slide-in-right"
        style={{
          position: 'absolute', top: 0, right: 0, bottom: 0,
          width: 440, background: T.panel, borderLeft: `1px solid ${T.border}`,
          display: 'flex', flexDirection: 'column', zIndex: 20,
          boxShadow: '-8px 0 32px rgba(0,0,0,0.3)',
        }}
      >
        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>All Files</span>
            <button
              onClick={onClose}
              style={{
                background: 'none', border: 'none', color: T.textFaint, cursor: 'pointer',
                fontSize: 18, lineHeight: 1, padding: '2px 6px',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = T.text; }}
              onMouseLeave={e => { e.currentTarget.style.color = T.textFaint; }}
            >
              ×
            </button>
          </div>

          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
            <MiniCard
              label="Score"
              value={overallRating != null ? overallRating.toFixed(1) : '—'}
              color={overallRating != null ? rc(overallRating, T) : T.textDim}
            />
            <MiniCard label="Issues" value={totalViolations} color={totalViolations > 0 ? T.yellow : T.green} />
            <MiniCard label="Errors" value={errors} color={errors > 0 ? T.red : T.green} />
          </div>

          {/* Search */}
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: T.textDim, pointerEvents: 'none' }}>
              ⌕
            </span>
            <input
              type="text"
              value={search}
              onChange={e => setState(prev => ({ ...prev, search: e.target.value }))}
              placeholder="Filter files…"
              style={{
                width: '100%', padding: '7px 10px 7px 30px',
                background: T.elevated, border: `1px solid ${T.border}`,
                borderRadius: 6, color: T.text, fontSize: 13, outline: 'none',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = T.accent; }}
              onBlur={e => { e.currentTarget.style.borderColor = T.border; }}
            />
          </div>
        </div>

        {/* Column headers */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 80px 50px 50px',
          padding: '6px 20px', borderBottom: `1px solid ${T.border}`, flexShrink: 0,
        }}>
          {([['label', 'File'], ['rating', 'Rating'], ['linesOfCode', 'LOC'], ['violations', 'Issues']] as const).map(([field, label]) => (
            <SortHeader
              key={field}
              field={field}
              label={label}
              active={sortField === field}
              dir={sortField === field ? sortDir : 'asc'}
              onSort={handleSort}
            />
          ))}
        </div>

        {/* File rows */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: T.textDim, fontSize: 13 }}>
              {search ? 'No files match your search' : 'No files analyzed yet'}
            </div>
          ) : filtered.map(node => (
            <FileRow key={node.id} node={node} onSelect={onNodeSelect} />
          ))}
        </div>
      </div>
    </>
  );
}

// ── Sub-components ─────────────────────────────────────────

function MiniCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  const { T } = useTheme();
  return (
    <div style={{ background: T.elevated, borderRadius: 6, padding: '8px 10px', border: `1px solid ${T.border}` }}>
      <div style={{ fontSize: 10, color: T.textDim, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function SortHeader({ field, label, active, dir, onSort }: {
  field: SortField; label: string; active: boolean; dir: 'asc' | 'desc'; onSort: (f: SortField) => void;
}) {
  const { T } = useTheme();
  return (
    <div
      onClick={() => onSort(field)}
      style={{
        fontSize: 10, color: active ? T.accent : T.textDim,
        textTransform: 'uppercase', letterSpacing: 0.8,
        cursor: 'pointer', userSelect: 'none',
      }}
    >
      {label}{active ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}
    </div>
  );
}

function FileRow({ node, onSelect }: { node: GraphNode; onSelect: (n: GraphNode) => void }) {
  const { T } = useTheme();
  const errCount = node.violations.filter(v => v.severity === 'error').length;
  return (
    <div
      onClick={() => onSelect(node)}
      style={{
        display: 'grid', gridTemplateColumns: '1fr 80px 50px 50px',
        alignItems: 'center', padding: '8px 20px',
        borderBottom: `1px solid ${T.border}`, cursor: 'pointer', transition: 'background 0.1s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = T.panelHover; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
      <div style={{ overflow: 'hidden' }}>
        <div style={{ fontSize: 13, color: T.text, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.label}
        </div>
        {errCount > 0 && (
          <div style={{ fontSize: 10, color: T.red, marginTop: 1 }}>{errCount} error{errCount !== 1 ? 's' : ''}</div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ width: 44, height: 4, background: T.border, borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: `${(node.rating / 10) * 100}%`, height: '100%', background: rc(node.rating, T), borderRadius: 2 }} />
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, color: rc(node.rating, T), minWidth: 20 }}>{node.rating}</span>
      </div>
      <div style={{ fontSize: 12, color: T.textMuted, textAlign: 'right' }}>{node.metrics.linesOfCode}</div>
      <div style={{
        fontSize: 12, textAlign: 'right', fontWeight: node.violations.length > 0 ? 600 : 400,
        color: node.violations.length > 0 ? T.yellow : T.textDim,
      }}>
        {node.violations.length}
      </div>
    </div>
  );
}
