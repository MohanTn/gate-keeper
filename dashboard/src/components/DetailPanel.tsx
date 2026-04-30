import React, { useCallback, useEffect, useState } from 'react';
import { GraphData, GraphNode, FileDetailResponse } from '../types';
import { ThemeTokens, useTheme } from '../ThemeContext';

function rc(r: number, T: ThemeTokens) {
  if (r >= 8) return T.green;
  if (r >= 6) return T.yellow;
  if (r >= 4) return T.orange;
  return T.red;
}

function healthLabel(r: number) {
  if (r >= 8) return 'Healthy';
  if (r >= 6) return 'Warning';
  if (r >= 4) return 'Degraded';
  return 'Critical';
}

// ── Props ──────────────────────────────────────────────────
interface DetailPanelProps {
  node: GraphNode;
  graphData: GraphData;
  onClose: () => void;
  onNodeSelect: (node: GraphNode) => void;
}

// ── Main Component ─────────────────────────────────────────
export function DetailPanel({ node, graphData, onClose, onNodeSelect }: DetailPanelProps) {
  const { T } = useTheme();
  const [panelState, setPanelState] = useState<{ detail: FileDetailResponse | null; loading: boolean }>(
    { detail: null, loading: false }
  );
  const { detail, loading } = panelState;

  useEffect(() => {
    setPanelState({ detail: null, loading: true });
    fetch(`/api/file-detail?file=${encodeURIComponent(node.id)}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: FileDetailResponse | null) => { setPanelState({ detail: d, loading: false }); })
      .catch(() => setPanelState(prev => ({ ...prev, loading: false })));
  }, [node.id]);

  const deps = graphData.edges.filter(e => {
    const src = typeof e.source === 'string' ? e.source : e.source.id;
    return src === node.id;
  });

  const dependents = graphData.edges.filter(e => {
    const tgt = typeof e.target === 'string' ? e.target : e.target.id;
    return tgt === node.id;
  });

  return (
    <div
      className="slide-in-right"
      style={{
        position: 'absolute', top: 0, right: 0, bottom: 0,
        width: 420, background: T.panel, borderLeft: `1px solid ${T.border}`,
        display: 'flex', flexDirection: 'column', zIndex: 20,
        boxShadow: '-8px 0 32px rgba(0,0,0,0.3)',
      }}
    >
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: `1px solid ${T.border}`, color: T.textMuted,
              borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontSize: 12,
              display: 'flex', alignItems: 'center', gap: 4,
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = T.borderBright; e.currentTarget.style.color = T.text; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.textMuted; }}
          >
            ← Back
          </button>
          <LangBadge lang={node.type} />
        </div>

        <div style={{ fontSize: 17, fontWeight: 700, color: T.text, wordBreak: 'break-word', lineHeight: 1.3 }}>
          {node.label}
        </div>
        <div
          style={{ fontSize: 11, color: T.textDim, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          title={node.id}
        >
          {node.id}
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 24px' }}>

        {/* Health score + status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '18px 0', borderBottom: `1px solid ${T.border}` }}>
          <div style={{
            width: 64, height: 64, borderRadius: 12,
            background: T.elevated, border: `2px solid ${rc(node.rating, T)}`,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: 24, fontWeight: 800, color: rc(node.rating, T), lineHeight: 1 }}>{node.rating}</span>
            <span style={{ fontSize: 10, color: T.textDim }}>/10</span>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: rc(node.rating, T) }} />
              <span style={{ fontSize: 14, fontWeight: 600, color: rc(node.rating, T) }}>
                {healthLabel(node.rating)}
              </span>
            </div>
            {detail?.gitDiff ? (
              <div style={{ fontSize: 12, color: T.textFaint }}>
                <span style={{ color: T.green }}>+{detail.gitDiff.added}</span>
                {' / '}
                <span style={{ color: T.red }}>−{detail.gitDiff.removed}</span>
                {' lines changed'}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: T.textDim }}>
                {loading ? 'Loading…' : 'No uncommitted changes'}
              </div>
            )}
          </div>
        </div>

        {/* Metrics */}
        <Section label="Metrics">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <MetricCell label="Lines" value={node.metrics.linesOfCode} />
            <MetricCell label="Complexity" value={node.metrics.cyclomaticComplexity} warn={node.metrics.cyclomaticComplexity > 10} />
            <MetricCell label="Methods" value={node.metrics.numberOfMethods} />
            <MetricCell label="Classes" value={node.metrics.numberOfClasses} />
            <MetricCell label="Imports" value={node.metrics.importCount} warn={node.metrics.importCount > 15} />
            <MetricCell label="Deps" value={deps.length} />
          </div>
        </Section>

        {/* Rating Breakdown */}
        {detail && (
          <Section label="Rating Breakdown">
            {detail.ratingBreakdown.length === 0 ? (
              <div style={{ fontSize: 13, color: T.green, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>✓</span> No deductions — clean file
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 12 }}>
                  <span style={{ color: T.textDim }}>Base score</span>
                  <span style={{ color: T.textMuted }}>10.0</span>
                </div>
                {detail.ratingBreakdown.map((item, i) => (
                  <div key={i} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '6px 0', borderTop: `1px solid ${T.border}`,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: T.text }}>{item.category}</div>
                      <div style={{ fontSize: 11, color: T.textDim, marginTop: 1 }}>{item.detail}</div>
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 700, color: T.red, marginLeft: 12, flexShrink: 0 }}>
                      −{item.deduction.toFixed(1)}
                    </span>
                  </div>
                ))}
                <div style={{
                  display: 'flex', justifyContent: 'space-between',
                  paddingTop: 8, marginTop: 4, borderTop: `2px solid ${T.borderBright}`,
                }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>Final</span>
                  <span style={{ fontSize: 15, fontWeight: 800, color: rc(node.rating, T) }}>{node.rating}</span>
                </div>
              </div>
            )}
          </Section>
        )}

        {/* Violations */}
        {node.violations.length > 0 && (
          <Section label={`Violations (${node.violations.length})`} action={<CopyButton node={node} />}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {node.violations.map((v, i) => (
                <div key={i} style={{
                  background: T.elevated,
                  borderLeft: `3px solid ${v.severity === 'error' ? T.red : v.severity === 'warning' ? T.yellow : T.accent}`,
                  padding: '8px 12px', borderRadius: '0 6px 6px 0',
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                    <span style={{
                      display: 'inline-block', width: 7, height: 7, borderRadius: '50%', marginTop: 5, flexShrink: 0,
                      background: v.severity === 'error' ? T.red : v.severity === 'warning' ? T.yellow : T.textDim,
                    }} />
                    <span style={{ fontSize: 13, color: T.text, lineHeight: 1.4 }}>{v.message}</span>
                  </div>
                  {v.line != null && <div style={{ fontSize: 11, color: T.textDim, marginTop: 3, marginLeft: 13 }}>Line {v.line}</div>}
                  {v.fix && <div style={{ fontSize: 11, color: T.green, marginTop: 3, marginLeft: 13, fontStyle: 'italic' }}>Fix: {v.fix}</div>}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Dependencies (imports from this file) */}
        {deps.length > 0 && (
          <Section label={`Imports (${deps.length})`}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {deps.map((e, i) => {
                const tgt = typeof e.target === 'string' ? e.target : e.target.id;
                const targetNode = graphData.nodes.find(n => n.id === tgt);
                return (
                  <DepRow
                    key={i}
                    label={tgt.split('/').pop() ?? tgt}
                    rating={targetNode?.rating}
                    clickable={!!targetNode}
                    onClick={() => { if (targetNode) onNodeSelect(targetNode); }}
                  />
                );
              })}
            </div>
          </Section>
        )}

        {/* Dependents (files that import this file) */}
        {dependents.length > 0 && (
          <Section label={`Used by (${dependents.length})`}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {dependents.map((e, i) => {
                const src = typeof e.source === 'string' ? e.source : e.source.id;
                const sourceNode = graphData.nodes.find(n => n.id === src);
                return (
                  <DepRow
                    key={i}
                    label={src.split('/').pop() ?? src}
                    rating={sourceNode?.rating}
                    clickable={!!sourceNode}
                    onClick={() => { if (sourceNode) onNodeSelect(sourceNode); }}
                  />
                );
              })}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────

function Section({ label, children, action }: { label: string; children: React.ReactNode; action?: React.ReactNode }) {
  const { T } = useTheme();
  return (
    <div style={{ padding: '16px 0', borderBottom: `1px solid ${T.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: T.textDim, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>
          {label}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function MetricCell({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  const { T } = useTheme();
  return (
    <div style={{ background: T.elevated, borderRadius: 6, padding: '8px 10px' }}>
      <div style={{ fontSize: 10, color: T.textDim, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: warn ? T.yellow : T.text }}>{value}</div>
    </div>
  );
}

function LangBadge({ lang }: { lang: string }) {
  const colors: Record<string, string> = { typescript: '#3B82F6', tsx: '#06B6D4', jsx: '#F59E0B', csharp: '#A78BFA' };
  const labels: Record<string, string> = { typescript: 'TS', tsx: 'TSX', jsx: 'JSX', csharp: 'C#' };
  const color = colors[lang] ?? '#64748B';
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, color, border: `1px solid ${color}`,
      borderRadius: 4, padding: '2px 6px', letterSpacing: 0.5,
    }}>
      {labels[lang] ?? lang.toUpperCase()}
    </span>
  );
}

function DepRow({ label, rating, clickable, onClick }: {
  label: string; rating?: number; clickable: boolean; onClick: () => void;
}) {
  const { T } = useTheme();
  return (
    <div
      onClick={clickable ? onClick : undefined}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '5px 8px', borderRadius: 5, cursor: clickable ? 'pointer' : 'default',
        fontSize: 13, color: clickable ? T.accent : T.textDim,
      }}
      onMouseEnter={e => { if (clickable) e.currentTarget.style.background = T.panelHover; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
      <span>→ {label}</span>
      {rating != null && (
        <span style={{ fontSize: 12, fontWeight: 600, color: rc(rating, T) }}>{rating}</span>
      )}
    </div>
  );
}

function CopyButton({ node }: { node: GraphNode }) {
  const { T } = useTheme();
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    const lines = [
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
        fontSize: 11, padding: '3px 10px',
        background: copied ? 'rgba(34,197,94,0.1)' : T.elevated,
        border: `1px solid ${copied ? T.green : T.border}`,
        borderRadius: 5, color: copied ? T.green : T.textMuted,
        cursor: 'pointer', transition: 'all 0.2s', flexShrink: 0,
      }}
    >
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  );
}
