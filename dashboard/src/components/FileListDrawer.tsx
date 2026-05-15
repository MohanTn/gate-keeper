import React, { useCallback, useMemo, useState, memo } from 'react';
import { GraphData, GraphNode } from '../types';
import { useTheme, ratingColor } from '../ThemeContext';

// ── Props ──────────────────────────────────────────────────
interface FileListDrawerProps {
  graphData: GraphData;
  onNodeSelect: (node: GraphNode) => void;
  onClose: () => void;
  width?: number;
}

type SortField = 'rating' | 'label' | 'linesOfCode' | 'violations';

const NUMERIC_SORT: Partial<Record<SortField, (n: GraphNode) => number>> = {
  rating: n => n.rating,
  linesOfCode: n => n.metrics.linesOfCode,
  violations: n => n.violations.length,
};

const TOGGLE_DIR: Record<'asc' | 'desc', 'asc' | 'desc'> = { asc: 'desc', desc: 'asc' };

interface FileListState {
  search: string;
  sortField: SortField;
  sortDir: 'asc' | 'desc';
}

// ── Custom hook — consolidates all state, handlers, and derived data ──
function useFileListState(graphData: GraphData) {
  const { T } = useTheme();
  const [state, setState] = useState<FileListState>({ search: '', sortField: 'rating', sortDir: 'asc' });
  const { search, sortField, sortDir } = state;

  const handlers = useMemo(() => ({
    closeBtnEnter: (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.color = T.text; },
    closeBtnLeave: (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.color = T.textMuted; },
    searchChange: (e: React.ChangeEvent<HTMLInputElement>) => { setState(prev => ({ ...prev, search: e.target.value })); },
    searchFocus: (e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.borderColor = T.accent; },
    searchBlur: (e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.borderColor = T.border; },
    sort: (field: SortField) => {
      setState(prev => ({
        ...prev, sortField: field,
        sortDir: prev.sortField === field ? TOGGLE_DIR[prev.sortDir] : 'asc',
      }));
    },
  }), [T.text, T.textMuted, T.accent, T.border]);

  const computed = useMemo(() => {
    const q = search.trim().toLowerCase();
    const nodes = q
      ? graphData.nodes.filter(n => `${n.label}|${n.id}`.toLowerCase().includes(q))
      : graphData.nodes;
    const filtered = [...nodes].sort((a, b) => {
      const numFn = NUMERIC_SORT[sortField];
      if (!numFn) return sortDir === 'asc' ? a.label.localeCompare(b.label) : b.label.localeCompare(a.label);
      return sortDir === 'asc' ? numFn(a) - numFn(b) : numFn(b) - numFn(a);
    });

    const totalLoc = graphData.nodes.reduce((acc, n) => acc + (n.metrics.linesOfCode || 1), 0);
    const totalViolations = graphData.nodes.reduce((acc, n) => acc + n.violations.length, 0);
    const errors = graphData.nodes.reduce((acc, n) => acc + n.violations.filter(v => v.severity === 'error').length, 0);
    const overallRating = totalLoc > 0
      ? Math.round((graphData.nodes.reduce((acc, n) => acc + n.rating * (n.metrics.linesOfCode || 1), 0) / totalLoc) * 10) / 10
      : null;

    return { filtered, stats: { overallRating, totalViolations, errors } };
  }, [graphData.nodes, search, sortField, sortDir]);

  return { T, state: { search, sortField, sortDir }, handlers, ...computed };
}

// ── Main Component ─────────────────────────────────────────
export function FileListDrawer({ graphData, onNodeSelect, onClose, width = 400 }: FileListDrawerProps) {
  const { T, state: { search, sortField, sortDir }, handlers, filtered, stats } = useFileListState(graphData);

  return (
    <div
      style={{
        flex: `0 0 ${width}px`, background: T.panel, borderLeft: `1px solid ${T.border}`,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>All Files</span>
            <button
              onClick={onClose}
              style={{
                background: 'none', border: `1px solid ${T.border}`, color: T.textMuted,
                borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontSize: 11,
              }}
              onMouseEnter={handlers.closeBtnEnter}
              onMouseLeave={handlers.closeBtnLeave}
            >
              Close
            </button>
          </div>

          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
            <MiniCard
              label="Score"
              value={stats.overallRating != null ? stats.overallRating.toFixed(1) : '—'}
              color={stats.overallRating != null ? ratingColor(stats.overallRating, T) : T.textDim}
            />
            <MiniCard label="Issues" value={stats.totalViolations} color={stats.totalViolations > 0 ? T.yellow : T.green} />
            <MiniCard label="Errors" value={stats.errors} color={stats.errors > 0 ? T.red : T.green} />
          </div>

          {/* Search */}
          <input
            type="text"
            value={search}
            onChange={handlers.searchChange}
            placeholder="Filter files…"
            style={{
              width: '100%', padding: '6px 10px',
              background: T.elevated, border: `1px solid ${T.border}`,
              borderRadius: 4, color: T.text, fontSize: 12, outline: 'none',
            }}
            onFocus={handlers.searchFocus}
            onBlur={handlers.searchBlur}
          />
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
              onSort={handlers.sort}
            />
          ))}
        </div>

        {/* File list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: T.textDim, fontSize: 13 }}>
              {search ? 'No files match your search' : 'No files analyzed yet'}
            </div>
          ) : (
            filtered.map(node => (
              <FileRow key={node.id} node={node} onSelect={onNodeSelect} />
            ))
          )}
        </div>
    </div>
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
  const handleClick = useCallback(() => onSort(field), [field, onSort]);
  return (
    <div
      onClick={handleClick}
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

const FileRow = memo(function FileRow({ node, onSelect }: { node: GraphNode; onSelect: (n: GraphNode) => void }) {
  const { T } = useTheme();
  const errCount = node.violations.filter(v => v.severity === 'error').length;
  const rowOnClick = useCallback(() => onSelect(node), [node, onSelect]);
  const rowOnMouseEnter = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.currentTarget.style.background = T.panelHover;
  }, [T.panelHover]);
  const rowOnMouseLeave = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.currentTarget.style.background = 'transparent';
  }, []);
  return (
    <div
      onClick={rowOnClick}
      style={{
        display: 'grid', gridTemplateColumns: '1fr 80px 50px 50px',
        alignItems: 'center', padding: '0 20px',
        height: 48, boxSizing: 'border-box',
        borderBottom: `1px solid ${T.border}`, cursor: 'pointer', transition: 'background 0.1s',
      }}
      onMouseEnter={rowOnMouseEnter}
      onMouseLeave={rowOnMouseLeave}
    >
      <div style={{ overflow: 'hidden' }}>
        <div style={{ fontSize: 13, color: T.text, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.label}
        </div>
        {errCount > 0 && (
          <div style={{ fontSize: 10, color: T.red, marginTop: 1 }}>{errCount} error{errCount !== 1 ? 's' : ''}</div>
        )}
      </div>
      <div style={{ textAlign: 'right' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: ratingColor(node.rating, T) }}>{node.rating}</span>
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
});
