import React, { useCallback, useMemo, useState } from 'react';
import { GraphData, Violation } from '../types';
import { ThemeTokens } from '../ThemeContext';

type SeverityFilter = 'all' | 'error' | 'warning' | 'info';

interface FileViolation {
  fileLabel: string;
  fileId: string;
  violation: Violation;
}

interface ViolationsPanelProps {
  graphData: GraphData;
  onClose: () => void;
  T: ThemeTokens;
}

function severityColor(sev: Violation['severity'], T: ThemeTokens): string {
  if (sev === 'error') return T.red;
  if (sev === 'warning') return T.yellow;
  return T.textMuted;
}

function severityBadge(sev: Violation['severity']): string {
  if (sev === 'error') return 'ERR';
  if (sev === 'warning') return 'WARN';
  return 'INFO';
}

function buildCopyText(items: FileViolation[]): string {
  const grouped = new Map<string, FileViolation[]>();
  for (const item of items) {
    const existing = grouped.get(item.fileId) ?? [];
    existing.push(item);
    grouped.set(item.fileId, existing);
  }

  const lines: string[] = [];
  for (const [, fileItems] of grouped) {
    const first = fileItems[0];
    lines.push(`### ${first.fileLabel}`);
    for (const fi of fileItems) {
      const loc = fi.violation.line ? ` (line ${fi.violation.line})` : '';
      lines.push(`  [${fi.violation.severity.toUpperCase()}] ${fi.violation.message}${loc}`);
      if (fi.violation.fix) lines.push(`    Fix: ${fi.violation.fix}`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

function useViolationsPanel(graphData: GraphData, T: ThemeTokens) {
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [copied, setCopied] = useState(false);
  const [search, setSearch] = useState('');

  const allViolations = useMemo<FileViolation[]>(() => {
    const items: FileViolation[] = [];
    for (const node of graphData.nodes) {
      for (const v of node.violations) {
        items.push({ fileLabel: node.label, fileId: node.id, violation: v });
      }
    }
    return items;
  }, [graphData.nodes]);

  const filtered = useMemo(() => allViolations.filter(item => {
    if (severityFilter !== 'all' && item.violation.severity !== severityFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        item.fileLabel.toLowerCase().includes(q) ||
        item.violation.message.toLowerCase().includes(q) ||
        item.violation.type.toLowerCase().includes(q)
      );
    }
    return true;
  }), [allViolations, severityFilter, search]);

  const counts = useMemo(() => ({
    all: allViolations.length,
    error: allViolations.filter(i => i.violation.severity === 'error').length,
    warning: allViolations.filter(i => i.violation.severity === 'warning').length,
    info: allViolations.filter(i => i.violation.severity === 'info').length,
  }), [allViolations]);

  const groupedFiltered = useMemo(() => {
    const map = new Map<string, FileViolation[]>();
    for (const item of filtered) {
      const existing = map.get(item.fileId) ?? [];
      existing.push(item);
      map.set(item.fileId, existing);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);

  const handleCopy = useCallback(() => {
    const text = buildCopyText(filtered);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => { /* clipboard not available */ });
  }, [filtered]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
  }, []);
  const handleFilterAll = useCallback(() => setSeverityFilter('all'), []);
  const handleFilterError = useCallback(() => setSeverityFilter('error'), []);
  const handleFilterWarning = useCallback(() => setSeverityFilter('warning'), []);
  const handleFilterInfo = useCallback(() => setSeverityFilter('info'), []);

  return {
    severityFilter, copied, search,
    filtered, counts, groupedFiltered,
    handleCopy, handleSearchChange,
    handleFilterAll, handleFilterError, handleFilterWarning, handleFilterInfo,
  };
}

export function ViolationsPanel({ graphData, onClose, T }: ViolationsPanelProps) {
  const {
    severityFilter, copied, search,
    filtered, counts, groupedFiltered,
    handleCopy, handleSearchChange,
    handleFilterAll, handleFilterError, handleFilterWarning, handleFilterInfo,
  } = useViolationsPanel(graphData, T);

  const handlers = useMemo(() => ({
    filterBtnStyle: (active: boolean, color: string) => ({
      padding: '3px 10px',
      borderRadius: 4,
      border: `1px solid ${active ? color : T.border}`,
      background: active ? `${color}22` : 'transparent',
      color: active ? color : T.textDim,
      cursor: 'pointer',
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: 0.4,
    } as React.CSSProperties),
    onCloseBtnHover: (e: React.MouseEvent<HTMLButtonElement>) => {
      e.currentTarget.style.color = T.text;
    },
    onCloseBtnLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
      e.currentTarget.style.color = T.textFaint;
    },
    onSearchInputFocus: (e: React.FocusEvent<HTMLInputElement>) => {
      e.currentTarget.style.borderColor = T.accent;
    },
    onSearchInputBlur: (e: React.FocusEvent<HTMLInputElement>) => {
      e.currentTarget.style.borderColor = T.border;
    },
  }), [T]);

  return (
    <>
      <div
        className="fade-in"
        onClick={onClose}
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 19 }}
      />
      <div
        className="slide-in-right"
        style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, width: 520,
          background: T.panel, borderLeft: `1px solid ${T.border}`,
          display: 'flex', flexDirection: 'column', zIndex: 20,
          boxShadow: '-8px 0 32px rgba(0,0,0,0.3)',
        }}
      >
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>All Violations</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={handleCopy}
                title="Copy all visible violations"
                style={{
                  padding: '4px 10px', borderRadius: 5,
                  border: `1px solid ${copied ? T.green : T.borderBright}`,
                  background: copied ? `${T.green}22` : T.elevated,
                  color: copied ? T.green : T.textMuted,
                  cursor: 'pointer', fontSize: 11, fontWeight: 600, transition: 'all 0.15s',
                }}
              >
                {copied ? '✓ Copied' : '⎘ Copy'}
              </button>
              <button
                onClick={onClose}
                style={{
                  background: 'none', border: 'none', color: T.textFaint,
                  cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '2px 6px',
                }}
                onMouseEnter={handlers.onCloseBtnHover}
                onMouseLeave={handlers.onCloseBtnLeave}
              >
                ×
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <button style={handlers.filterBtnStyle(severityFilter === 'all', T.accent)} onClick={handleFilterAll}>
              All {counts.all}
            </button>
            <button style={handlers.filterBtnStyle(severityFilter === 'error', T.red)} onClick={handleFilterError}>
              Errors {counts.error}
            </button>
            <button style={handlers.filterBtnStyle(severityFilter === 'warning', T.yellow)} onClick={handleFilterWarning}>
              Warnings {counts.warning}
            </button>
            <button style={handlers.filterBtnStyle(severityFilter === 'info', T.textMuted)} onClick={handleFilterInfo}>
              Info {counts.info}
            </button>
          </div>
          <div style={{ position: 'relative' }}>
            <span style={{
              position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
              fontSize: 13, color: T.textDim, pointerEvents: 'none',
            }}>⌕</span>
            <input
              type="text"
              value={search}
              onChange={handleSearchChange}
              placeholder="Filter by file or message…"
              style={{
                width: '100%', padding: '7px 10px 7px 30px',
                background: T.elevated, border: `1px solid ${T.border}`,
                borderRadius: 6, color: T.text, fontSize: 13, outline: 'none',
              }}
              onFocus={handlers.onSearchInputFocus}
              onBlur={handlers.onSearchInputBlur}
            />
          </div>
        </div>
        <div style={{
          padding: '6px 20px', fontSize: 11, color: T.textDim,
          borderBottom: `1px solid ${T.border}`, flexShrink: 0,
        }}>
          {filtered.length} violation{filtered.length !== 1 ? 's' : ''} across{' '}
          {groupedFiltered.length} file{groupedFiltered.length !== 1 ? 's' : ''}
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {groupedFiltered.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: T.textDim, fontSize: 13 }}>
              {search || severityFilter !== 'all'
                ? 'No violations match your filter'
                : 'No violations found'}
            </div>
          ) : groupedFiltered.map(([fileId, items]) => (
            <FileViolationGroup key={fileId} fileId={fileId} items={items} T={T} />
          ))}
        </div>
      </div>
    </>
  );
}

function FileViolationGroup({ fileId, items, T }: { fileId: string; items: FileViolation[]; T: ThemeTokens }) {
  const [expanded, setExpanded] = useState(true);
  const handleToggle = useCallback(() => setExpanded(p => !p), []);
  const errorCount = items.filter(i => i.violation.severity === 'error').length;
  const label = items[0].fileLabel;

  const groupHandlers = useMemo(() => ({
    onMouseEnter: (e: React.MouseEvent<HTMLDivElement>) => {
      e.currentTarget.style.background = T.panelHover;
    },
    onMouseLeave: (e: React.MouseEvent<HTMLDivElement>) => {
      e.currentTarget.style.background = T.elevated;
    },
  }), [T]);

  return (
    <div style={{ borderBottom: `1px solid ${T.border}` }}>
      <div
        onClick={handleToggle}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 20px', cursor: 'pointer', background: T.elevated, userSelect: 'none',
        }}
        onMouseEnter={groupHandlers.onMouseEnter}
        onMouseLeave={groupHandlers.onMouseLeave}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
          <span style={{ fontSize: 10, color: T.textDim, flexShrink: 0 }}>{expanded ? '▾' : '▸'}</span>
          <span style={{
            fontSize: 12, fontWeight: 600, color: T.text,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {label}
          </span>
          {errorCount > 0 && (
            <span style={{
              fontSize: 10, color: '#EF4444', fontWeight: 700,
              background: '#EF444422', borderRadius: 3, padding: '1px 5px', flexShrink: 0,
            }}>
              {errorCount} error{errorCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <span style={{ fontSize: 11, color: T.textDim, flexShrink: 0, marginLeft: 8 }}>
          {items.length}
        </span>
      </div>

      {expanded && items.map((item, idx) => (
        <ViolationRow key={`${fileId}-${idx}`} item={item} T={T} />
      ))}
    </div>
  );
}

function ViolationRow({ item, T }: { item: FileViolation; T: ThemeTokens }) {
  const { violation } = item;
  const color = severityColor(violation.severity, T);
  const badge = severityBadge(violation.severity);

  return (
    <div style={{
      padding: '7px 20px 7px 36px',
      borderBottom: `1px solid ${T.border}`,
      background: T.panel,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{
          fontSize: 9, fontWeight: 700, color,
          background: `${color}22`, borderRadius: 3,
          padding: '2px 5px', flexShrink: 0, marginTop: 1,
          letterSpacing: 0.4,
        }}>
          {badge}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: T.text, lineHeight: 1.4 }}>
            {violation.message}
            {violation.line && (
              <span style={{ fontSize: 10, color: T.textDim, marginLeft: 6 }}>
                line {violation.line}
              </span>
            )}
          </div>
          {violation.fix && (
            <div style={{ fontSize: 11, color: T.textMuted, marginTop: 3, fontStyle: 'italic' }}>
              → {violation.fix}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
