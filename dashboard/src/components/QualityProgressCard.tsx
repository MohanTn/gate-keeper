import React from 'react';
import { QueueStats } from '../types';
import { ThemeTokens } from '../ThemeContext';

interface Props {
  stats: QueueStats | null;
  overallRating: number;
  running: boolean;
  paused: boolean;
  T: ThemeTokens;
}

export function QualityProgressCard({ stats, overallRating, running, paused, T }: Props) {
  if (!stats || stats.total === 0) {
    return (
      <div style={{ background: T.panel, borderRadius: 8, padding: 20, border: `1px solid ${T.border}` }}>
        <div style={{ fontSize: 13, color: T.textMuted }}>No files in queue. Run a scan first.</div>
      </div>
    );
  }

  const pct = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
  const barColor = pct === 100 ? '#22c55e' : pct > 50 ? '#eab308' : '#ef4444';

  return (
    <div style={{ background: T.panel, borderRadius: 8, padding: 20, border: `1px solid ${T.border}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>Quality Loop</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{
            display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
            background: running ? (paused ? '#eab308' : '#22c55e') : '#6b7280',
          }} />
          <span style={{ fontSize: 11, color: T.textMuted }}>
            {running ? (paused ? 'Paused' : 'Running') : 'Stopped'}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 24, marginBottom: 16 }}>
        <StatBox label="Completed" value={stats.completed} color="#22c55e" T={T} />
        <StatBox label="In Progress" value={stats.inProgress} color="#3b82f6" T={T} />
        <StatBox label="Pending" value={stats.pending} color="#a855f7" T={T} />
        <StatBox label="Failed" value={stats.failed} color="#ef4444" T={T} />
        <StatBox label="Skipped" value={stats.skipped} color="#6b7280" T={T} />
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: T.textMuted, marginBottom: 4 }}>
          <span>{pct}% complete</span>
          <span>{stats.completed}/{stats.total} files</span>
        </div>
        <div style={{ background: T.bg, borderRadius: 4, height: 8, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: barColor, borderRadius: 4, transition: 'width 0.5s ease' }} />
        </div>
      </div>

      {/* Overall rating */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: T.textMuted }}>
        <span>Overall quality: <strong style={{ color: overallRating >= 7 ? '#22c55e' : '#ef4444' }}>{overallRating.toFixed(1)}</strong>/10</span>
        <span>Threshold: 7.0</span>
      </div>
    </div>
  );
}

function StatBox({ label, value, color, T }: { label: string; value: number; color: string; T: ThemeTokens }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 60 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 10, color: T.textMuted, marginTop: 2 }}>{label}</div>
    </div>
  );
}
