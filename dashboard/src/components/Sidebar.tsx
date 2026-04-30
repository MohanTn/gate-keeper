import React, { useCallback, useEffect, useState } from 'react';
import { GraphData, GraphNode, FileDetailResponse } from '../types';

interface SidebarProps {
  graphData: GraphData;
  selectedNode: GraphNode | null;
  onClearSelection: () => void;
  onNodeSelect: (node: GraphNode) => void;
}

// ── Design tokens ──────────────────────────────────────────
const T = {
  panel:       '#111827',
  panelHover:  '#1a2332',
  border:      '#1e293b',
  borderBright:'#2d3f55',
  text:        '#f1f5f9',
  textMuted:   '#94a3b8',
  textFaint:   '#475569',
  green:       '#22c55e',
  yellow:      '#eab308',
  orange:      '#f97316',
  red:         '#ef4444',
  accent:      '#3b82f6',
};

function rc(r: number) {
  if (r >= 8) return T.green;
  if (r >= 6) return T.yellow;
  if (r >= 4) return T.orange;
  return T.red;
}

function RatingBar({ rating }: { rating: number }) {
  const pct = (rating / 10) * 100;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 52, height: 5, background: '#1e293b', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: rc(rating), borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 13, color: rc(rating), fontWeight: 700, minWidth: 26 }}>{rating}</span>
    </div>
  );
}

function LangBadge({ lang }: { lang: string }) {
  const colors: Record<string, string> = {
    typescript: '#3b82f6', tsx: '#06b6d4', jsx: '#f59e0b', csharp: '#a78bfa'
  };
  const labels: Record<string, string> = {
    typescript: 'TS', tsx: 'TSX', jsx: 'JSX', csharp: 'C#'
  };
  const color = colors[lang] ?? '#64748b';
  return (
    <span style={{
      fontSize: 10,
      fontWeight: 700,
      color,
      border: `1px solid ${color}`,
      borderRadius: 3,
      padding: '1px 5px',
      letterSpacing: 0.5,
      whiteSpace: 'nowrap' as const
    }}>
      {labels[lang] ?? lang.toUpperCase()}
    </span>
  );
}

function SevDot({ severity }: { severity: string }) {
  const c = severity === 'error' ? T.red : severity === 'warning' ? T.yellow : T.textFaint;
  return <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: c, marginRight: 4 }} />;
}

type SortField = 'rating' | 'label' | 'linesOfCode' | 'violations';

// ── Sub-components extracted to avoid inline handlers ──────

function SortHeaderCell({ field, label, sortField, sortDir, onSort }: {
  field: SortField | '';
  label: string;
  sortField: SortField;
  sortDir: 'asc' | 'desc';
  onSort: (f: SortField) => void;
}) {
  const handleClick = useCallback(() => { if (field) onSort(field as SortField); }, [field, onSort]);
  const arrow = field && sortField === field ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';
  return (
    <div
      onClick={field ? handleClick : undefined}
      style={{
        fontSize: 11,
        color: (field && sortField === field) ? T.accent : T.textFaint,
        textTransform: 'uppercase',
        letterSpacing: 0.8,
        cursor: field ? 'pointer' : 'default',
        userSelect: 'none',
        whiteSpace: 'nowrap' as const
      }}
    >
      {label}{arrow}
    </div>
  );
}

function FileRow({ node, onNodeSelect }: { node: GraphNode; onNodeSelect: (n: GraphNode) => void }) {
  const handleClick = useCallback(() => onNodeSelect(node), [node, onNodeSelect]);
  const handleMouseEnter = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.currentTarget.style.background = T.panelHover;
  }, []);
  const handleMouseLeave = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.currentTarget.style.background = 'transparent';
  }, []);
  const errorCount = node.violations.filter(v => v.severity === 'error').length;

  return (
    <div
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 44px 100px 44px 44px',
        alignItems: 'center',
        padding: '9px 20px',
        borderBottom: `1px solid ${T.border}`,
        cursor: 'pointer',
        transition: 'background 0.1s'
      }}
    >
      <div style={{ overflow: 'hidden' }}>
        <div style={{ fontSize: 14, color: T.text, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
          {node.label}
        </div>
        {errorCount > 0 && (
          <div style={{ fontSize: 11, color: T.red, marginTop: 1 }}>
            {errorCount} error{errorCount !== 1 ? 's' : ''}
          </div>
        )}
      </div>
      <div><LangBadge lang={node.type} /></div>
      <div><RatingBar rating={node.rating} /></div>
      <div style={{ fontSize: 13, color: T.textMuted, textAlign: 'right' as const }}>{node.metrics.linesOfCode}</div>
      <div style={{ fontSize: 13, color: node.violations.length > 0 ? T.yellow : T.textFaint, textAlign: 'right' as const, fontWeight: node.violations.length > 0 ? 600 : 400 }}>
        {node.violations.length}
      </div>
    </div>
  );
}

function DepLink({ tgt, targetNode, onNodeSelect }: {
  tgt: string;
  targetNode: GraphNode | undefined;
  onNodeSelect: (n: GraphNode) => void;
}) {
  const handleClick = useCallback(() => { if (targetNode) onNodeSelect(targetNode); }, [targetNode, onNodeSelect]);
  return (
    <div
      onClick={targetNode ? handleClick : undefined}
      style={{ fontSize: 13, color: targetNode ? T.accent : T.textFaint, cursor: targetNode ? 'pointer' : 'default', padding: '3px 0' }}
    >
      → {tgt.split('/').pop()}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────
export function Sidebar({ graphData, selectedNode, onClearSelection, onNodeSelect }: SidebarProps) {
  const [state, setState] = useState<{
    fileDetail: FileDetailResponse | null;
    detailLoading: boolean;
    sortField: SortField;
    sortDir: 'asc' | 'desc';
  }>({ fileDetail: null, detailLoading: false, sortField: 'rating', sortDir: 'asc' });

  const { fileDetail, detailLoading, sortField, sortDir } = state;

  useEffect(() => {
    if (!selectedNode) { setState(s => ({ ...s, fileDetail: null })); return; }
    setState(s => ({ ...s, detailLoading: true }));
    fetch(`/api/file-detail?file=${encodeURIComponent(selectedNode.id)}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: FileDetailResponse | null) => setState(s => ({ ...s, fileDetail: d, detailLoading: false })))
      .catch(() => setState(s => ({ ...s, detailLoading: false })));
  }, [selectedNode?.id]);

  const handleSort = useCallback((field: SortField) => {
    setState(s => ({
      ...s,
      sortField: field,
      sortDir: s.sortField === field ? (s.sortDir === 'asc' ? 'desc' : 'asc') : 'asc',
    }));
  }, []);

  if (selectedNode) return (
    <FileDetailPanel
      node={selectedNode}
      detail={fileDetail}
      loading={detailLoading}
      graphData={graphData}
      onBack={onClearSelection}
      onNodeSelect={onNodeSelect}
    />
  );

  // ── Overview + file table ──
  const overallRating = graphData.nodes.length > 0
    ? graphData.nodes.reduce((a, n) => a + n.rating, 0) / graphData.nodes.length
    : null;

  const totalViolations = graphData.nodes.reduce((a, n) => a + n.violations.length, 0);
  const errors = graphData.nodes.reduce((a, n) => a + n.violations.filter(v => v.severity === 'error').length, 0);

  const sorted = [...graphData.nodes].sort((a, b) => {
    let av: number, bv: number;
    if (sortField === 'rating')          { av = a.rating; bv = b.rating; }
    else if (sortField === 'label')      { return sortDir === 'asc' ? a.label.localeCompare(b.label) : b.label.localeCompare(a.label); }
    else if (sortField === 'linesOfCode') { av = a.metrics.linesOfCode; bv = b.metrics.linesOfCode; }
    else                                  { av = a.violations.length; bv = b.violations.length; }
    return sortDir === 'asc' ? av - bv : bv - av;
  });

  const columns: [SortField | '', string][] = [
    ['label', 'File'], ['', 'Lang'], ['rating', 'Rating'], ['linesOfCode', 'LOC'], ['violations', 'Issues']
  ];

  return (
    <div style={{ width: 380, minWidth: 380, background: T.panel, display: 'flex', flexDirection: 'column', borderLeft: `1px solid ${T.border}`, overflow: 'hidden' }}>

      {/* Summary bar */}
      <div style={{ padding: '16px 20px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ fontSize: 11, color: T.textFaint, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
          Workspace Health
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <SummaryCard
            label="Arch Score"
            value={overallRating !== null ? `${overallRating.toFixed(1)}/10` : '—'}
            color={overallRating !== null ? rc(overallRating) : T.textFaint}
          />
          <SummaryCard label="Files" value={graphData.nodes.length} color={T.accent} />
          <SummaryCard
            label="Violations"
            value={totalViolations}
            color={totalViolations > 0 ? T.yellow : T.green}
          />
          <SummaryCard
            label="Errors"
            value={errors}
            color={errors > 0 ? T.red : T.green}
          />
        </div>
      </div>

      {/* File table header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 44px 100px 44px 44px',
        gap: 0,
        padding: '8px 20px',
        borderBottom: `1px solid ${T.border}`,
        flexShrink: 0
      }}>
        {columns.map(([field, label]) => (
          <SortHeaderCell
            key={label}
            field={field}
            label={label}
            sortField={sortField}
            sortDir={sortDir}
            onSort={handleSort}
          />
        ))}
      </div>

      {/* File rows */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {sorted.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: T.textFaint, fontSize: 13 }}>
            No files analyzed yet.<br />
            <span style={{ fontSize: 12 }}>Click "Scan All Files" to begin.</span>
          </div>
        ) : sorted.map(node => (
          <FileRow key={node.id} node={node} onNodeSelect={onNodeSelect} />
        ))}
      </div>
    </div>
  );
}

// ── Summary card (mini) ────────────────────────────────────
function SummaryCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div style={{ background: '#0f172a', borderRadius: 6, padding: '10px 14px', border: `1px solid ${T.border}` }}>
      <div style={{ fontSize: 11, color: T.textFaint, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

// ── File detail panel ──────────────────────────────────────
function FileDetailPanel({
  node, detail, loading, graphData, onBack, onNodeSelect
}: {
  node: GraphNode;
  detail: FileDetailResponse | null;
  loading: boolean;
  graphData: GraphData;
  onBack: () => void;
  onNodeSelect: (n: GraphNode) => void;
}) {
  const depCount = graphData.edges.filter(e => {
    const src = typeof e.source === 'string' ? e.source : e.source.id;
    return src === node.id;
  }).length;

  return (
    <div style={{ width: 380, minWidth: 380, background: T.panel, display: 'flex', flexDirection: 'column', borderLeft: `1px solid ${T.border}`, overflow: 'hidden' }}>

      {/* File header */}
      <div style={{ padding: '14px 20px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <button
            onClick={onBack}
            style={{ background: 'none', border: `1px solid ${T.border}`, color: T.textMuted, borderRadius: 5, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}
          >
            ← Files
          </button>
          <LangBadge lang={node.type} />
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: T.text, wordBreak: 'break-all' }}>
          {node.label}
        </div>
        <div style={{ fontSize: 12, color: T.textFaint, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }} title={node.id}>
          {node.id}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 20px' }}>

        {/* Rating + git diff */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '14px 0', borderBottom: `1px solid ${T.border}` }}>
          <div>
            <SectionLabel>Rating</SectionLabel>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
              <span style={{ fontSize: 32, fontWeight: 800, color: rc(node.rating) }}>{node.rating}</span>
              <span style={{ fontSize: 14, color: T.textFaint }}>/10</span>
            </div>
          </div>
          {detail?.gitDiff ? (
            <div>
              <SectionLabel>Changes vs HEAD</SectionLabel>
              <div style={{ display: 'flex', gap: 10, marginTop: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 18, fontWeight: 700, color: T.green }}>+{detail.gitDiff.added}</span>
                <span style={{ fontSize: 18, fontWeight: 700, color: T.red }}>−{detail.gitDiff.removed}</span>
              </div>
            </div>
          ) : (
            <div>
              <SectionLabel>Changes vs HEAD</SectionLabel>
              <div style={{ fontSize: 13, color: T.textFaint, marginTop: 4 }}>{loading ? 'Loading…' : 'No changes'}</div>
            </div>
          )}
        </div>

        {/* Metrics grid */}
        <div style={{ padding: '14px 0', borderBottom: `1px solid ${T.border}` }}>
          <SectionLabel>Metrics</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
            <MetricRow label="Lines of Code" value={node.metrics.linesOfCode} />
            <MetricRow label="Complexity" value={node.metrics.cyclomaticComplexity} warn={node.metrics.cyclomaticComplexity > 10} />
            <MetricRow label="Methods" value={node.metrics.numberOfMethods} />
            <MetricRow label="Imports" value={node.metrics.importCount} warn={node.metrics.importCount > 15} />
            <MetricRow label="Classes" value={node.metrics.numberOfClasses} />
            <MetricRow label="Dependencies" value={depCount} />
          </div>
        </div>

        {/* Rating breakdown */}
        {detail && (
          <div style={{ padding: '14px 0', borderBottom: `1px solid ${T.border}` }}>
            <SectionLabel>Rating Breakdown</SectionLabel>
            {detail.ratingBreakdown.length === 0 ? (
              <div style={{ marginTop: 8, fontSize: 13, color: T.green }}>✓ No deductions — clean file</div>
            ) : (
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: T.textFaint }}>Base</span>
                  <span style={{ fontSize: 12, color: T.textMuted }}>10.0</span>
                </div>
                {detail.ratingBreakdown.map((item, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderTop: `1px solid ${T.border}` }}>
                    <div>
                      <div style={{ fontSize: 13, color: T.text }}>{item.category}</div>
                      <div style={{ fontSize: 11, color: T.textFaint }}>{item.detail}</div>
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 700, color: T.red, marginLeft: 12 }}>
                      −{item.deduction.toFixed(1)}
                    </span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, borderTop: `1px solid ${T.borderBright}` }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>Final</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: rc(node.rating) }}>{node.rating}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Violations */}
        {node.violations.length > 0 && (
          <div style={{ padding: '14px 0', borderBottom: `1px solid ${T.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <SectionLabel>Violations ({node.violations.length})</SectionLabel>
              <CopyViolationsButton node={node} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {node.violations.map((v, i) => (
                <div key={i} style={{
                  background: '#0f172a',
                  borderLeft: `3px solid ${v.severity === 'error' ? T.red : v.severity === 'warning' ? T.yellow : T.accent}`,
                  padding: '8px 12px',
                  borderRadius: '0 5px 5px 0'
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                    <SevDot severity={v.severity} />
                    <span style={{ fontSize: 13, color: T.text, lineHeight: 1.4 }}>{v.message}</span>
                  </div>
                  {v.line && <div style={{ fontSize: 11, color: T.textFaint, marginTop: 3 }}>Line {v.line}</div>}
                  {v.fix && <div style={{ fontSize: 11, color: T.green, marginTop: 3, fontStyle: 'italic' }}>Fix: {v.fix}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Dependencies */}
        {depCount > 0 && (
          <div style={{ paddingTop: 14 }}>
            <SectionLabel>Imports ({depCount})</SectionLabel>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {graphData.edges
                .filter(e => {
                  const src = typeof e.source === 'string' ? e.source : e.source.id;
                  return src === node.id;
                })
                .map((e, i) => {
                  const tgt = typeof e.target === 'string' ? e.target : e.target.id;
                  const targetNode = graphData.nodes.find(n => n.id === tgt);
                  return (
                    <DepLink key={i} tgt={tgt} targetNode={targetNode} onNodeSelect={onNodeSelect} />
                  );
                })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CopyViolationsButton({ node }: { node: GraphNode }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    const lines: string[] = [
      `File: ${node.id}`,
      `Rating: ${node.rating}/10`,
      `Violations: ${node.violations.length}`,
      '',
    ];
    node.violations.forEach((v, i) => {
      lines.push(`${i + 1}. [${v.severity.toUpperCase()}] ${v.message}`);
      if (v.line) lines.push(`   Line: ${v.line}`);
      if (v.fix) lines.push(`   Fix: ${v.fix}`);
      lines.push('');
    });
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [node]);

  return (
    <button
      onClick={handleCopy}
      style={{
        fontSize: 11,
        padding: '3px 10px',
        background: copied ? 'rgba(34,197,94,0.1)' : '#0f172a',
        border: `1px solid ${copied ? T.green : T.border}`,
        borderRadius: 5,
        color: copied ? T.green : T.textMuted,
        cursor: 'pointer',
        transition: 'all 0.2s',
        whiteSpace: 'nowrap' as const,
        flexShrink: 0,
      }}
    >
      {copied ? '✓ Copied!' : 'Copy All'}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, color: T.textFaint, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>
      {children}
    </div>
  );
}

function MetricRow({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div style={{ background: '#0f172a', borderRadius: 5, padding: '8px 12px' }}>
      <div style={{ fontSize: 11, color: T.textFaint, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: warn ? T.yellow : T.text }}>{value}</div>
    </div>
  );
}
