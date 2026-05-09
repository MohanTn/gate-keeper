import React, { useCallback, useMemo, useState, useRef, useEffect, memo } from 'react';
import { GraphData, GraphNode } from '../types';
import { ThemeTokens, useTheme } from '../ThemeContext';

const ITEM_HEIGHT = 48;
const OVERSCAN = 4;

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
  width?: number;
}

type SortField = 'rating' | 'label' | 'linesOfCode' | 'violations';

// ── Main Component ─────────────────────────────────────────
export function FileListDrawer({ graphData, onNodeSelect, onClose, width = 400 }: FileListDrawerProps) {
  const { T } = useTheme();
  const [state, setState] = useState<{ search: string; sortField: SortField; sortDir: 'asc' | 'desc' }>(
    { search: '', sortField: 'rating', sortDir: 'asc' }
  );
  const { search, sortField, sortDir } = state;

  // Virtual scroll state
  const [scrollTop, setScrollTop] = useState(0);
  const [listHeight, setListHeight] = useState(400);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setListHeight(el.clientHeight));
    ro.observe(el);
    setListHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const handleCloseBtnEnter = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.color = T.text;
  }, [T.text]);
  const handleCloseBtnLeave = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.color = T.textMuted;
  }, [T.textMuted]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setState(prev => ({ ...prev, search: e.target.value }));
  }, []);

  const handleSearchFocus = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = T.accent;
  }, [T.accent]);
  const handleSearchBlur = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = T.border;
  }, [T.border]);

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

  const stats = useMemo(() => {
    const totalLoc = graphData.nodes.reduce((a, n) => a + (n.metrics.linesOfCode || 1), 0);
    const overallRating = graphData.nodes.length > 0 && totalLoc > 0
      ? Math.round((graphData.nodes.reduce((a, n) => a + n.rating * (n.metrics.linesOfCode || 1), 0) / totalLoc) * 10) / 10
      : null;
    const totalViolations = graphData.nodes.reduce((a, n) => a + n.violations.length, 0);
    const errors = graphData.nodes.reduce((a, n) => a + n.violations.filter(v => v.severity === 'error').length, 0);
    return { overallRating, totalViolations, errors };
  }, [graphData.nodes]);

  // Virtual window computation
  const totalHeight = filtered.length * ITEM_HEIGHT;
  const startIdx = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN);
  const endIdx = Math.min(filtered.length, Math.ceil((scrollTop + listHeight) / ITEM_HEIGHT) + OVERSCAN);
  const offsetY = startIdx * ITEM_HEIGHT;

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
              onMouseEnter={handleCloseBtnEnter}
              onMouseLeave={handleCloseBtnLeave}
            >
              Close
            </button>
          </div>

          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
            <MiniCard
              label="Score"
              value={stats.overallRating != null ? stats.overallRating.toFixed(1) : '—'}
              color={stats.overallRating != null ? rc(stats.overallRating, T) : T.textDim}
            />
            <MiniCard label="Issues" value={stats.totalViolations} color={stats.totalViolations > 0 ? T.yellow : T.green} />
            <MiniCard label="Errors" value={stats.errors} color={stats.errors > 0 ? T.red : T.green} />
          </div>

          {/* Search */}
          <input
            type="text"
            value={search}
            onChange={handleSearchChange}
            placeholder="Filter files…"
            style={{
              width: '100%', padding: '6px 10px',
              background: T.elevated, border: `1px solid ${T.border}`,
              borderRadius: 4, color: T.text, fontSize: 12, outline: 'none',
            }}
            onFocus={handleSearchFocus}
            onBlur={handleSearchBlur}
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
              onSort={handleSort}
            />
          ))}
        </div>

        {/* Virtualized file list */}
        <div ref={listRef} style={{ flex: 1, overflowY: 'auto' }} onScroll={handleScroll}>
          {filtered.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: T.textDim, fontSize: 13 }}>
              {search ? 'No files match your search' : 'No files analyzed yet'}
            </div>
          ) : (
            <div style={{ height: totalHeight, position: 'relative' }}>
              <div style={{ position: 'absolute', top: offsetY, left: 0, right: 0 }}>
                {filtered.slice(startIdx, endIdx).map(node => (
                  <FileRow key={node.id} node={node} onSelect={onNodeSelect} />
                ))}
              </div>
            </div>
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
        height: ITEM_HEIGHT, boxSizing: 'border-box',
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
        <span style={{ fontSize: 12, fontWeight: 600, color: rc(node.rating, T) }}>{node.rating}</span>
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
