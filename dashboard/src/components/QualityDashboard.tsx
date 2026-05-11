import React from 'react';
import { useQualityWebSocket } from '../hooks/useQualityWebSocket';
import { QualityProgressCard } from './QualityProgressCard';
import { QualityTrendChart } from './QualityTrendChart';
import { QualityQueuePanel } from './QualityQueuePanel';
import { ThemeTokens } from '../ThemeContext';

interface Props {
  T: ThemeTokens;
}

export function QualityDashboard({ T }: Props) {
  const { stats, items, trends, overallRating, running, paused } = useQualityWebSocket();

  const handleStart = async () => {
    try {
      await fetch('http://127.0.0.1:5379/api/quality/start', { method: 'POST' });
    } catch { /* ignore */ }
  };

  const handleStop = async () => {
    try {
      await fetch('http://127.0.0.1:5379/api/quality/stop', { method: 'POST' });
    } catch { /* ignore */ }
  };

  const handlePause = async () => {
    try {
      await fetch('http://127.0.0.1:5379/api/quality/pause', { method: 'POST' });
    } catch { /* ignore */ }
  };

  const handleResume = async () => {
    try {
      await fetch('http://127.0.0.1:5379/api/quality/resume', { method: 'POST' });
    } catch { /* ignore */ }
  };

  const handleEnqueue = async () => {
    try {
      await fetch('http://127.0.0.1:5379/api/quality/enqueue', { method: 'POST' });
    } catch { /* ignore */ }
  };

  const handleReset = async () => {
    try {
      await fetch('http://127.0.0.1:5379/api/quality/reset', { method: 'POST' });
    } catch { /* ignore */ }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, flex: 1, overflow: 'auto', background: T.bg }}>
      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <ActionButton label={running ? 'Stop' : 'Start'} onClick={running ? handleStop : handleStart} color={running ? '#ef4444' : '#22c55e'} />
        {running && (
          <ActionButton label={paused ? 'Resume' : 'Pause'} onClick={paused ? handleResume : handlePause} color={paused ? '#22c55e' : '#eab308'} />
        )}
        <ActionButton label="Enqueue" onClick={handleEnqueue} color="#3b82f6" />
        <ActionButton label="Reset Failed" onClick={handleReset} color="#a855f7" />
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 11, color: T.textMuted }}>
          Max workers: 2 | Concurrency: 2
        </div>
      </div>

      {/* Progress card */}
      <QualityProgressCard stats={stats} overallRating={overallRating} running={running} paused={paused} T={T} />

      {/* Trend chart + Queue panel */}
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: '0 0 auto' }}>
          <QualityTrendChart trends={trends} T={T} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <QualityQueuePanel items={items} T={T} />
        </div>
      </div>
    </div>
  );
}

function ActionButton({ label, onClick, color }: { label: string; onClick: () => void; color: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'transparent',
        border: `1px solid ${color}`,
        borderRadius: 4,
        color,
        cursor: 'pointer',
        fontSize: 11,
        fontWeight: 500,
        padding: '4px 12px',
      }}
    >
      {label}
    </button>
  );
}
