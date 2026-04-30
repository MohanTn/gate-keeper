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
  const accentColor = alert ? '#ef4444' : (color ?? '#3b82f6');

  return (
    <div
      onClick={onClick}
      style={{
        background: '#0f172a',
        border: `1px solid #1e293b`,
        borderLeft: `3px solid ${accentColor}`,
        borderRadius: 6,
        padding: '12px 16px',
        marginBottom: 10,
        cursor: onClick ? 'pointer' : 'default'
      }}
    >
      <div style={{ fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>
        {title}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: accentColor, lineHeight: 1 }}>
        {value}
        {trend === 'up' && <span style={{ fontSize: 14, marginLeft: 6, color: '#22c55e' }}>↑</span>}
        {trend === 'down' && <span style={{ fontSize: 14, marginLeft: 6, color: '#ef4444' }}>↓</span>}
      </div>
      {subtitle && (
        <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>{subtitle}</div>
      )}
    </div>
  );
}
