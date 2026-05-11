import React, { useState } from 'react';
import { QueueItem, AttemptLog } from '../types';
import { ThemeTokens } from '../ThemeContext';

interface Props {
  items: QueueItem[];
  T: ThemeTokens;
}

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  pending: { bg: '#374151', color: '#9ca3af', label: 'Pending' },
  in_progress: { bg: '#1e3a5f', color: '#60a5fa', label: 'In Progress' },
  completed: { bg: '#14532d', color: '#4ade80', label: 'Completed' },
  failed: { bg: '#450a0a', color: '#f87171', label: 'Failed' },
  skipped: { bg: '#1f2937', color: '#6b7280', label: 'Skipped' },
};

export function QualityQueuePanel({ items, T }: Props) {
  const [filter, setFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [attempts, setAttempts] = useState<Record<number, AttemptLog[]>>({});
  const [loadingAttempts, setLoadingAttempts] = useState<Set<number>>(new Set());

  const filtered = filter === 'all' ? items : items.filter(i => i.status === filter);

  const loadAttempts = async (itemId: number) => {
    if (attempts[itemId]) { setExpandedId(expandedId === itemId ? null : itemId); return; }
    setLoadingAttempts(prev => new Set(prev).add(itemId));
    try {
      const res = await fetch(`http://127.0.0.1:5379/api/quality/attempts/${itemId}`);
      if (res.ok) {
        const data = await res.json() as AttemptLog[];
        setAttempts(prev => ({ ...prev, [itemId]: data }));
      }
    } catch { /* ignore */ }
    setLoadingAttempts(prev => { const n = new Set(prev); n.delete(itemId); return n; });
    setExpandedId(itemId);
  };

  return (
    <div style={{ background: T.panel, borderRadius: 8, border: `1px solid ${T.border}`, overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: `1px solid ${T.border}` }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>Queue ({items.length})</div>
        <div style={{ display: 'flex', gap: 4 }}>
          {['all', 'pending', 'in_progress', 'completed', 'failed', 'skipped'].map(s => (
            <button key={s} onClick={() => setFilter(s)} style={{
              background: filter === s ? T.accent : 'transparent', border: 'none',
              borderRadius: 4, color: filter === s ? '#fff' : T.textMuted, cursor: 'pointer',
              fontSize: 10, fontWeight: 500, padding: '3px 8px', textTransform: 'capitalize',
            }}>{s.replace('_', ' ')}</button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: T.textMuted }}>No items</div>
      ) : (
        <div style={{ maxHeight: 400, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${T.border}`, color: T.textMuted }}>
                <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 500 }}>File</th>
                <th style={{ padding: '6px 10px', textAlign: 'center', fontWeight: 500 }}>Rating</th>
                <th style={{ padding: '6px 10px', textAlign: 'center', fontWeight: 500 }}>Status</th>
                <th style={{ padding: '6px 10px', textAlign: 'center', fontWeight: 500 }}>Attempts</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => {
                const st = STATUS_STYLES[item.status] ?? STATUS_STYLES['pending']!;
                const expanded = expandedId === item.id;
                return (
                  <React.Fragment key={item.id}>
                    <tr
                      onClick={() => loadAttempts(item.id)}
                      style={{
                        cursor: 'pointer', borderBottom: `1px solid ${T.border}`,
                        background: expanded ? T.bg : 'transparent',
                      }}
                    >
                      <td style={{ padding: '6px 10px', color: T.text, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.filePath.replace(item.repo, '').replace(/^\//, '')}
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                        <span style={{ color: item.currentRating >= item.targetRating ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
                          {item.currentRating.toFixed(1)}
                        </span>
                        <span style={{ color: T.textMuted }}>/{item.targetRating.toFixed(1)}</span>
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                        <span style={{
                          display: 'inline-block', padding: '1px 6px', borderRadius: 3,
                          fontSize: 10, fontWeight: 500, background: st.bg, color: st.color,
                        }}>{st.label}</span>
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'center', color: T.textMuted }}>
                        {item.attempts}/{item.maxAttempts}
                      </td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={4} style={{ padding: '0 16px 8px', background: T.bg }}>
                          <div style={{ fontSize: 10, color: T.textMuted, marginTop: 4 }}>
                            {item.errorMessage && <div style={{ color: '#f87171', marginBottom: 4 }}>Error: {item.errorMessage}</div>}
                            {loadingAttempts.has(item.id) ? (
                              <div style={{ color: T.textDim }}>Loading attempt log...</div>
                            ) : attempts[item.id] ? (
                              <div>
                                <div style={{ fontWeight: 600, color: T.text, marginBottom: 4 }}>Attempt History</div>
                                {attempts[item.id]!.map(a => (
                                  <div key={a.id} style={{ padding: '2px 0' }}>
                                    <div style={{ display: 'flex', gap: 12, color: T.textMuted }}>
                                      <span>#{a.attempt}</span>
                                      <span>{a.rating_before.toFixed(1)} → {a.rating_after?.toFixed(1) ?? '?'}</span>
                                      <span>{a.violations_fixed} fixed, {a.violations_remaining} remaining</span>
                                      {a.duration_ms && <span>({(a.duration_ms / 1000).toFixed(0)}s)</span>}
                                    </div>
                                    {a.worker_output && a.worker_output.length > 0 && (
                                      <pre style={{
                                        margin: '4px 0 0 0', padding: 8,
                                        background: '#0d1117', borderRadius: 4,
                                        fontSize: 10, lineHeight: 1.4,
                                        color: '#e6edf3', maxHeight: 200,
                                        overflow: 'auto', whiteSpace: 'pre-wrap',
                                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                                      }}>{a.worker_output}</pre>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
