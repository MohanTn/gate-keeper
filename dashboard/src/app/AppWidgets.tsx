import React, { useCallback, useEffect, useRef } from 'react';
import { ratingColor, ThemeTokens } from '../ThemeContext';
import { GraphNode, ScanLogEntry } from '../types';

export { ConfigEditorModal } from './ConfigEditorModal';
export { RepoSelectorModal } from './RepoSelectorModal';
export { FilterPanel } from './FilterPanel';

export function ResizableWrapper({ width, onResizeStart, children, T, withBackdrop, onBackdropClick }: {
  width: number;
  onResizeStart: (e: React.MouseEvent) => void;
  children: React.ReactNode;
  T: ThemeTokens;
  withBackdrop?: boolean;
  onBackdropClick?: () => void;
}) {
  return (
    <>
      {withBackdrop && <div className="fade-in" onClick={onBackdropClick} style={{ position: 'absolute', inset: 0, background: T.backdrop, zIndex: 19 }} />}
      <div className="slide-in-right" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width, display: 'flex', zIndex: 20 }}>
        <div onMouseDown={onResizeStart} style={{ width: 6, cursor: 'col-resize', flexShrink: 0, background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 21 }}>
          <div style={{ width: 2, height: 32, borderRadius: 1, background: T.borderBright }} />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>{children}</div>
      </div>
    </>
  );
}

export function LogsPanel({ logs, onClose, T }: { logs: ScanLogEntry[]; onClose: () => void; T: ThemeTokens }) {
  const logsEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs.length]);

  return (
    <div style={{ width: 340, minWidth: 240, maxWidth: 500, background: T.panel, borderRight: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: T.text }}>Scan Logs</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: T.textFaint, cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '2px 6px' }}>x</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', fontFamily: 'monospace', fontSize: 12 }}>
        {logs.length === 0 ? (
          <div style={{ color: T.textDim, padding: 16, textAlign: 'center', fontSize: 13, fontFamily: 'inherit' }}>No scan logs yet. Run a scan to see activity.</div>
        ) : logs.map((log, i) => (
          <div key={`${log.timestamp}-${i}`} style={{ padding: '3px 0', color: log.level === 'error' ? T.red : log.level === 'warn' ? T.yellow : T.textMuted, lineHeight: 1.5, wordBreak: 'break-all' }}>
            <span style={{ color: T.textDim, marginRight: 6 }}>{new Date(log.timestamp).toLocaleTimeString()}</span>
            {log.message}
          </div>
        ))}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
}

export function RepoLoadingOverlay({ T }: { T: ThemeTokens }) {
  return (
    <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', background: T.bg }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <div style={{ width: 40, height: 40, border: `3px solid ${T.border}`, borderTopColor: T.accent, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <span style={{ fontSize: 15, color: T.textMuted, fontWeight: 500 }}>Loading repository...</span>
      </div>
    </div>
  );
}

export function SearchResultItem({ node, onSelect, T }: { node: GraphNode; onSelect: (n: GraphNode) => void; T: ThemeTokens }) {
  const handleMouseDown = useCallback(() => onSelect(node), [node, onSelect]);
  return (
    <div className="search-result-item" onMouseDown={handleMouseDown} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 14px', cursor: 'pointer', borderBottom: `1px solid ${T.border}` }}>
      <span style={{ fontSize: 14, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: ratingColor(node.rating, T), marginLeft: 8, flexShrink: 0 }}>{node.rating}</span>
    </div>
  );
}

export function Divider({ T }: { T: ThemeTokens }) {
  return <div style={{ width: 1, height: 22, background: T.border, flexShrink: 0 }} />;
}

export function HeaderStat({ label, value, color, bold, onClick, T }: { label: string; value: number | string; color: string; bold?: boolean; onClick?: () => void; T: ThemeTokens }) {
  return (
    <div onClick={onClick} title={onClick ? `View all ${label.toLowerCase()}` : undefined} style={{ display: 'flex', flexDirection: 'column', lineHeight: 1, flexShrink: 0, cursor: onClick ? 'pointer' : 'default' }}>
      <span style={{ fontSize: 10, color: T.textDim, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 2 }}>{label}{onClick ? ' ->' : ''}</span>
      <span style={{ fontSize: 16, fontWeight: bold ? 700 : 600, color }}>{value}</span>
    </div>
  );
}

export function ScanProgressIndicator({ analyzed, total, T }: { analyzed: number; total: number; T: ThemeTokens }) {
  const pct = total > 0 ? Math.round((analyzed / total) * 100) : 0;
  return (
    <div title={total > 0 ? `${analyzed}/${total} (${pct}%)` : 'Scanning...'} style={{ display: 'flex', alignItems: 'center', gap: 8, background: T.border, border: `1px solid ${T.accent}`, borderRadius: 6, padding: '5px 12px', flexShrink: 0, minWidth: 180 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: T.accent, animation: 'progressPulse 1.2s ease-in-out infinite', flexShrink: 0 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: T.accent, whiteSpace: 'nowrap' }}>{total > 0 ? `${analyzed} / ${total}` : 'Scanning...'}</span>
          {total > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: T.accent, marginLeft: 6 }}>{pct}%</span>}
        </div>
        <div style={{ height: 3, background: T.borderBright, borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: 2, background: T.accent, transition: 'width 0.3s ease', width: total > 0 ? `${pct}%` : '40%', animation: total === 0 ? 'progressPulse 1.5s ease-in-out infinite' : 'none' }} />
        </div>
      </div>
    </div>
  );
}

export function HeaderButton({ label, onClick, disabled, primary, danger, title, T, active }: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
  title?: string;
  T: ThemeTokens;
  active?: boolean;
}) {
  let bg = T.panel;
  let borderColor = T.border;
  let textColor = T.textMuted;
  if (active && !disabled) {
    bg = T.accent + '22';
    borderColor = T.accent;
    textColor = T.accent;
  }
  if (primary && !disabled) {
    bg = T.accentDim;
    borderColor = T.accent;
    textColor = '#EFF6FF';
  }
  if (danger && !disabled) {
    bg = '#7F1D1D';
    borderColor = '#991B1B';
    textColor = '#FEE2E2';
  }
  if (disabled) {
    bg = T.panel;
    borderColor = T.border;
    textColor = T.textDim;
  }

  return (
    <button onClick={onClick} disabled={disabled} title={title} style={{ display: 'flex', alignItems: 'center', gap: 4, background: bg, border: `1px solid ${borderColor}`, borderRadius: 6, color: textColor, cursor: disabled ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, padding: '5px 12px', transition: 'all 0.12s', flexShrink: 0 }}>
      {label}
    </button>
  );
}
