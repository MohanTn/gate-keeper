import React from 'react';

interface MetricCardProps {
  title: string;
  value: number | string;
  subtitle?: string;
  alert?: boolean;
  trend?: 'up' | 'down' | 'flat';
  onClick?: () => void;
  color?: string;
}

export function MetricCard({ title, value, subtitle, alert, trend, onClick, color }: MetricCardProps) {
  const accentColor = alert ? 'var(--gk-red)' : (color ?? 'var(--gk-accent)');

  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--gk-elevated)',
        border: `1px solid var(--gk-border)`,
        borderLeft: `3px solid ${accentColor}`,
        borderRadius: 6,
        padding: '12px 16px',
        marginBottom: 10,
        cursor: onClick ? 'pointer' : 'default'
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--gk-text-dim)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>
        {title}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: accentColor, lineHeight: 1 }}>
        {value}
        {trend === 'up' && <span style={{ fontSize: 14, marginLeft: 6, color: 'var(--gk-green)' }}>↑</span>}
        {trend === 'down' && <span style={{ fontSize: 14, marginLeft: 6, color: 'var(--gk-red)' }}>↓</span>}
      </div>
      {subtitle && (
        <div style={{ fontSize: 12, color: 'var(--gk-text-dim)', marginTop: 4 }}>{subtitle}</div>
      )}
    </div>
  );
}
