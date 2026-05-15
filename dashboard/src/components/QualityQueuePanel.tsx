import React, { useState, useCallback, useMemo } from 'react';
import { QueueItem, AttemptLog } from '../types';
import { ThemeTokens } from '../ThemeContext';
import { useRepoSessions } from '../hooks/useRepoSessions';
import { useWorkerExecution, TerminalState } from '../hooks/useWorkerExecution';
import { useAttemptHistory } from '../hooks/useAttemptHistory';

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
  const repoSessionTypes = useRepoSessions();
  const {
    executingWorkers, terminalOutputs,
    handleExecute, handleCancel, clearWorkerState,
  } = useWorkerExecution();
  const { attempts, loadingAttempts, expandedId, loadAttempts } = useAttemptHistory();

  const { getCmdText, getSessionType } = useMemo(() => ({
    getSessionType: (repo: string): string => repoSessionTypes[repo] || 'unknown',
    getCmdText: (filePath: string, repo: string): string => {
      const sessionType = repoSessionTypes[repo] || 'unknown';
      const shortFile = filePath.split('/').pop() || filePath;
      return sessionType === 'github-copilot'
        ? `gh copilot suggest "fix violations in ${shortFile}"`
        : `claude --dangerously-skip-permissions "fix all violations in @${shortFile}"`;
    },
  }), [repoSessionTypes]);

  const handleDelete = useCallback(async (item: QueueItem) => {
    clearWorkerState(item.id);
    try {
      await fetch(`http://127.0.0.1:5379/api/quality/queue/${item.id}/delete`, { method: 'POST' });
    } catch { /* ignore */ }
  }, [clearWorkerState]);

  const filtered = filter === 'all' ? items : items.filter(i => i.status === filter);

  return (
    <div style={{ background: T.panel, borderRadius: 8, border: `1px solid ${T.border}`, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: `1px solid ${T.border}` }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>Queue ({items.length})</div>
        <div style={{ display: 'flex', gap: 4 }}>
          {['all', 'pending', 'in_progress', 'completed', 'failed', 'skipped'].map(s => (
            <FilterButton
              key={s}
              label={s.replace('_', ' ')}
              active={filter === s}
              onClick={() => setFilter(s)}
              T={T}
            />
          ))}
        </div>
      </div>

      {/* Items */}
      {filtered.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: T.textMuted }}>No items</div>
      ) : (
        <div style={{ maxHeight: 600, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${T.border}`, color: T.textMuted }}>
                <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 500, width: 40 }}>ID</th>
                <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 500 }}>File</th>
                <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 500 }}>Command</th>
                <th style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 500, width: 50 }}>Rating</th>
                <th style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 500, width: 70 }}>Status</th>
                <th style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 500, width: 60 }}>Attempts</th>
                <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 500, width: 160 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => (
                <QueueRow
                  key={item.id}
                  item={item}
                  T={T}
                  expandedId={expandedId}
                  terminalOutputs={terminalOutputs}
                  executingWorkers={executingWorkers}
                  attempts={attempts}
                  loadingAttempts={loadingAttempts}
                  getCmdText={getCmdText}
                  getSessionType={getSessionType}
                  handleExecute={handleExecute}
                  handleCancel={handleCancel}
                  handleDelete={handleDelete}
                  loadAttempts={loadAttempts}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FilterButton({
  label, active, onClick, T,
}: {
  label: string; active: boolean; onClick: () => void; T: ThemeTokens;
}) {
  return (
    <button onClick={onClick} style={{
      background: active ? T.accent : 'transparent', border: 'none',
      borderRadius: 4, color: active ? '#fff' : T.textMuted, cursor: 'pointer',
      fontSize: 10, fontWeight: 500, padding: '3px 8px', textTransform: 'capitalize',
    }}>{label}</button>
  );
}

interface QueueRowProps {
  item: QueueItem;
  T: ThemeTokens;
  expandedId: number | null;
  terminalOutputs: Record<number, TerminalState>;
  executingWorkers: Record<number, string>;
  attempts: Record<number, AttemptLog[]>;
  loadingAttempts: Set<number>;
  getCmdText: (filePath: string, repo: string) => string;
  getSessionType: (repo: string) => string;
  handleExecute: (itemId: number) => Promise<void>;
  handleCancel: (itemId: number) => void;
  handleDelete: (item: QueueItem) => Promise<void>;
  loadAttempts: (itemId: number) => Promise<void>;
}

function QueueRow({
  item, T, expandedId, terminalOutputs, executingWorkers,
  attempts, loadingAttempts, getCmdText, getSessionType,
  handleExecute, handleCancel, handleDelete, loadAttempts,
}: QueueRowProps) {
  const st = STATUS_STYLES[item.status] ?? STATUS_STYLES['pending']!;
  const expanded = expandedId === item.id;
  const hasTerminal = terminalOutputs[item.id] !== undefined;
  const isExecuting = executingWorkers[item.id] !== undefined;
  const term = hasTerminal ? terminalOutputs[item.id]! : null;

  const handleRowClick = useCallback(() => {
    if (!isExecuting) loadAttempts(item.id);
  }, [isExecuting, item.id, loadAttempts]);

  const handleExecuteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    handleExecute(item.id);
  }, [item.id, handleExecute]);

  const handleCancelClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    handleCancel(item.id);
  }, [item.id, handleCancel]);

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    handleDelete(item);
  }, [item, handleDelete]);

  const cmdText = getCmdText(item.filePath, item.repo);
  const cmdTruncated = cmdText.length > 30 ? cmdText.slice(0, 30) + '...' : cmdText;

  return (
    <React.Fragment>
      {/* Main row */}
      <tr
        onClick={handleRowClick}
        style={{
          cursor: isExecuting ? 'default' : 'pointer',
          borderBottom: `1px solid ${T.border}`,
          background: expanded ? T.bg : 'transparent',
        }}
      >
        <td style={{ padding: '6px 8px', color: T.textMuted, fontWeight: 500 }}>#{item.id}</td>
        <td style={{ padding: '6px 8px', color: T.text, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.filePath.replace(item.repo, '').replace(/^\//, '')}
        </td>
        <td style={{ padding: '6px 8px', color: T.textMuted, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 10, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {getSessionType(item.repo) === 'github-copilot' ? 'copilot' : 'claude'}
          <span style={{ color: T.textDim }}> | {cmdTruncated}</span>
        </td>
        <td style={{ padding: '6px 8px', textAlign: 'center' }}>
          <span style={{ color: item.currentRating >= item.targetRating ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
            {item.currentRating.toFixed(1)}
          </span>
          <span style={{ color: T.textMuted }}>/{item.targetRating.toFixed(1)}</span>
        </td>
        <td style={{ padding: '6px 8px', textAlign: 'center' }}>
          <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 500, background: st.bg, color: st.color }}>{st.label}</span>
        </td>
        <td style={{ padding: '6px 8px', textAlign: 'center', color: T.textMuted }}>
          {item.attempts}/{item.maxAttempts}
        </td>
        <td style={{ padding: '6px 8px', textAlign: 'right' }}>
          <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
            {item.status !== 'completed' && (
              isExecuting ? (
                <ActionBtn label="Cancel" color="#eab308" onClick={handleCancelClick} T={T} />
              ) : item.status !== 'in_progress' ? (
                <ActionBtn label="Execute" color="#22c55e" onClick={handleExecuteClick} T={T} />
              ) : null
            )}
            <ActionBtn label="Delete" color="#ef4444" onClick={handleDeleteClick} T={T} />
          </div>
        </td>
      </tr>

      {/* Expanded: terminal view or attempt history */}
      {expanded && (
        <tr>
          <td colSpan={7} style={{ padding: '0 16px 8px', background: T.bg }}>
            <div style={{ fontSize: 10, color: T.textMuted, marginTop: 4 }}>

              {/* Terminal view (executing / recently executed) */}
              {hasTerminal && term && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontWeight: 600, color: T.text, fontSize: 11 }}>Terminal Output</span>
                    {term.running && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#22c55e', fontSize: 10 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
                        Running...
                      </span>
                    )}
                    {!term.running && (
                      <span style={{ color: term.exitCode === 0 ? '#4ade80' : '#f87171', fontSize: 10 }}>
                        Exit code: {term.exitCode ?? '?'}
                      </span>
                    )}
                  </div>
                  <pre style={{
                    margin: 0, padding: 10,
                    background: '#0d1117', borderRadius: 4,
                    fontSize: 11, lineHeight: 1.5,
                    color: '#e6edf3', maxHeight: 300,
                    overflow: 'auto', whiteSpace: 'pre-wrap',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                  }}>
                    {term.output || (
                      <span style={{ color: '#8b949e' }}>Waiting for output…</span>
                    )}
                    {term.running && (
                      <span style={{ animation: 'pulse 1s step-end infinite', color: '#22c55e' }}> ▊</span>
                    )}
                  </pre>
                </div>
              )}

              {/* Error message (if any) */}
              {!hasTerminal && item.errorMessage && (
                <div style={{ color: '#f87171', marginBottom: 4 }}>Error: {item.errorMessage}</div>
              )}

              {/* Attempt history (shown when no terminal) */}
              {!hasTerminal && (
                loadingAttempts.has(item.id) ? (
                  <div style={{ color: T.textDim }}>Loading attempt log...</div>
                ) : attempts[item.id] ? (
                  <div>
                    <div style={{ fontWeight: 600, color: T.text, marginBottom: 4, fontSize: 11 }}>Attempt History</div>
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
                ) : null
              )}
            </div>
          </td>
        </tr>
      )}
    </React.Fragment>
  );
}

function ActionBtn({ label, color, onClick, T }: { label: string; color: string; onClick: (e: React.MouseEvent) => void; T: ThemeTokens }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: `${color}15`,
        border: `1px solid ${color}40`,
        borderRadius: 3,
        color,
        cursor: 'pointer',
        fontSize: 10,
        fontWeight: 500,
        padding: '2px 7px',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}
