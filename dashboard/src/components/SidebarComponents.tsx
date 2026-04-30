import React from 'react';
import { ThemeTokens } from '../ThemeContext';

function rc(r: number, T: ThemeTokens): string {
  if (r >= 8) return T.green;
  if (r >= 6) return T.yellow;
  if (r >= 4) return T.orange;
  return T.red;
}

export function RatingBar({ rating, T }: { rating: number; T: ThemeTokens }) {
  const pct = (rating / 10) * 100;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 52, height: 5, background: '#1e293b', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: rc(rating, T), borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 13, color: rc(rating, T), fontWeight: 700, minWidth: 26 }}>{rating}</span>
    </div>
  );
}

export function LangBadge({ lang }: { lang: string }) {
  const colors: Record<string, string> = {
    typescript: '#3b82f6', tsx: '#06b6d4', jsx: '#f59e0b', csharp: '#a78bfa',
  };
  const labels: Record<string, string> = {
    typescript: 'TS', tsx: 'TSX', jsx: 'JSX', csharp: 'C#',
  };
  const color = colors[lang] ?? '#64748b';
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, color,
      border: `1px solid ${color}`, borderRadius: 3,
      padding: '1px 5px', letterSpacing: 0.5, whiteSpace: 'nowrap' as const,
    }}>
      {labels[lang] ?? lang.toUpperCase()}
    </span>
  );
}

export function SevDot({ severity, T }: { severity: string; T: ThemeTokens }) {
  const c = severity === 'error' ? T.red : severity === 'warning' ? T.yellow : T.textFaint;
  return (
    <span style={{
      display: 'inline-block', width: 7, height: 7,
      borderRadius: '50%', background: c, marginRight: 4,
    }} />
  );
}
